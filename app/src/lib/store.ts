import { create } from 'zustand'
import { debug, warn } from './log'
import type { TransferEvent, TransferItem, TransferJob } from '../../electron/types'

type TabState = {
  id: string
  title?: string
  profile?: string
  bucket?: string
  prefix: string
  navSelection?: { type: 'bucket' | 'mount'; id: string }
  selectedKey?: string
  selectedType?: 'object' | 'folder'
  selectedDetails?: { type: 'object'; object: import('../../electron/types').S3ObjectItem } | { type: 'folder'; folder: import('../../electron/types').S3Folder }
  connected: boolean
  connectionError?: string
  isSwitchingProfile?: boolean
  transfers: {
    jobs: Record<string, TransferJob>
    items: Record<string, TransferItem>
  }
}

type SettingsState = {
  overwritePolicy: 'skip' | 'overwrite' | 'rename' | 'prompt'
  bandwidthLimitKBps?: number
  requesterPays?: boolean
  objectConcurrency?: number
  partConcurrency?: number
  partSizeMiB?: number
  multipartThresholdMiB?: number
  darkMode?: boolean
  compactMode?: boolean
  mounts?: Array<{ bucket: string; prefix?: string }>
  bottomPanelTab?: 'properties' | 'transfers' | 'log' | 'preview'
  sidebarWidthPx?: number
  queueHeightPx?: number
  folderScanAutoPages?: number
  // UI prefs
  sidebarProfileCollapsed?: boolean
}

export type AwsLogEntry = {
  ts: number
  scope: 's3' | 'xfer'
  action: string
  bucket?: string
  key?: string
  prefix?: string
  status: 'ok' | 'error'
  durationMs?: number
  error?: string
  extra?: any
}

type State = {
  // Tab collection
  tabs: Record<string, TabState>
  tabOrder: string[]
  activeTabId: string
  // Mirrors for current tab (to minimize component changes)
  profile?: string
  bucket?: string
  prefix: string
  navSelection?: { type: 'bucket' | 'mount'; id: string }
  selectedKey?: string
  selectedType?: 'object' | 'folder'
  selectedDetails?: TabState['selectedDetails']
  connected: boolean
  connectionError?: string
  isSwitchingProfile?: boolean
  transfers: TabState['transfers']
  // Global UI
  isSettingsOpen?: boolean
  settings: SettingsState
  // Job -> tab mapping to route transfer events
  jobTab: Record<string, string>
  awsLog: AwsLogEntry[]
  toast?: { type: 'error' | 'info' | 'success'; message: string }
}

type Actions = {
  // Tabs
  newTab: (initial?: Partial<Pick<TabState, 'profile' | 'bucket' | 'prefix' | 'title'>>) => string
  closeTab: (tabId: string) => void
  activateTab: (tabId: string) => void
  renameTab: (tabId: string, title?: string) => void
  // Active tab scoped setters
  setProfile: (profile?: string) => void
  setConnected: (connected: boolean) => void
  setIsSwitchingProfile: (v: boolean) => void
  setConnectionError: (err?: string) => void
  setNavSelection: (sel?: { type: 'bucket' | 'mount'; id: string }) => void
  selectBucket: (bucket: string | undefined) => void
  setPrefix: (prefix: string) => void
  setSelectedKey: (key?: string) => void
  setSelected: (key?: string, type?: 'object' | 'folder') => void
  setSelectedDetails: (details?: TabState['selectedDetails']) => void
  // Transfers (active tab)
  setTransfers: (transfers: TabState['transfers']) => void
  registerJobForActiveTab: (jobId: string) => void
  // Global UI
  openSettings: () => void
  closeSettings: () => void
  setSettings: (settings: Partial<SettingsState>) => void
  // Accepts either an object payload or legacy (type, message, duration)
  showToast: (
    toast: { type: 'error' | 'info' | 'success'; message: string },
    durationMs?: number
  ) => void
  // Helpers
  startDownloadObject: (destDir: string) => Promise<void>
  startDownloadPrefix: (destDir: string) => Promise<void>
  startDownloadSelected: (destDir: string) => Promise<void>
  // AWS log actions
  addAwsLog: (entry: AwsLogEntry) => void
  clearAwsLog: () => void
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem('s3lite.settings')
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        overwritePolicy: parsed.overwritePolicy || 'prompt',
        bandwidthLimitKBps: parsed.bandwidthLimitKBps,
        requesterPays: Boolean(parsed.requesterPays),
        objectConcurrency: parsed.objectConcurrency,
        partConcurrency: parsed.partConcurrency,
        partSizeMiB: parsed.partSizeMiB,
        multipartThresholdMiB: parsed.multipartThresholdMiB,
        darkMode: Boolean(parsed.darkMode),
    compactMode: Boolean(parsed.compactMode),
        mounts: Array.isArray(parsed.mounts) ? parsed.mounts.filter((m: any) => m && typeof m.bucket === 'string').map((m: any) => ({ bucket: m.bucket, prefix: m.prefix || undefined })) : [],
  bottomPanelTab: parsed.bottomPanelTab === 'properties' || parsed.bottomPanelTab === 'log' || parsed.bottomPanelTab === 'preview' ? parsed.bottomPanelTab : 'transfers',
        sidebarWidthPx: typeof parsed.sidebarWidthPx === 'number' ? parsed.sidebarWidthPx : undefined,
        queueHeightPx: typeof parsed.queueHeightPx === 'number' ? parsed.queueHeightPx : undefined,
        folderScanAutoPages: typeof parsed.folderScanAutoPages === 'number' && parsed.folderScanAutoPages > 0 ? parsed.folderScanAutoPages : 10,
    sidebarProfileCollapsed: Boolean(parsed.sidebarProfileCollapsed),
      }
    }
  } catch {}
  return { overwritePolicy: 'prompt', darkMode: true, compactMode: false, bottomPanelTab: 'transfers', mounts: [], folderScanAutoPages: 10, sidebarProfileCollapsed: false }
}

function persistSettings(s: SettingsState) {
  try { localStorage.setItem('s3lite.settings', JSON.stringify(s)) } catch {}
}

function createEmptyTab(id: string): TabState {
  return {
    id,
    title: undefined,
    profile: undefined,
    bucket: undefined,
    prefix: '',
    navSelection: undefined,
    selectedKey: undefined,
    selectedType: undefined,
    selectedDetails: undefined,
    connected: false,
    connectionError: undefined,
    isSwitchingProfile: false,
    transfers: { jobs: {}, items: {} }
  }
}

let toastTimer: number | undefined

type ShowToast = {
  (toast: { type: 'error' | 'info' | 'success'; message: string }, durationMs?: number): void
  (type: 'error' | 'info' | 'success', message: string, durationMs?: number): void
}

export const useStore = create<State & Actions>((set, get) => {
  function syncMirrorFrom(tab: TabState) {
    set({
      profile: tab.profile,
      bucket: tab.bucket,
      prefix: tab.prefix,
      navSelection: tab.navSelection,
      selectedKey: tab.selectedKey,
      selectedType: tab.selectedType,
      selectedDetails: tab.selectedDetails,
      connected: tab.connected,
      connectionError: tab.connectionError,
      isSwitchingProfile: tab.isSwitchingProfile,
      transfers: tab.transfers
    })
  }

  const firstId = 'tab_1'
  const initialTab = createEmptyTab(firstId)
  return {
    // Tabs
    tabs: { [firstId]: initialTab },
    tabOrder: [firstId],
    activeTabId: firstId,
    // Mirrors
    profile: initialTab.profile,
    bucket: initialTab.bucket,
    prefix: initialTab.prefix,
    navSelection: initialTab.navSelection,
    selectedKey: initialTab.selectedKey,
    selectedType: initialTab.selectedType,
    selectedDetails: initialTab.selectedDetails,
    connected: initialTab.connected,
    connectionError: initialTab.connectionError,
    isSwitchingProfile: initialTab.isSwitchingProfile,
    transfers: initialTab.transfers,
    // Global UI
    isSettingsOpen: false,
    settings: loadSettings(),
    toast: undefined,
    // job mapping
    jobTab: {},
  awsLog: [],

    // Tab actions
    newTab: (initial) => {
      const id = `tab_${Math.random().toString(36).slice(2, 8)}`
      const t = createEmptyTab(id)
      if (initial?.profile !== undefined) t.profile = initial.profile
      if (initial?.bucket !== undefined) t.bucket = initial.bucket
      if (initial?.prefix !== undefined) t.prefix = initial.prefix || ''
      if (initial?.title !== undefined) t.title = initial.title
      set(s => ({ tabs: { ...s.tabs, [id]: t }, tabOrder: [...s.tabOrder, id] }))
      // Activate new tab
      get().activateTab(id)
      return id
    },
    closeTab: (tabId) => {
      set(s => {
        if (!s.tabs[tabId]) return s as any
        const { [tabId]: _, ...rest } = s.tabs
        const order = s.tabOrder.filter(id => id !== tabId)
        let active = s.activeTabId
        if (active === tabId) active = order[order.length - 1] || order[0]
        const next: any = { tabs: rest, tabOrder: order, activeTabId: active }
        if (active && rest[active]) {
          const tab = rest[active]
          next.profile = tab.profile
          next.bucket = tab.bucket
          next.prefix = tab.prefix
          next.navSelection = tab.navSelection
          next.selectedKey = tab.selectedKey
          next.selectedType = tab.selectedType
          next.selectedDetails = tab.selectedDetails
          next.connected = tab.connected
          next.connectionError = tab.connectionError
          next.isSwitchingProfile = tab.isSwitchingProfile
          next.transfers = tab.transfers
        }
        return next
      })
    },
    activateTab: (tabId) => {
      const s = get()
      const tab = s.tabs[tabId]
      if (!tab) return
      set({ activeTabId: tabId })
      syncMirrorFrom(tab)
      // Optionally re-init S3 client to this tab's profile for isolation
      if (tab.profile) {
        ;(async () => {
          try { await (window as any).api.s3.init({ profile: tab.profile }) } catch {}
        })()
      }
    },
    renameTab: (tabId, title) => set(s => ({ tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], title } } })),

    // Active tab scoped setters
    setProfile: (profile) => set(s => {
      const id = s.activeTabId
      const tab = { ...s.tabs[id], profile, bucket: undefined, prefix: '', selectedKey: undefined, selectedType: undefined, connected: false }
      const tabs = { ...s.tabs, [id]: tab }
      const next: any = { tabs }
      // update mirror
      next.profile = tab.profile
      next.bucket = tab.bucket
      next.prefix = tab.prefix
      next.selectedKey = tab.selectedKey
      next.selectedType = tab.selectedType
      next.connected = tab.connected
      return next
    }),
    setConnected: (connected) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], connected }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, connected } as any }),
    setConnectionError: (err) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], connectionError: err }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, connectionError: err } as any }),
    setIsSwitchingProfile: (v) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], isSwitchingProfile: v }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, isSwitchingProfile: v } as any }),
    setNavSelection: (sel) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], navSelection: sel }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, navSelection: sel } as any }),
    selectBucket: (bucket) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], bucket, prefix: '', selectedKey: undefined, selectedType: undefined }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, bucket, prefix: '', selectedKey: undefined, selectedType: undefined } as any }),
    setPrefix: (prefix) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], prefix, selectedKey: undefined, selectedType: undefined }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, prefix, selectedKey: undefined, selectedType: undefined } as any }),
    setSelectedKey: (selectedKey) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], selectedKey }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, selectedKey } as any }),
    setSelected: (key, type) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], selectedKey: key, selectedType: type, selectedDetails: undefined }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, selectedKey: key, selectedType: type, selectedDetails: undefined } as any }),
    setSelectedDetails: (details) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], selectedDetails: details }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, selectedDetails: details } as any }),

    // Transfers
    setTransfers: (transfers) => set(s => { const id = s.activeTabId; const tab = { ...s.tabs[id], transfers }; const tabs = { ...s.tabs, [id]: tab }; return { tabs, transfers } as any }),
    registerJobForActiveTab: (jobId) => set(s => ({ jobTab: { ...s.jobTab, [jobId]: s.activeTabId } })),

    // Global UI
    openSettings: () => set({ isSettingsOpen: true }),
    closeSettings: () => set({ isSettingsOpen: false }),
    setSettings: (partial) => set(s => { const next = { ...s.settings, ...partial }; persistSettings(next); return { settings: next } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    showToast: ((...args: any[]) => {
      // Normalize arguments to { type, message } + duration
      let payload: { type: 'error' | 'info' | 'success'; message: string }
      let durationMs: number | undefined
      if (typeof args[0] === 'string') {
        // Legacy signature: (type, message, duration?)
        const type = args[0] as 'error' | 'info' | 'success'
        const message = String(args[1] ?? '')
        durationMs = typeof args[2] === 'number' ? args[2] : undefined
        payload = { type, message }
        warn('ui', 'showToast called with legacy signature', { type, message, durationMs })
      } else {
        payload = args[0]
        durationMs = typeof args[1] === 'number' ? args[1] : undefined
      }
      const dur = durationMs ?? 3500
      debug('ui', 'showToast', { payload, durationMs: dur })
      try {
        if (toastTimer) window.clearTimeout(toastTimer)
      } catch {}
      set({ toast: payload })
      try {
        toastTimer = window.setTimeout(() => {
          set({ toast: undefined })
          toastTimer = undefined
          debug('ui', 'toast cleared')
        }, dur)
      } catch {}
    }) as unknown as ShowToast,

    // Helpers
    startDownloadObject: async (destDir) => {
      const state = get()
      if (!state.bucket || !state.selectedKey) return
      const res = await (window as any).api.transfers.startObjectDownload({ bucket: state.bucket, key: state.selectedKey, destDir, settings: state.settings })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
      get().registerJobForActiveTab(res.jobId)
    },
    startDownloadPrefix: async (destDir) => {
      const state = get()
      if (!state.bucket || !state.prefix) return
      const res = await (window as any).api.transfers.startPrefixDownload({ bucket: state.bucket, prefix: state.prefix, destDir, settings: state.settings })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
      get().registerJobForActiveTab(res.jobId)
    },
    startDownloadSelected: async (destDir) => {
      const state = get()
      if (!state.bucket) return
      if (state.selectedType === 'folder' && state.selectedKey) {
        const res = await (window as any).api.transfers.startPrefixDownload({ bucket: state.bucket, prefix: state.selectedKey, destDir, settings: state.settings })
        if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
        get().registerJobForActiveTab(res.jobId)
        return
      }
      if (state.selectedType === 'object' && state.selectedKey) {
        const res = await (window as any).api.transfers.startObjectDownload({ bucket: state.bucket, key: state.selectedKey, destDir, settings: state.settings })
        if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
        get().registerJobForActiveTab(res.jobId)
        return
      }
      if (state.prefix) {
        const res = await (window as any).api.transfers.startPrefixDownload({ bucket: state.bucket, prefix: state.prefix, destDir, settings: state.settings })
        if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
        get().registerJobForActiveTab(res.jobId)
      }
    }
    ,
    // AWS log mutations
    addAwsLog: (entry) => set(s => ({ awsLog: [...s.awsLog, entry].slice(-1000) })),
    clearAwsLog: () => set({ awsLog: [] })
  }
})

// Global, batched transfer event router: route events to correct tab and reduce UI churn for large queues
;(function initTransferRouting() {
  let initialized = false
  // Pending buffers per tab; flushed on a timer
  const pending: Record<string, { jobs: Record<string, TransferJob>; items: Record<string, TransferItem & { addedAt?: number }> }> = {}
  let flushTimer: number | undefined
  const FLUSH_MS = 150
  const MAX_ITEMS_PER_TAB = 5000

  function queueFlush() {
    if (flushTimer) return
    try { flushTimer = window.setTimeout(flush, FLUSH_MS) as unknown as number } catch { flushTimer = undefined as any }
  }

  function markAddedAt<T extends TransferItem>(it: T): T & { addedAt?: number } {
    const v: any = { ...it }
    if (v.addedAt == null) v.addedAt = Date.now()
    const total = v.size || 0
    const clamped = Math.min(Math.max(0, v.bytesTransferred || 0), total)
    v.bytesTransferred = v.status === 'completed' ? total : clamped
    return v
  }

  function flush() {
    flushTimer = undefined
    const tabsToApply = Object.keys(pending)
    if (tabsToApply.length === 0) return
    useStore.setState(ss => {
      const nextTabs = { ...ss.tabs }
      for (const tabId of tabsToApply) {
        const buf = pending[tabId]
        if (!buf) continue
        delete pending[tabId]
        const t = ss.tabs[tabId]
        if (!t) continue
        // Mutate transfers in place to avoid copying huge maps every tick
        const transfers = t.transfers
        // Jobs: assign/overwrite
        for (const jid of Object.keys(buf.jobs)) {
          transfers.jobs[jid] = buf.jobs[jid]
        }
        // Items: assign/overwrite
        for (const iid of Object.keys(buf.items)) {
          transfers.items[iid] = buf.items[iid]
        }
        // Enforce cap: drop oldest queued items first, then terminal, keep in-progress/paused
        let count = Object.keys(transfers.items).length
        if (count > MAX_ITEMS_PER_TAB) {
          const queued: Array<TransferItem & { addedAt?: number }> = []
          const terminal: Array<TransferItem & { addedAt?: number }> = []
          for (const it of Object.values(transfers.items)) {
            if (it.status === 'queued') queued.push(it as any)
            else if (it.status === 'completed' || it.status === 'failed' || it.status === 'canceled') terminal.push(it as any)
          }
          const byAge = (a: any, b: any) => (a.addedAt || 0) - (b.addedAt || 0)
          queued.sort(byAge)
          terminal.sort(byAge)
          let removed = 0
          for (const list of [queued, terminal]) {
            for (const it of list) {
              if (count <= MAX_ITEMS_PER_TAB) break
              delete (transfers.items as any)[it.id]
              count--; removed++
            }
            if (count <= MAX_ITEMS_PER_TAB) break
          }
          debug('ui', 'xfer router cap applied', { tabId, removed, kept: count, max: MAX_ITEMS_PER_TAB })
        }
        // Touch tabs map to signal change
        nextTabs[tabId] = { ...t, transfers }
        if (tabId === ss.activeTabId) {
          // Mirror for active tab
          ;(ss as any).transfers = transfers
        }
        debug('ui', 'xfer router flush', { tabId, jobs: Object.keys(buf.jobs).length, items: Object.keys(buf.items).length, totalItems: Object.keys(transfers.items).length })
      }
      return { tabs: nextTabs }
    })
  }

  return () => {
    if (initialized) return
    initialized = true
    try {
      ;(window as any).api.transfers.onEvent((evt: TransferEvent) => {
        const s = useStore.getState()
        const jobId = evt.type === 'job-state' ? evt.job.id : (evt as any).jobId
        const tabId = s.jobTab[jobId] || s.activeTabId
        if (!tabId) return
        const buf = (pending[tabId] ||= { jobs: {}, items: {} })
        if (evt.type === 'job-state') {
          buf.jobs[evt.job.id] = evt.job
        } else if (evt.type === 'item-state') {
          const it = markAddedAt(evt.item as any)
          // If the parent job is canceled, skip noisy updates
          const job = buf.jobs[it.jobId] || s.tabs[tabId]?.transfers.jobs[it.jobId]
          if (job && job.status === 'canceled') return
          buf.items[it.id] = it
        } else if (evt.type === 'items-added') {
          for (const it0 of evt.items) {
            const it = markAddedAt(it0 as any)
            buf.items[it.id] = it
          }
        }
        queueFlush()
      })
    } catch {}
  }
})()()

// Global AWS events subscription: capture S3/xfer events for the log
;(function initAwsEventLogging() {
  let initialized = false
  return () => {
    if (initialized) return
    initialized = true
    try {
      const api: any = (window as any).api
      if (!api?.log?.onAwsEvent) return
      api.log.onAwsEvent((evt: any) => {
        try { useStore.getState().addAwsLog(evt) } catch {}
      })
    } catch {}
  }
})()()
