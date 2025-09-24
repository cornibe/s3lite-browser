import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useBuckets } from '../lib/query'
import { useStore } from '../lib/store'
import { trace, warn, info } from '../lib/log'
import CreateBucketModal from './CreateBucketModal'
import MountLocationModal from './MountLocationModal'
import EditProfilesModal from './EditProfilesModal'

export default function SidebarBuckets() {
  const { bucket, profile, connected, selectBucket, setPrefix, connectionError, setConnectionError, setConnected, isSwitchingProfile, settings, setSettings, navSelection, setNavSelection, setProfile, setIsSwitchingProfile, activeTabId } = useStore() as any
  const { data, isLoading, isError, error, refetch } = useBuckets(connected, profile)
  const [profiles, setProfiles] = useState([] as any[])
  const [refreshingProfiles, setRefreshingProfiles] = useState(false)
  const [profileCollapsed, setProfileCollapsed] = useState(Boolean(settings?.sidebarProfileCollapsed))
  const [showCreateBucket, setShowCreateBucket] = useState(false)
  const [showMountModal, setShowMountModal] = useState(false)
  const [showEditProfiles, setShowEditProfiles] = useState(false)
  const [bucketFilter, setBucketFilter] = useState('')
  // Profile selection now uses a simple native <select>
  const [mountMenu, setMountMenu] = useState(null as { idx: number; x: number; y: number } | null)
  const [editMount, setEditMount] = useState(null as { idx: number; bucket: string; prefix?: string } | null)
  const mountMenuRef = useRef(null as HTMLDivElement | null)
  const bucketListRef = useRef(null as HTMLUListElement | null)
  const bucketItemRefs = useRef(new Map<string, HTMLButtonElement>())
  const mountedListRef = useRef(null as HTMLUListElement | null)
  const mountedItemRefs = useRef(new Map<string, HTMLButtonElement>())
  // Profiles at the top of sidebar
  useEffect(() => { void refreshProfiles() }, [])
  // Persist profile collapsed state
  useEffect(() => {
    setSettings({ sidebarProfileCollapsed: profileCollapsed })
  }, [profileCollapsed, setSettings])
  // Do not auto-collapse when profile changes; leave as user preference
  async function refreshProfiles() {
    setRefreshingProfiles(true)
    try {
      const list = await (window as any).api.s3.listProfiles()
      setProfiles(list)
      info('ui', 'profiles loaded', { count: list.length })
      if (!profile) {
        const hasDefault = list.find(p => p.name === 'default')
        if (hasDefault) setProfile('default')
      }
    } catch {
      setProfiles([])
    } finally {
      setRefreshingProfiles(false)
    }
  }
  async function connect(p?: string) {
    setIsSwitchingProfile(true)
    setConnected(false)
    try {
      const chosen = p ?? profile
      const res = await (window as any).api.s3.init({ profile: chosen })
      if (!res?.ok) throw new Error(res?.error || 'Failed to connect')
      setConnected(true)
    } catch (e) {
      setConnected(false)
      selectBucket(undefined)
      setConnectionError((e as Error)?.message || 'Failed to connect')
    } finally {
      setIsSwitchingProfile(false)
    }
  }

  // If listing buckets fails (for example missing region or invalid creds),
  // surface that as a connectionError and clear any selected bucket/prefix so
  // stale UI is not shown. Clear the connectionError when buckets load.
  useEffect(() => {
    if (isError) {
      const msg = (error as Error)?.message || 'Failed to load buckets.'
      setConnectionError(msg)
  warn('ui', 'buckets load failed', { error: msg })
      // clear selected bucket/prefix when failure happens
      selectBucket(undefined)
      setNavSelection(undefined)
    } else if (data && data.length > 0) {
      // successful load: clear any previous connection error
      if (connectionError) setConnectionError(undefined)
    }
  }, [isError, error, data, selectBucket, setConnectionError, connectionError, setNavSelection])

  useEffect(() => {
    if (!connected) return
    if (!bucket && data && data.length > 0) { selectBucket(data[0]); setNavSelection({ type: 'bucket', id: data[0] }) }
  }, [connected, bucket, data, selectBucket, setNavSelection])

  // Keep active bucket scrolled into view
  useEffect(() => {
    const id = navSelection?.type === 'bucket' ? navSelection.id : undefined
    if (!id) return
    const el = bucketItemRefs.current.get(id)
    if (el) {
      try { el.scrollIntoView({ block: 'nearest' }) } catch {}
    }
  }, [navSelection])

  // Keep active mounted location scrolled into view
  useEffect(() => {
    const id = navSelection?.type === 'mount' ? navSelection.id : undefined
    if (!id) return
    const el = mountedItemRefs.current.get(id)
    if (el) {
      try { el.scrollIntoView({ block: 'nearest' }) } catch {}
    }
  }, [navSelection])

  // Keyboard navigation helper for lists
  function handleListKey(e: any, items: string[], currentId: string | undefined, onSelect: (id: string) => void) {
    if (items.length === 0) return
    const idx = Math.max(0, currentId ? items.indexOf(currentId) : -1)
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      const next = idx >= 0 ? (idx + 1) % items.length : 0
      onSelect(items[next])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      const next = idx >= 0 ? (idx - 1 + items.length) % items.length : items.length - 1
      onSelect(items[next])
    } else if (e.key === 'Home') {
      e.preventDefault(); e.stopPropagation(); onSelect(items[0])
    } else if (e.key === 'End') {
      e.preventDefault(); e.stopPropagation(); onSelect(items[items.length - 1])
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      if (idx >= 0) onSelect(items[idx])
      else onSelect(items[0])
    }
  }

  // Close the mount context menu when clicking outside or pressing Escape
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!mountMenu) return
      const el = mountMenuRef.current
      if (el && !el.contains(e.target as Node)) {
        setMountMenu(null)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && mountMenu) setMountMenu(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [mountMenu])

  const handleCreateBucket = async (bucketName: string, region?: string) => {
    const result = await (window as any).api.s3.createBucket({ bucketName, region })
    if (!result.ok) {
      throw new Error(result.error)
    }
    // Refresh bucket list
    await refetch()
    // Select the newly created bucket
    selectBucket(bucketName)
  }

  const dark = Boolean(settings?.darkMode)
  const sortedProfiles = useMemo(() => {
    const list = [...profiles]
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }))
    return list
  }, [profiles])

  return (
    <div className={`h-full overflow-y-auto bg-header text-app`}>
  <div className={`px-3 py-2 border-b border-default space-y-2`}>
        {/* Profile header: collapsible */}
        <div
          className={`flex items-center gap-2 ${profileCollapsed ? 'cursor-pointer' : ''}`}
          onClick={() => { if (profileCollapsed) setProfileCollapsed(false) }}
          title={profileCollapsed ? 'Expand' : undefined}
        >
          <button
            className="p-1 rounded row-hover cursor-pointer"
            aria-label={profileCollapsed ? 'Expand profile' : 'Collapse profile'}
            onClick={() => setProfileCollapsed(v => !v)}
            title={profileCollapsed ? 'Expand' : 'Collapse'}
          >
            {profileCollapsed ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden><path d="M9 6l6 6-6 6"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden><path d="M6 9l6 6 6-6"/></svg>
            )}
          </button>
          <div className="text-xs uppercase opacity-70 tracking-wide">Profile</div>
          {profile && (
            <div className="ml-auto text-xs opacity-80 truncate" title={profile}> {profile} </div>
          )}
        </div>
        {!profileCollapsed && (
          <div className="flex items-center gap-2">
            {/* Standard select for profiles */}
            <select
              className="input-theme text-sm h-8 px-2 rounded w-full cursor-pointer"
              value={profile ?? ''}
              onChange={(e) => {
                const next = e.target.value || undefined
                setIsSwitchingProfile(true)
                setConnected(false)
                setProfile(next)
                selectBucket(undefined)
                if (next) {
                  void connect(next)
                } else {
                  // No profile selected
                  setIsSwitchingProfile(false)
                }
              }}
            >
              <option value="">(none)</option>
              {sortedProfiles.map(p => (
                <option key={p.name} value={p.name}>{p.name}{p.isSso ? ' (SSO)' : ''}</option>
              ))}
            </select>
            <button aria-label="Refresh profiles" title="Refresh profiles" className="p-1 rounded row-hover disabled:opacity-50 cursor-pointer" disabled={refreshingProfiles} onClick={() => { void refreshProfiles() }}>
              {refreshingProfiles ? (
                <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth="3" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9" strokeWidth="3"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M3 12a9 9 0 1 1 9 9 1 1 0  1 1 0-2 7 7 0 1 0-7-7H3l2.5-2.5A1 1 0 0 1 7 10l-4 4-4-4a1 1 0 0 1 1.5-1.5L3 12z"/></svg>
              )}
            </button>
            <button aria-label="Edit profiles" title="Edit profiles" className="p-1 rounded row-hover cursor-pointer" onClick={() => setShowEditProfiles(true)}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>
                <path d="M20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.83z"/>
              </svg>
            </button>
          </div>
        )}
  {/* Separator between Profile and Buckets removed to avoid double line */}
      </div>
      {/* Buckets header, actions, and filter - sticky sibling of list */}
      <div className="sticky top-0 bg-header z-10 pt-2 px-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase opacity-70 tracking-wide">Buckets</div>
          {connected && !isSwitchingProfile && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMountModal(true)}
                className="btn btn-primary text-xs inline-flex items-center gap-1"
                title="Mount S3 location (bucket and optional path)"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden>
                  <path d="M7.5 13A3.5 3.5 0 0 1 11 9.5h2A5.5 5.5 0 0 0 7.5 4h-2A5.5 5.5 0 0 0 0 9.5 5.5 5.5 0 0 0 5.5 15H7a1 1 0 1 0 0-2H5.5A3.5 3.5 0 0 1 2 9.5 3.5 3.5 0 0 1 5.5 6h2A3.5 3.5 0 0 1 11 9.5H9A1.5 1.5 0 0 0 7.5 11v2z"/>
                  <path d="M16.5 11A3.5 3.5 0 0 0 13 14.5h-2A5.5 5.5 0 0 1 16.5 9h2A5.5 5.5 0 0 1 24 14.5 5.5 5.5 0 0 1 18.5 20H17a1 1 0 1 1 0-2h1.5A3.5 3.5 0 0 0 22 14.5 3.5 3.5 0 0 0 18.5 11h-2A3.5 3.5 0 0 0 13 14.5h2A1.5 1.5 0 0 1 16.5 13v-2z"/>
                </svg>
                <span>Mount</span>
              </button>
              <button
                onClick={() => setShowCreateBucket(true)}
                className="btn btn-primary text-xs"
                title="Create new bucket"
              >
                + New
              </button>
            </div>
          )}
        </div>
        <div className="relative pb-2">
          <input
            type="text"
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value)}
            placeholder="Filter buckets…"
            className={`w-full h-8 pr-7 px-2 rounded border text-sm input-theme placeholder:text-muted`}
          />
          {bucketFilter && (
            <button
              className="absolute right-1 top-1.5 h-5 w-5 rounded row-hover flex items-center justify-center"
              title="Clear"
              aria-label="Clear bucket filter"
              onClick={() => setBucketFilter('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {!connected && (
        <div className="px-3 py-2 text-sm opacity-80">
          Not connected. Select a profile to connect.
        </div>
      )}
  {connected && isLoading && <div className="px-3 py-2 text-sm">Loading…</div>}
  {isSwitchingProfile && <div className="px-3 py-2 text-sm opacity-70">Switching profile…</div>}
  {/* Connection errors are displayed in the main panel to avoid clutter. */}
  {(!isSwitchingProfile && connected && !isError) && (
        (data && data.length > 0) ? (
      <ul
        ref={bucketListRef}
        className={`text-sm bg-header outline-none overflow-x-hidden`}
        role="listbox"
        aria-label="Buckets"
        tabIndex={0}
        onKeyDown={(e) => {
          // Do not handle when typing into filter input
          const tag = (e.target as HTMLElement)?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
          const visible = data.filter(name => name.toLowerCase().includes(bucketFilter.trim().toLowerCase()))
          const current = navSelection?.type === 'bucket' ? navSelection.id : undefined
          handleListKey(e, visible, current, (id) => { trace('ui', 'select bucket (kb)', { bucket: id }); selectBucket(id); setNavSelection({ type: 'bucket', id }) })
        }}
      >
    {data
              .filter(name => name.toLowerCase().includes(bucketFilter.trim().toLowerCase()))
              .map(name => {
  const isActive = navSelection?.type === 'bucket' && navSelection?.id === name
    const hover = !isActive ? 'row-hover' : ''
              return (
                <li key={name}>
                  <button
        ref={(el) => { if (el) bucketItemRefs.current.set(name, el); else bucketItemRefs.current.delete(name) }}
        role="option"
        aria-selected={isActive}
        onClick={() => { trace('ui', 'select bucket', { bucket: name }); selectBucket(name); setNavSelection({ type: 'bucket', id: name }) }}
          className={`w-full text-left px-3 py-2 row-btn ${hover} ${isActive ? 'selected-row font-medium' : ''}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <BucketIcon className="w-4 h-4 opacity-80" />
                      <span className="truncate" title={name}>{name}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="px-3 py-2 text-sm opacity-70">No buckets found.</div>
        )
      )}

      {/* Separator and Mounted locations */}
      {connected && settings?.mounts && settings.mounts.length > 0 && (
        <div className="mt-3">
          {/* horizontal separator with vertical accent line */}
          <div className="relative">
            <div className="border-t border-default" />
            <div className="absolute left-0 top-0 h-full border-l border-default opacity-60" style={{ height: '100%' }} />
          </div>
          <div className="px-3 pt-3 pb-2 text-xs uppercase opacity-70 tracking-wide">Mounted</div>
          <ul
            ref={mountedListRef}
            className="text-sm outline-none"
            role="listbox"
            aria-label="Mounted locations"
            tabIndex={0}
            onKeyDown={(e) => {
              const items = (settings?.mounts || []).map((m: any, idx: number) => `${m.bucket}:${m.prefix ?? ''}`)
              const current = navSelection?.type === 'mount' ? navSelection.id : undefined
              handleListKey(e, items, current, (id) => {
                const [b, p] = id.split(':')
                selectBucket(b)
                setPrefix(p || '')
                setNavSelection({ type: 'mount', id })
              })
            }}
          >
            {settings.mounts.map((m: { bucket: string; prefix?: string }, idx: number) => {
              const id = `${m.bucket}:${m.prefix ?? ''}`
              const isActive = navSelection?.type === 'mount' && navSelection?.id === id
              const hover = !isActive ? 'row-hover' : ''
              const label = m.prefix ? `${m.bucket}/${m.prefix}` : `${m.bucket}`
              return (
                <li key={`${m.bucket}:${m.prefix ?? ''}:${idx}`} onContextMenu={(e) => {
                  e.preventDefault()
                  setMountMenu({ idx, x: e.clientX, y: e.clientY })
                }}>
                  <button
                    ref={(el) => { if (el) mountedItemRefs.current.set(id, el); else mountedItemRefs.current.delete(id) }}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => { selectBucket(m.bucket); setPrefix(m.prefix ?? ''); setNavSelection({ type: 'mount', id }); }}
                    className={`w-full text-left px-3 py-2 row-btn ${hover} ${isActive ? 'selected-row' : ''}`}
                    title={`s3://${label}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <PinIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span className="truncate">{label}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* simple context menu for mounted entries */}
          {mountMenu && settings?.mounts?.[mountMenu.idx] && (
            <div
              className="fixed z-50 menu-bg border border-default rounded shadow-lg"
              style={{ left: mountMenu.x, top: mountMenu.y }}
              ref={mountMenuRef}
            >
              <button
                className="block w-full text-left px-3 py-2 row-hover menu-item"
                onClick={() => {
                  const m = settings.mounts[mountMenu.idx]
                  setEditMount({ idx: mountMenu.idx, bucket: m.bucket, prefix: m.prefix })
                  setMountMenu(null)
                }}
              >
                Edit
              </button>
              <button
                className="block w-full text-left px-3 py-2 text-red-600 row-hover menu-item"
                onClick={() => {
                  const next = settings.mounts.filter((_: any, i: number) => i !== mountMenu.idx)
                  setSettings({ mounts: next })
                  setMountMenu(null)
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      
      <CreateBucketModal
        isOpen={showCreateBucket}
        onClose={() => setShowCreateBucket(false)}
        onCreateBucket={handleCreateBucket}
      />
      <MountLocationModal
        isOpen={showMountModal}
        onClose={() => setShowMountModal(false)}
        onSubmit={(b, p) => {
          const mounts = Array.isArray(settings?.mounts) ? [...settings.mounts] : []
          // avoid duplicates
          const exists = mounts.some((m: any) => m.bucket === b && (m.prefix || '') === (p || ''))
          if (!exists) {
            mounts.push({ bucket: b, prefix: p })
            setSettings({ mounts })
          }
        }}
      />
      <MountLocationModal
        isOpen={Boolean(editMount)}
        onClose={() => setEditMount(null)}
        mode="edit"
        initialBucket={editMount?.bucket}
        initialPrefix={editMount?.prefix}
        onSubmit={(b, p) => {
          if (editMount == null) return
          const mounts = Array.isArray(settings?.mounts) ? [...settings.mounts] : []
          mounts[editMount.idx] = { bucket: b, prefix: p }
          setSettings({ mounts })
          setEditMount(null)
        }}
      />
      <EditProfilesModal
        isOpen={showEditProfiles}
        onClose={() => setShowEditProfiles(false)}
        onSaved={async () => { await refreshProfiles() }}
      />
    </div>
  )
}

function BucketIcon({ className = 'w-4 h-4' }: { className?: string }) {
  // Simple S3 bucket glyph; currentColor inherits from text color
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2C7 2 3 3.79 3 6v9c0 2.21 4 4 9 4s9-1.79 9-4V6c0-2.21-4-4-9-4zm0 2c4.42 0 7 .99 7 2s-2.58 2-7 2-7-.99-7-2 2.58-2 7-2zm7 5.06V11c0 1.01-2.94 2.5-7 2.5S5 12.01 5 11V9.06C6.5 10.25 9.33 11 12 11s5.5-.75 7-1.94zM5 13.5V15c0 1.01 2.94 2.5 7 2.5s7-1.49 7-2.5v-1.5c-1.5 1.19-4.33 1.94-7 1.94s-5.5-.75-7-1.94z"/>
    </svg>
  )
}

function PinIcon({ className = 'w-4 h-4' }: { className?: string }) {
  // A simple pin/marker icon
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2C8.69 2 6 4.69 6 8c0 4.2 4.5 9.4 5.5 10.6.28.34.72.34 1 0C13.5 17.4 18 12.2 18 8c0-3.31-2.69-6-6-6zm0 8.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 5.5 12 5.5s2.5 1.12 2.5 2.5S13.38 10.5 12 10.5z"/>
    </svg>
  )
}
