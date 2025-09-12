import { create } from 'zustand'

type State = {
  profile?: string
  bucket?: string
  prefix: string
  selectedKey?: string
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
  startDownloadObject: (destDir: string) => Promise<void>
  startDownloadPrefix: (destDir: string) => Promise<void>
}

export const useStore = create<State & Actions>(set => ({
  profile: undefined,
  bucket: undefined,
  prefix: '',
  selectedKey: undefined,
  connected: false,
  transfers: { jobs: {}, items: {} },
  setProfile: (profile) => set({ profile, bucket: undefined, prefix: '', selectedKey: undefined, connected: false }),
  
  setConnected: (connected) => set({ connected }),
  setConnectionError: (err?: string) => set({ connectionError: err }),
  setIsSwitchingProfile: (v: boolean) => set({ isSwitchingProfile: v }),
  selectBucket: (bucket) => set({ bucket, prefix: '', selectedKey: undefined }),
  setPrefix: (prefix) => set({ prefix, selectedKey: undefined }),
  setSelectedKey: (selectedKey) => set({ selectedKey }),
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
  }
}))
