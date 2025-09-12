import { create } from 'zustand'

type State = {
  profile?: string
  bucket?: string
  prefix: string
  selectedKey?: string
  selectedType?: 'object' | 'folder'
  connected: boolean
  connectionError?: string
  isSwitchingProfile?: boolean
  transfers: {
    jobs: Record<string, import('../../electron/types').TransferJob>
    items: Record<string, import('../../electron/types').TransferItem>
  }
}

type Actions = {
  setProfile: (profile?: string) => void
  setConnected: (connected: boolean) => void
  setIsSwitchingProfile: (v: boolean) => void
  setConnectionError: (err?: string) => void
  selectBucket: (bucket: string | undefined) => void
  setPrefix: (prefix: string) => void
  setSelectedKey: (key?: string) => void
  setSelected: (key?: string, type?: 'object' | 'folder') => void
  setTransfers: (transfers: State['transfers']) => void
  startDownloadObject: (destDir: string) => Promise<void>
  startDownloadPrefix: (destDir: string) => Promise<void>
  startDownloadSelected: (destDir: string) => Promise<void>
}

export const useStore = create<State & Actions>(set => ({
  profile: undefined,
  bucket: undefined,
  prefix: '',
  selectedKey: undefined,
  selectedType: undefined,
  connected: false,
  transfers: { jobs: {}, items: {} },
  setProfile: (profile) => set({ profile, bucket: undefined, prefix: '', selectedKey: undefined, selectedType: undefined, connected: false }),
  
  setConnected: (connected) => set({ connected }),
  setConnectionError: (err?: string) => set({ connectionError: err }),
  setIsSwitchingProfile: (v: boolean) => set({ isSwitchingProfile: v }),
  selectBucket: (bucket) => set({ bucket, prefix: '', selectedKey: undefined, selectedType: undefined }),
  setPrefix: (prefix) => set({ prefix, selectedKey: undefined, selectedType: undefined }),
  setSelectedKey: (selectedKey) => set({ selectedKey }),
  setSelected: (key, type) => set({ selectedKey: key, selectedType: type }),
  setTransfers: (transfers) => set({ transfers }),
  startDownloadObject: async (destDir) => {
    const state = (useStore.getState())
    if (!state.bucket || !state.selectedKey) return
    const res = await (window as any).api.transfers.startObjectDownload({ bucket: state.bucket, key: state.selectedKey, destDir })
    if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
  },
  startDownloadPrefix: async (destDir) => {
    const state = (useStore.getState())
    if (!state.bucket || !state.prefix) return
    const res = await (window as any).api.transfers.startPrefixDownload({ bucket: state.bucket, prefix: state.prefix, destDir })
    if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
  },
  startDownloadSelected: async (destDir) => {
    const state = (useStore.getState())
    if (!state.bucket) return
    if (state.selectedType === 'folder' && state.selectedKey) {
      const res = await (window as any).api.transfers.startPrefixDownload({ bucket: state.bucket, prefix: state.selectedKey, destDir })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
      return
    }
    if (state.selectedType === 'object' && state.selectedKey) {
      const res = await (window as any).api.transfers.startObjectDownload({ bucket: state.bucket, key: state.selectedKey, destDir })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
      return
    }
    if (state.prefix) {
      const res = await (window as any).api.transfers.startPrefixDownload({ bucket: state.bucket, prefix: state.prefix, destDir })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start download')
    }
  }
}))
