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
  // Lightweight, per-tab counters for status bar
  transferStats: {
    active: number
    queued: number
    completedLifetime: number // persists even if completed items are cleared from UI
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
  transferStats: TabState['transferStats']
  // Global UI
  isSettingsOpen?: boolean
  isProfilesOpen?: boolean
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
  openProfiles: () => void
  closeProfiles: () => void
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
  transfers: { jobs: {}, items: {} },
  transferStats: { active: 0, queued: 0, completedLifetime: 0 }
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
  transfers: tab.transfers,
  transferStats: tab.transferStats
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
  transferStats: initialTab.transferStats,
    // Global UI
  isSettingsOpen: false,
  isProfilesOpen: false,
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
    setTransfers: (transfers) => set(s => {
      const id = s.activeTabId
      const prevTab = s.tabs[id]
      // Derive cleared ids by comparing previous items with new items
      const prevIds = prevTab?.transfers?.items ? new Set(Object.keys(prevTab.transfers.items)) : new Set<string>()
      const nextIds = new Set(Object.keys(transfers.items))
      const clearedIds: string[] = []
      for (const pid of prevIds) if (!nextIds.has(pid)) clearedIds.push(pid)
      const tab = { ...prevTab, transfers }
      const tabs = { ...s.tabs, [id]: tab }
      // Recompute live counters from provided items; preserve lifetime completed
      let active = 0, queued = 0
      for (const it of Object.values(transfers.items)) {
        if (it.status === 'in-progress') active++
        else if (it.status === 'queued' || it.status === 'paused') queued++
      }
      const stats = { ...(prevTab.transferStats || { active: 0, queued: 0, completedLifetime: 0 }), active, queued }
      tab.transferStats = stats
      // Clear any pending router updates for this tab to avoid conflicts
      if (typeof window !== 'undefined' && (window as any).__clearPendingTransferUpdates) {
        (window as any).__clearPendingTransferUpdates(id, clearedIds)
      }
      // Force immediate state update by using fresh object references
      const freshTransfers = { jobs: { ...transfers.jobs }, items: { ...transfers.items } }
      const freshStats = { ...stats }
      const freshTab = { ...tab, transfers: freshTransfers, transferStats: freshStats }
      const freshTabs = { ...tabs, [id]: freshTab }
  // Immediately flush any pending router updates to avoid perceived lag after Clear Finished
  try { (window as any).__flushTransferUpdates?.() } catch {}
  return { tabs: freshTabs, transfers: freshTransfers, transferStats: freshStats } as any
    }),
    registerJobForActiveTab: (jobId) => set(s => ({ jobTab: { ...s.jobTab, [jobId]: s.activeTabId } })),

    // Global UI
    openSettings: () => set({ isSettingsOpen: true }),
    closeSettings: () => set({ isSettingsOpen: false }),
  openProfiles: () => set({ isProfilesOpen: true }),
  closeProfiles: () => set({ isProfilesOpen: false }),
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
  const pending: Record<string, { jobs: Record<string, TransferJob>; items: Record<string, TransferItem & { addedAt?: number; _countedCompleted?: boolean }> }> = {}
  let flushTimer: number | undefined
  const FLUSH_MS = 50
  const MAX_ITEMS_PER_TAB = 5000
  // Track recently-cleared terminal items to prevent resurrection; expire after a short TTL
  const recentlyCleared: Record<string, Map<string, number>> = {}
  const CLEARED_TTL_MS = 10_000

  // Expose function to clear pending updates for a specific tab (used by setTransfers)
  if (typeof window !== 'undefined') {
    (window as any).__clearPendingTransferUpdates = (tabId: string, clearedIds?: string[]) => {
      delete pending[tabId]
      if (clearedIds && clearedIds.length) {
        const now = Date.now()
        const m = (recentlyCleared[tabId] ||= new Map<string, number>())
        for (const id of clearedIds) m.set(id, now)
      }
    }
    ;(window as any).__flushTransferUpdates = () => {
      try {
        if (flushTimer) {
          window.clearTimeout(flushTimer as any)
          flushTimer = undefined as any
        }
      } catch {}
      try { flush() } catch {}
    }
  }

  function queueFlush() {
    if (flushTimer) return
    try { flushTimer = window.setTimeout(flush, FLUSH_MS) as unknown as number } catch { flushTimer = undefined as any }
  }

  function markAddedAt<T extends TransferItem>(it: T): T & { addedAt?: number; _countedCompleted?: boolean } {
    const v: any = { ...it }
    if (v.addedAt == null) v.addedAt = Date.now()
    const total = v.size || 0
    const clamped = Math.min(Math.max(0, v.bytesTransferred || 0), total)
    v.bytesTransferred = v.status === 'completed' ? total : clamped
    // preserve completed counter marker if present
    if (it && (it as any)._countedCompleted) v._countedCompleted = true
    return v
  }

  function flush() {
    flushTimer = undefined
    const tabsToApply = Object.keys(pending)
    if (tabsToApply.length === 0) return
    const APPLY_LIMIT = 5000 // apply at most this many item updates per tab per flush to reduce jank
    useStore.setState(ss => {
      const nextTabs = { ...ss.tabs }
      let activeMirrorTransfers: TabState['transfers'] | undefined
      let activeMirrorStats: TabState['transferStats'] | undefined
      for (const tabId of tabsToApply) {
        const buf = pending[tabId]
        if (!buf) continue
        const t = ss.tabs[tabId]
        if (!t) continue
        
        // Create completely fresh transfers and stats objects to avoid mutation conflicts
        const newTransfers = {
          jobs: { ...t.transfers.jobs },
          items: { ...t.transfers.items }
        }
        const newStats = { ...t.transferStats }
        
        // Jobs: assign/overwrite (apply all)
        const jobIds = Object.keys(buf.jobs)
        for (const jid of jobIds) {
          newTransfers.jobs[jid] = buf.jobs[jid]
          delete buf.jobs[jid]
        }
        // Snapshot canceled job ids after applying job updates
        const canceledJobIds = new Set(Object.values(newTransfers.jobs).filter(j => j.status === 'canceled').map(j => j.id))
        // Items: assign/overwrite with per-flush cap to reduce main-thread blocking
        let itemIds = Object.keys(buf.items)
        // Filter out late updates for items the user just cleared (within TTL)
        const rc = recentlyCleared[tabId]
        if (rc && rc.size) {
          const now = Date.now()
          // purge expired
          for (const [k, ts] of Array.from(rc.entries())) { if (now - ts > CLEARED_TTL_MS) rc.delete(k) }
          if (rc.size) itemIds = itemIds.filter(id => !rc.has(id))
        }
        if (itemIds.length > APPLY_LIMIT) {
          // Prefer the newest updates to converge faster on terminal states
          itemIds = itemIds
            .map(id => [id, (buf.items[id] as any)?.addedAt || 0] as [string, number])
            .sort((a, b) => a[1] - b[1]) // oldest -> newest
            .slice(-APPLY_LIMIT)
            .map(([id]) => id)
        }
        for (const iid of itemIds) {
          const incoming: any = buf.items[iid]
          const prev = newTransfers.items[iid] as (TransferItem & { _countedCompleted?: boolean }) | undefined
          // increment lifetime completed once when transitioning to completed
          if (incoming.status === 'completed' && !prev?._countedCompleted && !incoming._countedCompleted) {
            newStats.completedLifetime = (newStats.completedLifetime || 0) + 1
            incoming._countedCompleted = true
          } else if (prev?._countedCompleted) {
            incoming._countedCompleted = true
          }
          newTransfers.items[iid] = incoming
          // remove from buffer (others remain for next flush)
          delete buf.items[iid]
        }
        // Recompute active/queued from current map for live accuracy.
        // If a job is canceled, proactively mark its non-terminal items as canceled to avoid "stuck" entries.
        let active = 0, queued = 0
        if (canceledJobIds.size > 0) {
          for (const [iid, it0] of Object.entries(newTransfers.items)) {
            const it = it0 as TransferItem & { addedAt?: number; _countedCompleted?: boolean }
            const isTerminal = it.status === 'completed' || it.status === 'failed' || it.status === 'canceled'
            if (!isTerminal && canceledJobIds.has(it.jobId)) {
              // immutably replace to ensure React sees the change
              newTransfers.items[iid] = { ...it, status: 'canceled' }
            }
          }
        }
        for (const it of Object.values(newTransfers.items)) {
          if (it.status === 'in-progress') active++
          else if (it.status === 'queued' || it.status === 'paused') queued++
        }
        newStats.active = active; newStats.queued = queued
        
        // Enforce cap: drop oldest queued items first, then terminal, keep in-progress/paused
        let count = Object.keys(newTransfers.items).length
        if (count > MAX_ITEMS_PER_TAB) {
          const queuedItems: Array<TransferItem & { addedAt?: number }> = []
          const terminalItems: Array<TransferItem & { addedAt?: number }> = []
          for (const it of Object.values(newTransfers.items)) {
            if (it.status === 'queued') queuedItems.push(it as any)
            else if (it.status === 'completed' || it.status === 'failed' || it.status === 'canceled') terminalItems.push(it as any)
          }
          const byAge = (a: any, b: any) => (a.addedAt || 0) - (b.addedAt || 0)
          queuedItems.sort(byAge)
          terminalItems.sort(byAge)
          let removed = 0
          for (const list of [queuedItems, terminalItems]) {
            for (const it of list) {
              if (count <= MAX_ITEMS_PER_TAB) break
              delete newTransfers.items[it.id]
              count--; removed++
            }
            if (count <= MAX_ITEMS_PER_TAB) break
          }
          // Recompute stats after cap enforcement
          active = 0; queued = 0
          for (const it of Object.values(newTransfers.items)) {
            if (it.status === 'in-progress') active++
            else if (it.status === 'queued' || it.status === 'paused') queued++
          }
          newStats.active = active; newStats.queued = queued
          debug('ui', 'xfer router cap applied', { tabId, removed, kept: count, max: MAX_ITEMS_PER_TAB })
        }
        
        // Create completely fresh tab reference
        const freshTab = { ...t, transfers: newTransfers, transferStats: newStats }
        nextTabs[tabId] = freshTab
        if (tabId === ss.activeTabId) {
          activeMirrorTransfers = newTransfers
          activeMirrorStats = newStats
        }
    debug('ui', 'xfer router flush', { tabId, jobsApplied: jobIds.length, itemsApplied: itemIds.length, bufJobsLeft: Object.keys(buf.jobs).length, bufItemsLeft: Object.keys(buf.items).length, totalItems: Object.keys(newTransfers.items).length, active: newStats.active, queued: newStats.queued })
      }
      const patch: any = { tabs: nextTabs }
      if (activeMirrorTransfers) patch.transfers = activeMirrorTransfers
      if (activeMirrorStats) patch.transferStats = activeMirrorStats
      return patch
    })
  // If buffers remain (due to APPLY_LIMIT), schedule another quick flush
  const hasPendingLeft = Object.values(pending).some(b => b && (Object.keys(b.jobs).length > 0 || Object.keys(b.items).length > 0))
  if (hasPendingLeft) queueFlush()
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
          // If the parent job is canceled, allow only terminalization updates; drop non-terminal noise
          const job = buf.jobs[it.jobId] || s.tabs[tabId]?.transfers.jobs[it.jobId]
          if (job && job.status === 'canceled') {
            if (it.status !== 'canceled' && it.status !== 'completed' && it.status !== 'failed') {
              return
            }
          }
          buf.items[it.id] = it
        } else if (evt.type === 'items-added') {
          const jid = (evt as any).jobId
          const job = buf.jobs[jid] || s.tabs[tabId]?.transfers.jobs[jid]
          if (job && job.status === 'canceled') {
            // Ignore late arrivals for canceled job
          } else {
            for (const it0 of evt.items) {
              const it = markAddedAt(it0 as any)
              buf.items[it.id] = it
            }
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
