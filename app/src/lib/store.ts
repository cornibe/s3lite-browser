import { create } from 'zustand'
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
  mounts?: Array<{ bucket: string; prefix?: string }>
  bottomPanelTab?: 'properties' | 'transfers'
  sidebarWidthPx?: number
  queueHeightPx?: number
  folderScanAutoPages?: number
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
  // Helpers
  startDownloadObject: (destDir: string) => Promise<void>
  startDownloadPrefix: (destDir: string) => Promise<void>
  startDownloadSelected: (destDir: string) => Promise<void>
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
        mounts: Array.isArray(parsed.mounts) ? parsed.mounts.filter((m: any) => m && typeof m.bucket === 'string').map((m: any) => ({ bucket: m.bucket, prefix: m.prefix || undefined })) : [],
        bottomPanelTab: parsed.bottomPanelTab === 'properties' ? 'properties' : 'transfers',
        sidebarWidthPx: typeof parsed.sidebarWidthPx === 'number' ? parsed.sidebarWidthPx : undefined,
        queueHeightPx: typeof parsed.queueHeightPx === 'number' ? parsed.queueHeightPx : undefined,
        folderScanAutoPages: typeof parsed.folderScanAutoPages === 'number' && parsed.folderScanAutoPages > 0 ? parsed.folderScanAutoPages : 10,
      }
    }
  } catch {}
  return { overwritePolicy: 'prompt', darkMode: true, bottomPanelTab: 'transfers', mounts: [], folderScanAutoPages: 10 }
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
    // job mapping
    jobTab: {},

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
  }
})

// Global, throttled transfer event router: route events to correct tab by jobId
;(function initTransferRouting() {
  let initialized = false
  return () => {
    if (initialized) return
    initialized = true
    try {
      ;(window as any).api.transfers.onEvent((evt: TransferEvent) => {
        const s = useStore.getState()
        const jobId = evt.type === 'job-state' ? evt.job.id : (evt as any).jobId
        const tabId = s.jobTab[jobId] || s.activeTabId // fallback to active
        const tab = s.tabs[tabId]
        if (!tab) return
        const jobs = { ...tab.transfers.jobs }
        const items = { ...tab.transfers.items }
        if (evt.type === 'job-state') {
          jobs[evt.job.id] = evt.job
        } else if (evt.type === 'item-state') {
          const it = evt.item
          const total = it.size || 0
          const clamped = Math.min(Math.max(0, it.bytesTransferred || 0), total)
          const finalBytes = it.status === 'completed' ? total : clamped
          items[it.id] = { ...it, bytesTransferred: finalBytes }
        }
        const transfers = { jobs, items }
        // commit back to tab
        useStore.setState(ss => {
          const t = ss.tabs[tabId]
          const nextTabs = { ...ss.tabs, [tabId]: { ...t, transfers } }
          const patch: any = { tabs: nextTabs }
          if (tabId === ss.activeTabId) patch.transfers = transfers
          return patch
        })
      })
    } catch {}
  }
})()()
