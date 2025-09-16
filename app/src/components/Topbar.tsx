import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { queryClient } from '../lib/query'
import { trace, info, warn } from '../lib/log'

export default function Topbar() {
  const { profile, connected, bucket, setProfile, setConnected, selectBucket, setConnectionError, setIsSwitchingProfile } = useStore() as any
  const { openSettings, settings } = useStore() as any
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState('')
  // Keep local error for status logic if needed, but do not render it in the UI
  const [error, setError] = useState('')
  const [profiles, setProfiles] = useState<{ name: string; isSso?: boolean }[]>([])

  useEffect(() => {
    void refreshProfiles()
  }, [])

  async function refreshProfiles() {
    setRefreshing(true)
    setError('')
    try {
      const list = await (window as any).api.s3.listProfiles()
      setProfiles(list)
      info('ui', 'profiles loaded', { count: list.length })
      if (!profile) {
        const hasDefault = list.find(p => p.name === 'default')
        if (hasDefault) setProfile('default')
      }
      setStatus(`Profiles loaded .€ ${list.length}`)
    } catch {
      setProfiles([])
      setStatus('')
    } finally {
      setRefreshing(false)
    }
  }

  async function connect(p?: string) {
    setConnecting(true)
    setError('')
    setConnectionError(undefined)
    setStatus('Connecting.€')
    setIsSwitchingProfile(true)
    try {
      const chosen = p ?? profile
      trace('ui', 'connect profile', { profile: chosen || null })
      const res = await (window as any).api.s3.init({ profile: chosen })
      if (!res?.ok) throw new Error(res?.error || 'Failed to connect')
      setConnected(true)
      setStatus(`Connected${chosen ? ` .€ ${chosen}` : ''}`)
    } catch (e) {
      setConnected(false)
      selectBucket(undefined)
      queryClient.clear()
      const msg = (e as Error).message || 'Failed to connect'
      setError(msg)
      setConnectionError(msg)
      setStatus('')
      warn('ui', 'connect failed', { error: (e as Error)?.message || String(e) })
    } finally {
      setConnecting(false)
      setIsSwitchingProfile(false)
    }
  }

  const dark = Boolean(settings?.darkMode)
  return (
    <div className={`border-b px-4 py-2 flex items-center gap-3 bg-header border-default text-app`}>
      <div className="font-semibold">S3 Browser</div>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <label className="text-sm opacity-80">Profile</label>
        <select className={`px-2 py-1 rounded border text-sm cursor-pointer input-theme`} value={profile ?? ''} onChange={e => { const next = e.target.value || undefined; setIsSwitchingProfile(true); setConnected(false); setProfile(next); selectBucket(undefined); queryClient.clear(); setError(''); setConnectionError(undefined); if (next) { void connect(next) } else { setStatus('Not connected'); setIsSwitchingProfile(false) } }}>
          <option value="">(none)</option>
          {profiles.map(p => (
            <option key={p.name} value={p.name}>{p.name}{p.isSso ? ' (SSO)' : ''}</option>
          ))}
        </select>
        <button aria-label="Refresh profiles" title="Refresh profiles" className={`p-1 rounded disabled:opacity-50 cursor-pointer row-hover`} disabled={refreshing} onClick={() => { trace('ui', 'refresh profiles'); void refreshProfiles() }}>
          {refreshing ? (
            <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth="3" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9" strokeWidth="3"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M3 12a9 9 0 1 1 9 9 1 1 0 1 1 0-2 7 7 0 1 0-7-7H3l2.5-2.5A1 1 0 0 1 7 10l-4 4-4-4a1 1 0 0 1 1.5-1.5L3 12z"/></svg>
          )}
        </button>
      </div>
      <div className="w-72 text-xs text-right whitespace-nowrap">
        <span className="opacity-70">{connecting ? 'Connecting.€' : (status || (connected ? `Connected${profile ? ` .€ ${profile}` : ''}` : 'Not connected'))}</span>
      </div>
      <div className="pl-2">
        <button className={`px-2 py-1 text-sm rounded cursor-pointer ${dark ? 'bg-[#0e639c] hover:bg-[#1177bb] text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-700'}`} onClick={openSettings}>
          Settings
        </button>
      </div>
    </div>
  )
}
