import React, { useMemo, useRef, useEffect, useState } from 'react'
import { useObjects } from '../lib/query'
import { useStore } from '../lib/store'
import type { S3ObjectItem, S3Folder, TransferEvent } from '../../electron/types'
import { trace } from '../lib/log'
import CreateFolderModal from './CreateFolderModal'
import DeleteConfirmationModal from './DeleteConfirmationModal'

type Entry = (
  | { type: 'folder'; data: S3Folder }
  | { type: 'object'; data: S3ObjectItem }
)

function splitPrefix(prefix: string) {
  const parts = prefix.split('/').filter(Boolean)
  const crumbs = [{ label: 'root', value: '' }]
  let acc = ''
  for (const p of parts) {
    acc += p + '/'
    crumbs.push({ label: p, value: acc })
  }
  return crumbs
}

function formatSize(n: number) {
  const units = ['B','KB','MB','GB','TB']
  let i = 0; let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

// Icon components for files and folders
function FolderIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
    </svg>
  )
}

function FileIcon({ fileName, className = "w-4 h-4" }: { fileName: string; className?: string }) {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  
  // Image files
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(extension)) {
    return (
      <svg className={`${className} text-green-600 dark:text-green-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.5,13.5L11,16.5L14.5,12L19,18H5M21,19V5C21,3.89 20.1,3 19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19Z"/>
      </svg>
    )
  }
  
  // Video files
  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v'].includes(extension)) {
    return (
      <svg className={`${className} text-red-600 dark:text-red-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M17,10.5V7A1,1 0 0,0 16,6H4A1,1 0 0,0 3,7V17A1,1 0 0,0 4,18H16A1,1 0 0,0 17,17V13.5L21,17.5V6.5L17,10.5Z"/>
      </svg>
    )
  }
  
  // Audio files
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'].includes(extension)) {
    return (
      <svg className={`${className} text-purple-600 dark:text-purple-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>
      </svg>
    )
  }
  
  // Archive files
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) {
    return (
      <svg className={`${className} text-orange-600 dark:text-orange-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M14,17H12V15H14M14,13H12V11H14M12,9H14V7H12M14,5H12V3H14M10,7H12V5H10V7M7,3V5H5A2,2 0 0,0 3,7V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7A2,2 0 0,0 19,5H17V3H14V5H12V3H10V5H7V3H10V5H7Z"/>
      </svg>
    )
  }
  
  // Document files
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(extension)) {
    return (
      <svg className={`${className} text-blue-600 dark:text-blue-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M15,18V16H6V18H15M18,14V12H6V14H18Z"/>
      </svg>
    )
  }
  
  // Code files
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'py', 'java', 'c', 'cpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift'].includes(extension)) {
    return (
      <svg className={`${className} text-indigo-600 dark:text-indigo-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.4,16.6L4.8,12L9.4,7.4L8,6L2,12L8,18L9.4,16.6M14.6,16.6L19.2,12L14.6,7.4L16,6L22,12L16,18L14.6,16.6Z"/>
      </svg>
    )
  }
  
  // Spreadsheet files
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) {
    return (
      <svg className={`${className} text-emerald-600 dark:text-emerald-400`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M6,2A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6M6,4H13V9H18V20H6V4M8,12V14H16V12H8M8,16V18H13V16H8Z"/>
      </svg>
    )
  }
  
  // Default file icon
  return (
    <svg className={`${className} text-gray-600 dark:text-gray-400`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z"/>
    </svg>
  )
}

export default function ObjectExplorer() {
  const { connected, profile, bucket, prefix, setPrefix, selectedKey, selectedType, setSelected, setSelectedKey, setSelectedDetails, isSwitchingProfile, connectionError, openSettings } = useStore() as any
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching, refetch } = useObjects({ profile, bucket: bucket!, prefix, enabled: Boolean(bucket) })
  const listRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: Entry } | null>(null)
  const [showProps, setShowProps] = useState<{ type: 'object' | 'folder'; data: any } | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    item: Entry
    title: string
    message: string
  } | null>(null)
  // UI: filter and sorting state
  const [objectFilter, setObjectFilter] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'lastModified'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Reset prefix and selection when profile or bucket changes or when disconnected
  // This prevents stale buckets/objects from previous profile remaining visible
  // Note: relying on equality checks to avoid infinite loops
  useEffect(() => {
    if (!connected) {
      setPrefix('')
      setSelectedKey(undefined)
      return
    }
    // when bucket changes to undefined or different, reset prefix/selection
    setPrefix('')
    setSelectedKey(undefined)
  }, [connected, profile, bucket, setPrefix, setSelectedKey])

  // Listen for upload completion events to auto-refresh the object list
  useEffect(() => {
    if (!bucket) return
    
    // Track jobs to their bucket mapping
    const jobBuckets = new Map<string, string>()
    
    const unsubscribe = (window as any).api.transfers.onEvent((event: TransferEvent) => {
      if (event.type === 'job-state' && event.job) {
        // Track which bucket each job is for
        jobBuckets.set(event.job.id, event.job.bucket)
      } else if (event.type === 'job-complete') {
        // Check if this completed job was for the current bucket
        const jobBucket = jobBuckets.get(event.jobId)
        if (jobBucket === bucket) {
          // Slight delay to ensure S3 consistency
          setTimeout(() => {
            refetch()
          }, 500)
        }
        // Clean up the job tracking
        jobBuckets.delete(event.jobId)
      }
    })
    
    return unsubscribe
  }, [bucket, refetch])

  const items: Entry[] = useMemo(() => {
    const pages = data?.pages ?? []
    const entries: Entry[] = []
    for (const page of pages) {
      for (const f of page.folders) entries.push({ type: 'folder', data: f })
      for (const o of page.objects) entries.push({ type: 'object', data: o })
    }
    return entries
  }, [data])

  // Helpers for filter/sort
  const getName = (it: Entry) =>
    it.type === 'folder'
      ? it.data.prefix.split('/').filter(Boolean).slice(-1)[0] + '/'
      : it.data.key.split('/').slice(-1)[0]

  const filteredItems: Entry[] = useMemo(() => {
    const q = objectFilter.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => getName(it).toLowerCase().includes(q))
  }, [items, objectFilter])

  const visibleItems: Entry[] = useMemo(() => {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
    const dirMul = sortDir === 'asc' ? 1 : -1

    const folders = filteredItems.filter((it) => it.type === 'folder')
    const objects = filteredItems.filter((it) => it.type === 'object') as { type: 'object'; data: S3ObjectItem }[]

    // Folders are always listed before files; when sorting by size/date, sort folders by name
    folders.sort((a, b) => collator.compare(getName(a), getName(b)) * dirMul)

    objects.sort((a, b) => {
      if (sortBy === 'name') {
        return collator.compare(getName(a), getName(b)) * dirMul
      }
      if (sortBy === 'size') {
        const av = a.data.size ?? 0
        const bv = b.data.size ?? 0
        return (av === bv ? collator.compare(getName(a), getName(b)) : av - bv) * dirMul
      }
      // lastModified
      const at = a.data.lastModified ? new Date(a.data.lastModified as any).getTime() : 0
      const bt = b.data.lastModified ? new Date(b.data.lastModified as any).getTime() : 0
      return (at === bt ? collator.compare(getName(a), getName(b)) : at - bt) * dirMul
    })

    return [...folders, ...objects]
  }, [filteredItems, sortBy, sortDir])

  // Show a short, centered overlay while refetching to provide visual feedback
  const [showRefreshOverlay, setShowRefreshOverlay] = useState(false)
  const refreshStartRef = useRef<number | null>(null)
  useEffect(() => {
    const active = Boolean(bucket) && !isFetchingNextPage && isFetching && !isLoading && !connectionError
    if (active) {
      if (!showRefreshOverlay) {
        refreshStartRef.current = Date.now()
        setShowRefreshOverlay(true)
      }
    } else if (showRefreshOverlay) {
      const elapsed = (Date.now() - (refreshStartRef.current || Date.now()))
      const minMs = 500
      const delay = Math.max(0, minMs - elapsed)
      const t = setTimeout(() => setShowRefreshOverlay(false), delay)
      return () => clearTimeout(t)
    }
  }, [bucket, isFetching, isFetchingNextPage, isLoading, connectionError, showRefreshOverlay])

  function onDoubleClick(item: Entry) {
    if (item.type === 'folder') { trace('ui', 'open folder', { prefix: item.data.prefix }); setPrefix(item.data.prefix) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!visibleItems.length) return
    const idx = visibleItems.findIndex(it => it.type === 'object' ? it.data.key === selectedKey : it.data.prefix === selectedKey)
    if (e.key === 'ArrowDown') {
      const next = Math.min((idx < 0 ? 0 : idx + 1), visibleItems.length - 1)
      const it = visibleItems[next]
      setSelected(it.type === 'object' ? it.data.key : it.data.prefix, it.type)
      setSelectedDetails(it.type === 'object' ? { type: 'object', object: (it as any).data } : { type: 'folder', folder: (it as any).data })
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      const prev = Math.max((idx < 0 ? 0 : idx - 1), 0)
      const it = visibleItems[prev]
      setSelected(it.type === 'object' ? it.data.key : it.data.prefix, it.type)
      setSelectedDetails(it.type === 'object' ? { type: 'object', object: (it as any).data } : { type: 'folder', folder: (it as any).data })
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const it = visibleItems[Math.max(idx, 0)]
      if (it && it.type === 'folder') { trace('ui', 'kb open folder', { prefix: it.data.prefix }); setPrefix(it.data.prefix) }
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (!bucket) { trace('ui', 'drag ignored no bucket'); return }
    e.preventDefault()
    try { e.dataTransfer.dropEffect = 'copy' } catch {}
    trace('ui', 'drag over', { bucket, prefix, selectedKey })
  }

  async function onDrop(e: React.DragEvent) {
    if (!bucket) { trace('ui', 'drop ignored no bucket'); return }
    e.preventDefault()
    trace('ui', 'drop start', { bucket, prefix, selectedKey })

    // Get the files from the drop event
    const fileList = Array.from(e.dataTransfer?.files || []) as File[]
    if (fileList.length === 0) {
      trace('ui', 'drop no files')
      return
    }

    // Extract file metadata - add debugging to see what's available
    const fileData = fileList.map((f, i) => {
      const fileObj = f as any
      trace('ui', `file ${i} debug`, { 
        name: f.name, 
        size: f.size, 
        type: f.type,
        path: fileObj.path,
        webkitRelativePath: fileObj.webkitRelativePath,
        keys: Object.getOwnPropertyNames(fileObj)
      })
      
      return {
        name: f.name,
        path: fileObj.path || '',
        size: f.size,
        type: f.type
      }
    })

    // Debug dataTransfer contents
    try {
      const types = Array.from(e.dataTransfer?.types || [])
      trace('ui', 'dataTransfer types', { types })
      
      for (const type of types) {
        try {
          const data = e.dataTransfer?.getData(type) || ''
          trace('ui', `dataTransfer[${type}]`, { data: data.substring(0, 200) })
        } catch (err) {
          trace('ui', `dataTransfer[${type}] error`, { error: String(err) })
        }
      }
    } catch (err) {
      trace('ui', 'dataTransfer access error', { error: String(err) })
    }

    trace('ui', 'drop files detected', { 
      count: fileData.length, 
      files: fileData.map(f => ({ name: f.name, size: f.size, hasPath: Boolean(f.path), path: f.path }))
    })

    try {
      // Process the dropped files through the main process
      const processedFiles = await (window as any).api.ui.processDroppedFiles(fileList)
      
      if (processedFiles.length === 0) {
        trace('ui', 'drop user canceled file selection')
        return
      }

      trace('ui', 'drop processed files', { 
        count: processedFiles.length, 
        withPath: processedFiles.filter((f: any) => f.path).length,
        files: processedFiles.map((f: any) => ({ name: f.name, path: f.path, size: f.size }))
      })

      // Proceed with upload
      const targetPrefix = selectedKey && items.find(it => it.type === 'folder' && it.data.prefix === selectedKey) ? selectedKey : prefix
      trace('ui', 'upload start', { bucket, prefix: targetPrefix, files: processedFiles.map(f => f.name).slice(0, 5), more: Math.max(0, processedFiles.length - 5) })
      
      const res = await (window as any).api.transfers.startUpload({ bucket, prefix: targetPrefix, files: processedFiles })
      if (!res?.ok) {
        trace('ui', 'upload failed to start', { error: res?.error || 'unknown' })
      } else {
        trace('ui', 'upload job created', { jobId: res.jobId })
      }
    } catch (error) {
      trace('ui', 'drop error', { error: (error as Error)?.message || 'unknown' })
    }
  }

  function onContextMenu(e: React.MouseEvent, item: Entry) {
    e.preventDefault()
    setSelected(item.type === 'object' ? item.data.key : item.data.prefix, item.type)
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  async function handleDownload(item?: Entry) {
    const it = item || (items.find(it => (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey))
    if (!it) return
    try {
      const dest = await (window as any).api.ui.pickDirectory({ title: 'Select download folder' })
      if (!dest) return
      if (it.type === 'folder') {
        await (window as any).api.transfers.startPrefixDownload({ bucket, prefix: it.data.prefix, destDir: dest })
      } else {
        await (window as any).api.transfers.startObjectDownload({ bucket, key: it.data.key, destDir: dest })
      }
    } finally {
      setContextMenu(null)
    }
  }

  function handleProperties(item?: Entry) {
    const it = item || (items.find(it => (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey))
    if (!it) return
    setShowProps({ type: it.type, data: it.data })
    setContextMenu(null)
  }

  const handleCreateFolder = async (folderName: string) => {
    const folderPrefix = prefix + folderName
    const result = await (window as any).api.s3.createFolder({ bucket, prefix: folderPrefix })
    if (!result.ok) {
      throw new Error(result.error)
    }
    // Refresh the object list
    await refetch()
  }

  const handleDelete = (item: Entry) => {
    const isFolder = item.type === 'folder'
    const name = isFolder ? item.data.prefix : item.data.key
    
    setDeleteConfirmation({
      item,
      title: `Delete ${isFolder ? 'Folder' : 'File'}`,
      message: `Are you sure you want to delete "${name}"?${isFolder ? ' This will delete all objects in the folder.' : ''}`
    })
    setContextMenu(null)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmation) return
    
    const { item } = deleteConfirmation
    
    if (item.type === 'folder') {
      const result = await (window as any).api.s3.deleteFolder({ bucket, prefix: item.data.prefix })
      if (!result.ok) {
        throw new Error(result.error)
      }
    } else {
      const result = await (window as any).api.s3.deleteObject({ bucket, key: item.data.key })
      if (!result.ok) {
        throw new Error(result.error)
      }
    }
    
    // Clear selection if we deleted the selected item
    const deletedKey = item.type === 'object' ? item.data.key : item.data.prefix
    if (selectedKey === deletedKey) {
  setSelected(undefined, undefined)
  setSelectedDetails(undefined)
    }
    
    // Refresh the object list
    await refetch()
  }

  const crumbs = splitPrefix(prefix)
  const parentPrefix = prefix.split('/').slice(0, -2).join('/') + (prefix ? '/' : '')
  const toggleSort = (field: 'name' | 'size' | 'lastModified') => {
    if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }
  const sortIndicator = (field: 'name' | 'size' | 'lastModified') => sortBy === field ? (sortDir === 'asc' ? '▲' : '▼') : ''

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center bg-panel">
        <div className="text-center p-6">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-neutral-100 dark:bg-[#2a2d2e] flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 opacity-70"><path d="M3 12h2a7 7 0 0 1 7-7V3A9 9 0 0 0 3 12zm2 0H3a9 9 0 0 0 9 9v-2a7 7 0 0 1-7-7zm16 0a9 9 0 0 0-9-9v2a7 7 0 0 1 7 7h2zm-2 0a7 7 0 0 1-7 7v2a9 9 0 0 0 9-9h-2z"/></svg>
          </div>
          <h2 className="text-lg font-semibold mb-2">Not connected</h2>
          <p className="text-sm opacity-80">Select a profile from the top bar to connect.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-panel" onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop} tabIndex={0} ref={listRef}>
      <div className="border-b border-default px-3 py-2 flex items-center gap-2 text-sm bg-header text-app">
        <div className="opacity-70">{bucket ? `${bucket}` : 'No bucket selected'}</div>
        <div className="ml-2">/</div>
        <div className="flex items-center gap-1 flex-wrap">
      {crumbs.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
  <button className="hover:underline cursor-pointer link-accent" onClick={() => { trace('ui', 'breadcrumb click', { value: c.value }); setPrefix(c.value) }}>{c.label}</button>
              {i < crumbs.length - 1 && <span className="opacity-50">/</span>}
            </div>
          ))}
        </div>
  <div className="ml-auto flex items-center gap-2">
          {/* Filter input */}
          <div className="relative">
            <input
              type="text"
              value={objectFilter}
              onChange={(e) => setObjectFilter(e.target.value)}
              placeholder="Filter objects…"
              className="h-7 w-56 px-2 pr-6 rounded border input-theme text-sm placeholder:text-muted"
            />
            {objectFilter && (
              <button
                onClick={() => setObjectFilter('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-app"
                aria-label="Clear filter"
              >×</button>
            )}
          </div>
          {bucket && (
            <>
              <button
                onClick={() => refetch()}
                className="text-xs px-2 py-1 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors cursor-pointer"
                title="Refresh folder contents"
              >
                ↻ Refresh
              </button>
              <button
                onClick={() => setShowCreateFolder(true)}
                className="text-xs px-2 py-1 bg-[#16a085] text-white rounded hover:bg-[#1abc9c] transition-colors cursor-pointer"
                title="Create new folder"
              >
                + Folder
              </button>
              <button
                onClick={async () => {
                  try {
                    const dest = await (window as any).api.ui.pickDirectory({ title: 'Select download folder' })
                    if (!dest) return
                    await handleDownload()
                  } catch (e) {
                    console.error('download failed', e)
                  }
                }}
                className="text-xs px-2 py-1 bg-[#8e44ad] text-white rounded hover:bg-[#9b59b6] transition-colors disabled:opacity-50 cursor-pointer"
                title="Download selected item"
                disabled={!selectedKey}
              >
                ↓ Download
              </button>
            </>
          )}
    {prefix && <button className="text-xs underline cursor-pointer link-accent" onClick={() => { trace('ui', 'up'); setPrefix(parentPrefix) }}>Up</button>}
        </div>
      </div>

  {/* Main content area */}
  <div className="relative flex-1 overflow-auto bg-panel" onClick={(e) => {
        // Only deselect if clicking directly on the container, not on any child elements
        if (e.target === e.currentTarget) {
          trace('ui', 'deselect on background click')
          setSelected(undefined, undefined)
          setSelectedDetails(undefined)
        }
      }}>
        {showRefreshOverlay && (
          <div className="absolute inset-0 z-10 flex items-center justify-center overlay-bg pointer-events-none">
            <svg className="h-8 w-8 animate-spin text-[#0e639c] dark:text-[#3794ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <circle cx="12" cy="12" r="9" strokeWidth="3" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" strokeWidth="3" />
            </svg>
            <span className="sr-only">Refreshing</span>
          </div>
        )}
        {connectionError && (
          <div className="h-full w-full flex items-center justify-center p-6">
            <div className="max-w-2xl text-center">
              <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M11 15h2v2h-2zm0-8h2v6h-2z"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
              </div>
              <h2 className="text-lg font-semibold mb-2">Connection failed</h2>
              <p className="text-sm opacity-80 mb-4">{connectionError}</p>
              <div className="flex items-center justify-center gap-3">
                <button className="px-3 py-1 text-sm rounded bg-[#0e639c] text-white hover:bg-[#1177bb] cursor-pointer" onClick={() => refetch()}>Retry</button>
                <button className="px-3 py-1 text-sm rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer" onClick={() => openSettings()}>Settings</button>
              </div>
            </div>
          </div>
        )}
  {!connectionError && isSwitchingProfile && <div className="px-3 py-2 text-sm opacity-70">Switching profile…</div>}
  {!connectionError && isLoading && <div className="px-3 py-2 text-sm">Loading…</div>}
        {!connectionError && isError && (
          <div className="px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-3">
            <span>{(error as Error)?.message || 'Failed to load objects.'}</span>
            <button onClick={() => refetch()} className="underline cursor-pointer">Retry</button>
          </div>
        )}
  {/* query-specific errors are shown below; connectionError is also surfaced above */}
        {/* Only render the objects table when there's no error and a bucket is selected */}
  {!connectionError && !isSwitchingProfile && !isError && bucket && (
          <table className="min-w-full text-sm bg-panel text-app">
            <thead className="sticky top-0 bg-header border-b border-default text-app">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">
                  <button className="flex items-center gap-1 hover:underline" onClick={() => toggleSort('name')}>
                    Name <span className="opacity-70">{sortIndicator('name')}</span>
                  </button>
                </th>
                <th className="px-3 py-2 w-32 font-medium">
                  <button className="flex items-center gap-1 hover:underline" onClick={() => toggleSort('size')}>
                    Size <span className="opacity-70">{sortIndicator('size')}</span>
                  </button>
                </th>
                <th className="px-3 py-2 w-48 font-medium">
                  <button className="flex items-center gap-1 hover:underline" onClick={() => toggleSort('lastModified')}>
                    Last Modified <span className="opacity-70">{sortIndicator('lastModified')}</span>
                  </button>
                </th>
                <th className="px-3 py-2 w-48 font-medium">Storage Class</th>
              </tr>
            </thead>
            <tbody className="bg-panel" onClick={(e) => {
              // Deselect when clicking on tbody but not on a row
              if (e.target === e.currentTarget) {
                trace('ui', 'deselect on table body click')
                setSelected(undefined, undefined)
                setSelectedDetails(undefined)
              }
            }}>
              {visibleItems.map((it, i) => {
                const isSel = (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey
                const name = it.type === 'folder' ? it.data.prefix.split('/').filter(Boolean).slice(-1)[0] + '/' : it.data.key.split('/').slice(-1)[0]
                return (
  <tr key={(it.type === 'object' ? 'o:' + it.data.key : 'f:' + it.data.prefix)} className={`${isSel ? 'selected-row' : 'row-hover'} cursor-default border-b border-default`} onDoubleClick={() => onDoubleClick(it)} onClick={() => { trace('ui', 'select item', { key: it.type === 'object' ? it.data.key : it.data.prefix }); setSelected(it.type === 'object' ? it.data.key : it.data.prefix, it.type); setSelectedDetails(it.type === 'object' ? { type: 'object', object: it.data } : { type: 'folder', folder: it.data }) }} onContextMenu={(e) => onContextMenu(e, it)}>
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        {it.type === 'folder' ? (
                          <FolderIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        ) : (
                          <FileIcon fileName={name} className="w-4 h-4 flex-shrink-0" />
                        )}
                        <span className="truncate">{name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{it.type === 'object' ? formatSize(it.data.size) : '-'}</td>
                    <td className="px-3 py-2">{it.type === 'object' && it.data.lastModified ? new Date(it.data.lastModified).toLocaleString() : '-'}</td>
                    <td className="px-3 py-2">{it.type === 'object' ? (it.data.storageClass ?? '') : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    {hasNextPage && (
          <div className="px-3 py-3">
  <button disabled={isFetchingNextPage} onClick={() => { trace('ui', 'load more'); fetchNextPage() }} className="px-3 py-1 rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

  {/* Details moved to bottom panel */}

      {contextMenu && (
        <div className="fixed z-50 menu-bg border border-default rounded shadow text-sm"
             style={{ left: contextMenu.x, top: contextMenu.y }}
             onClick={() => setContextMenu(null)}
        >
          <button className="block w-full text-left px-3 py-2 row-hover cursor-pointer" onClick={() => handleDownload(contextMenu.item)}>Download</button>
          <button className="block w-full text-left px-3 py-2 row-hover cursor-pointer" onClick={() => handleProperties(contextMenu.item)}>Properties</button>
          <div className="border-t border-default"></div>
          <button className="block w-full text-left px-3 py-2 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 cursor-pointer" onClick={() => handleDelete(contextMenu.item)}>
            Delete
          </button>
        </div>
      )}

  {showProps && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowProps(null)} />
      <div className="relative z-10 w-[560px] max-w-[95vw] rounded menu-bg border border-default p-4 shadow">
            <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">Properties</div>
              <button className="px-2 py-1 text-xs bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] rounded cursor-pointer" onClick={() => setShowProps(null)}>Close</button>
            </div>
            {showProps.type === 'folder' ? (
      <div className="text-sm opacity-70">Use bottom Properties tab for details.</div>
            ) : (
              <div className="space-y-2 text-sm">
                <div><span className="opacity-70">Key:</span> <span className="font-mono break-all">{showProps.data.key}</span></div>
                <div><span className="opacity-70">Size:</span> {formatSize(showProps.data.size)}</div>
                <div><span className="opacity-70">Last modified:</span> {showProps.data.lastModified ? new Date(showProps.data.lastModified).toLocaleString() : '-'}</div>
                <div><span className="opacity-70">ETag:</span> <span className="font-mono">{showProps.data.etag ?? ''}</span></div>
                <div><span className="opacity-70">Storage class:</span> {showProps.data.storageClass ?? ''}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreateFolder={handleCreateFolder}
        currentPrefix={prefix}
      />

      <DeleteConfirmationModal
        isOpen={!!deleteConfirmation}
        onClose={() => setDeleteConfirmation(null)}
        onConfirm={confirmDelete}
        title={deleteConfirmation?.title || ''}
        message={deleteConfirmation?.message || ''}
        itemType={deleteConfirmation?.item.type === 'folder' ? 'folder' : 'file'}
      />
    </div>
  )
}
