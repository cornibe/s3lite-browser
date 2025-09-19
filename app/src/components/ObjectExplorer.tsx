import React, { useMemo, useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useObjects } from '../lib/query'
import { useStore } from '../lib/store'
import type { S3ObjectItem, S3Folder, TransferEvent } from '../../electron/types'
import { trace, debug, info } from '../lib/log'
import CreateFolderModal from './CreateFolderModal'
import DeleteConfirmationModal from './DeleteConfirmationModal'

type Entry = (
  | { type: 'folder'; data: S3Folder }
  | { type: 'object'; data: S3ObjectItem }
)

function splitPrefix(prefix: string) {
  const parts = prefix.split('/').filter(Boolean)
  let acc = ''
  return parts.map((p) => { acc += p + '/'; return { label: p, value: acc } })
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

function CopyIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>
    </svg>
  )
}

export default function ObjectExplorer() {
  const { connected, profile, bucket, prefix, setPrefix, selectedKey, selectedType, setSelected, setSelectedKey, setSelectedDetails, isSwitchingProfile, connectionError, openSettings, registerJobForActiveTab } = useStore() as any
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching, refetch } = useObjects({ profile, bucket: bucket!, prefix, enabled: Boolean(bucket) })
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastDragPointRef = useRef<{ x: number; y: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const copyBtnRef = useRef<HTMLButtonElement | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  // Drop/upload feedback toast
  const [dropFeedback, setDropFeedback] = useState<{ stage: 'preparing' | 'starting' | 'queued' | 'error'; message: string } | null>(null)
  const dropFeedbackTimer = useRef<number | undefined>(undefined)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: Entry } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement | null>(null)
  const [showProps, setShowProps] = useState<{ type: 'object' | 'folder'; data: any } | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    items: Entry[]
    title: string
    message: string
  } | null>(null)
  // UI: filter and sorting state
  const [objectFilter, setObjectFilter] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'lastModified'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Multi-select state (local to explorer)
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set())
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  // Ensure UI has a chance to paint before continuing heavy work
  const yieldToPaint = async () => {
    // Two rafs + short timeout helps on Electron where single RAF can be coalesced
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => setTimeout(r, 0))
  }

  // Refs to latest values for global drop handlers (avoid stale closure)
  const bucketRef = useRef(bucket)
  const prefixRef = useRef(prefix)
  const selectedKeyRef = useRef<string | undefined>(selectedKey)
  const itemsRef = useRef<Entry[]>([])
  const registerJobRef = useRef(registerJobForActiveTab)
  useEffect(() => { bucketRef.current = bucket }, [bucket])
  useEffect(() => { prefixRef.current = prefix }, [prefix])
  useEffect(() => { selectedKeyRef.current = selectedKey }, [selectedKey])
  useEffect(() => { registerJobRef.current = registerJobForActiveTab }, [registerJobForActiveTab])
  // Cleanup feedback timer on unmount
  useEffect(() => {
    return () => { if (dropFeedbackTimer.current) window.clearTimeout(dropFeedbackTimer.current) }
  }, [])

  // Reset prefix and selection when disconnected to avoid stale UI
  // Bucket selection elsewhere (store.selectBucket) already clears prefix by default.
  // We avoid clearing on every bucket change here so mounted paths can set a prefix.
  useEffect(() => {
    if (!connected) {
      setPrefix('')
      setSelectedKey(undefined)
    }
  }, [connected, setPrefix, setSelectedKey])

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
  // Keep itemsRef in sync for global drop handler
  useEffect(() => { itemsRef.current = items }, [items])

  const keyOf = (it: Entry) => it.type === 'object' ? `o:${(it as any).data.key}` : `f:${(it as any).data.prefix}`
  const keyToEntry = useMemo(() => {
    const m = new Map<string, Entry>()
    for (const it of items) m.set(keyOf(it), it)
    return m
  }, [items])

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

  // Clear local multi-selection when prefix changes
  useEffect(() => {
    setSelectedSet(new Set())
    setAnchorIndex(null)
    setFocusedIndex(null)
  }, [prefix])

  function onDoubleClick(item: Entry) {
    if (item.type === 'folder') { trace('ui', 'open folder', { prefix: item.data.prefix }); setPrefix(item.data.prefix) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!visibleItems.length) return
    const currentIdx = focusedIndex ?? visibleItems.findIndex(it => it.type === 'object' ? it.data.key === selectedKey : it.data.prefix === selectedKey)
    if (e.key === 'ArrowDown') {
      const next = Math.min((currentIdx < 0 ? 0 : currentIdx + 1), visibleItems.length - 1)
      const it = visibleItems[next]
      if (e.shiftKey) {
        const from = (anchorIndex ?? (currentIdx < 0 ? next : currentIdx))
        const [lo, hi] = from <= next ? [from, next] : [next, from]
        const newSet = new Set<string>()
        for (let i = lo; i <= hi; i++) newSet.add(keyOf(visibleItems[i]))
        setSelectedSet(newSet)
        setFocusedIndex(next)
        setAnchorIndex(from)
      } else {
        setSelectedSet(new Set([keyOf(it)]))
        setAnchorIndex(next)
        setFocusedIndex(next)
      }
      setSelected(it.type === 'object' ? it.data.key : it.data.prefix, it.type)
      setSelectedDetails(it.type === 'object' ? { type: 'object', object: (it as any).data } : { type: 'folder', folder: (it as any).data })
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      const prev = Math.max((currentIdx < 0 ? 0 : currentIdx - 1), 0)
      const it = visibleItems[prev]
      if (e.shiftKey) {
        const from = (anchorIndex ?? (currentIdx < 0 ? prev : currentIdx))
        const [lo, hi] = from <= prev ? [from, prev] : [prev, from]
        const newSet = new Set<string>()
        for (let i = lo; i <= hi; i++) newSet.add(keyOf(visibleItems[i]))
        setSelectedSet(newSet)
        setFocusedIndex(prev)
        setAnchorIndex(from)
      } else {
        setSelectedSet(new Set([keyOf(it)]))
        setAnchorIndex(prev)
        setFocusedIndex(prev)
      }
      setSelected(it.type === 'object' ? it.data.key : it.data.prefix, it.type)
      setSelectedDetails(it.type === 'object' ? { type: 'object', object: (it as any).data } : { type: 'folder', folder: (it as any).data })
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const idx = Math.max(currentIdx, 0)
      const it = visibleItems[idx]
      if (it && it.type === 'folder') { trace('ui', 'kb open folder', { prefix: it.data.prefix }); setPrefix(it.data.prefix) }
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (!bucket) { trace('ui', 'drag ignored no bucket'); return }
    e.preventDefault()
    try { e.dataTransfer.dropEffect = 'copy' } catch {}
    trace('ui', 'react drag over', { 
      bucket, 
      prefix, 
      selectedKey, 
      target: (e.target as Element)?.tagName,
      targetClass: (e.target as Element)?.className
    })
  }

  // Shared upload logic used by both React drop handler and window-level drop
  type DropSnapshot = { bucket?: string; prefix: string; selectedKey?: string; items: Entry[] }
  function getSnapshot(): DropSnapshot {
    return { bucket: bucketRef.current, prefix: prefixRef.current, selectedKey: selectedKeyRef.current, items: itemsRef.current }
  }

  async function startUploadFromFileList(fileList: File[], snap: DropSnapshot = getSnapshot()) {
    const { bucket: bkt, prefix: pfx, selectedKey: sel, items: its } = snap
    if (!bkt) { info('ui', 'drop ignored no bucket'); return }
    info('ui', 'drop start', { bucket: bkt, prefix: pfx, selectedKey: sel })

    if (fileList.length === 0) { trace('ui', 'drop no files'); return }

  // Immediate user feedback: preparing files
  const prepMsg = `Preparing ${fileList.length} ${fileList.length === 1 ? 'file' : 'files'}…`
  setDropFeedback({ stage: 'preparing', message: prepMsg })
  await yieldToPaint()

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
      return { name: f.name, path: fileObj.path || '', size: f.size, type: f.type }
    })

    // Debug dataTransfer types is only available in the event; skip here
  info('ui', 'drop files detected', {
      count: fileData.length,
      files: fileData.map(f => ({ name: f.name, size: f.size, hasPath: Boolean(f.path), path: f.path }))
    })

    try {
      const processedFiles = await (window as any).api.ui.processDroppedFiles(fileList)
      if (processedFiles.length === 0) {
        info('ui', 'drop user canceled file selection')
        // Hide feedback quickly if cancelled
        setDropFeedback(null)
        return
      }
  setDropFeedback({ stage: 'starting', message: `Starting upload of ${processedFiles.length} ${processedFiles.length === 1 ? 'file' : 'files'}…` })
  await yieldToPaint()
      info('ui', 'drop processed files', {
        count: processedFiles.length,
        withPath: processedFiles.filter((f: any) => f.path).length,
        files: processedFiles.map((f: any) => ({ name: f.name, path: f.path, size: f.size }))
      })
      const targetPrefix = sel && its.find(it => it.type === 'folder' && it.data.prefix === sel) ? sel : pfx
      info('ui', 'upload start', { bucket: bkt, prefix: targetPrefix, files: processedFiles.map((f: any) => f.name).slice(0, 5), more: Math.max(0, processedFiles.length - 5) })
      const res = await (window as any).api.transfers.startUpload({ bucket: bkt, prefix: targetPrefix, files: processedFiles })
      if (!res?.ok) {
        info('ui', 'upload failed to start', { error: res?.error || 'unknown' })
        setDropFeedback({ stage: 'error', message: `Failed to start upload: ${res?.error || 'unknown'}` })
        if (dropFeedbackTimer.current) window.clearTimeout(dropFeedbackTimer.current)
        dropFeedbackTimer.current = window.setTimeout(() => setDropFeedback(null), 3000)
      } else {
        info('ui', 'upload job created', { jobId: res.jobId })
        registerJobRef.current(res.jobId)
        setDropFeedback({ stage: 'queued', message: `Upload queued • ${processedFiles.length} ${processedFiles.length === 1 ? 'file' : 'files'}` })
        if (dropFeedbackTimer.current) window.clearTimeout(dropFeedbackTimer.current)
        dropFeedbackTimer.current = window.setTimeout(() => setDropFeedback(null), 1500)
      }
    } catch (error) {
      trace('ui', 'drop error', { error: (error as Error)?.message || 'unknown' })
      setDropFeedback({ stage: 'error', message: `Error preparing files: ${(error as Error)?.message || 'unknown'}` })
      if (dropFeedbackTimer.current) window.clearTimeout(dropFeedbackTimer.current)
      dropFeedbackTimer.current = window.setTimeout(() => setDropFeedback(null), 3000)
    }
  }

  // Fallback: in some environments, DataTransfer.files can be empty.
  // Try to parse file paths from text/uri-list or text/plain.
  function convFileUriToPath(uri: string): string | null {
    try {
      if (!uri) return null
      if (uri.startsWith('file://')) {
        // Remove 'file:///' prefix; keep drive letter on Windows
        let p = uri.replace(/^file:\/\//i, '')
        // On Windows, leading slash may precede drive (e.g., /C:/path)
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
        // Decode percent-escapes
        p = decodeURI(p)
        // Convert forward slashes to backslashes on Windows
        if (/^[A-Za-z]:/.test(p)) p = p.replace(/\//g, '\\')
        return p
      }
      // Plain path
      return uri
    } catch {
      return null
    }
  }
  function extractPathsFromDataTransfer(dt: DataTransfer | null): string[] {
    const out: string[] = []
    if (!dt) return out
    try {
      const uriList = dt.getData('text/uri-list')
      if (uriList) {
        for (const line of uriList.split(/\r?\n/)) {
          const s = line.trim()
          if (!s || s.startsWith('#')) continue
          const p = convFileUriToPath(s)
          if (p) out.push(p)
        }
      }
    } catch {}
    try {
      const plain = dt.getData('text/plain')
      if (plain) {
        for (const line of plain.split(/\r?\n/)) {
          const s = line.trim()
          if (!s) continue
          // Heuristic: path-like or file URI
          if (s.startsWith('file://') || /^[A-Za-z]:\\/.test(s) || s.startsWith('\\\\')) {
            const p = convFileUriToPath(s)
            if (p) out.push(p)
          }
        }
      }
    } catch {}
    // Deduplicate
    return Array.from(new Set(out))
  }

  async function onDrop(e: React.DragEvent) {
    if (!bucket) { trace('ui', 'drop ignored no bucket'); return }
    e.preventDefault()
    info('ui', 'react drop event', {
      target: (e.target as Element)?.tagName,
      targetClass: (e.target as Element)?.className,
      targetId: (e.target as Element)?.id
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
    let fileList = Array.from(e.dataTransfer?.files || []) as File[]
    if (fileList.length === 0) {
      const paths = extractPathsFromDataTransfer(e.dataTransfer || null)
      if (paths.length) {
        info('ui', 'fallback paths from dataTransfer', { count: paths.length })
        // Create File-like objects with path and inferred name/size unknown (size may be 0 until processed)
        fileList = paths.map(p => ({ name: p.split(/[\\/]/).pop() || 'file', size: 0, type: '', arrayBuffer: async () => new ArrayBuffer(0) } as any))
        // processDroppedFiles expects File[], but we only need .name and a resolvable .path via preload
        ;(fileList as any).forEach((f: any, i: number) => { f.path = paths[i] })
      }
    }
  info('ui', 'react drop processing files', { count: fileList.length })
  // Fire-and-forget so the event can return and UI can paint feedback sooner
  void startUploadFromFileList(fileList)
  }

  // Add global dragover/drop listeners to prevent Electron navigation and
  // ensure the explorer accepts drops even when UI structure changes (tabs etc.)
  useEffect(() => {
    function onWindowDragOver(ev: DragEvent) {
      // Always prevent default so the OS indicates copy and Electron doesn't disallow
      ev.preventDefault()
      const x = (ev as any).clientX; const y = (ev as any).clientY
      if (typeof x === 'number' && typeof y === 'number') lastDragPointRef.current = { x, y }
      try { if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy' } catch {}
      trace('ui', 'window dragover', { x, y, target: (ev.target as Element)?.tagName })
    }
    function onWindowDragEnter(ev: DragEvent) {
      ev.preventDefault()
      const x = (ev as any).clientX; const y = (ev as any).clientY
      if (typeof x === 'number' && typeof y === 'number') lastDragPointRef.current = { x, y }
      try { if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy' } catch {}
    }
    function onWindowDrop(ev: DragEvent) {
      // Prevent default navigation behavior
      ev.preventDefault()
      ev.stopPropagation()
      const target = ev.target as Node | null
      const targetElement = target as Element | null
      info('ui', 'window drop event', { 
        x: (ev as any).clientX, 
        y: (ev as any).clientY,
        target: targetElement?.tagName,
        targetClass: targetElement?.className,
        targetId: targetElement?.id
      })
      
      let withinExplorer = false
      const point = (typeof (ev as any).clientX === 'number' && typeof (ev as any).clientY === 'number')
        ? { x: (ev as any).clientX as number, y: (ev as any).clientY as number }
        : (lastDragPointRef.current || null)
      
      const testRect = (el: HTMLElement | null) => {
        if (!el || !point) return false
        const r = el.getBoundingClientRect()
        const isWithin = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom
        info('ui', 'rect test', { 
          element: el.className || el.tagName,
          rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
          point,
          isWithin
        })
        return isWithin
      }
      
      if (testRect(contentRef.current) || testRect(listRef.current)) {
        withinExplorer = true
        info('ui', 'within explorer by rect test')
      }
      
      // Fallback to DOM containment if available
      if (!withinExplorer && target && (contentRef.current?.contains(target) || listRef.current?.contains(target))) {
        withinExplorer = true
        info('ui', 'within explorer by DOM containment')
      }
      
      info('ui', 'drop analysis', { withinExplorer, hasContentRef: !!contentRef.current, hasListRef: !!listRef.current })
      
      if (!withinExplorer) {
        info('ui', 'drop ignored - outside explorer area')
        return
      }
      
      info('ui', 'window drop inside explorer')
      let files = Array.from(ev.dataTransfer?.files || []) as File[]
      if (files.length === 0) {
        const paths = extractPathsFromDataTransfer(ev.dataTransfer || null)
        if (paths.length) {
          info('ui', 'fallback paths from dataTransfer(window)', { count: paths.length })
          files = paths.map(p => ({ name: p.split(/[\\/]/).pop() || 'file', size: 0, type: '', arrayBuffer: async () => new ArrayBuffer(0) } as any))
          ;(files as any).forEach((f: any, i: number) => { f.path = paths[i] })
        }
      }
      info('ui', 'processing files', { count: files.length })
      // Delegate to shared logic
      startUploadFromFileList(files, getSnapshot())
    }
    window.addEventListener('dragover', onWindowDragOver, { capture: true })
    window.addEventListener('dragenter', onWindowDragEnter, { capture: true })
    window.addEventListener('drop', onWindowDrop, { capture: true })
    document.addEventListener('dragover', onWindowDragOver, { capture: true })
    document.addEventListener('dragenter', onWindowDragEnter, { capture: true })
    document.addEventListener('drop', onWindowDrop, { capture: true })
    return () => {
      window.removeEventListener('dragover', onWindowDragOver, { capture: true } as any)
      window.removeEventListener('dragenter', onWindowDragEnter, { capture: true } as any)
      window.removeEventListener('drop', onWindowDrop, { capture: true } as any)
      document.removeEventListener('dragover', onWindowDragOver, { capture: true } as any)
      document.removeEventListener('dragenter', onWindowDragEnter, { capture: true } as any)
      document.removeEventListener('drop', onWindowDrop, { capture: true } as any)
    }
    // It's safe to omit deps (we only need current ref and functions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onUploadFilesSelected(files: FileList | null) {
    if (!bucket) return
    if (!files || files.length === 0) return
    try {
      const fileArr = Array.from(files)
      const processedFiles = await (window as any).api.ui.processDroppedFiles(fileArr)
      if (!processedFiles || processedFiles.length === 0) return
      const targetPrefix = selectedKey && items.find(it => it.type === 'folder' && it.data.prefix === selectedKey) ? selectedKey : prefix
      const res = await (window as any).api.transfers.startUpload({ bucket, prefix: targetPrefix, files: processedFiles })
      if (res?.ok && res.jobId) registerJobForActiveTab(res.jobId)
    } catch (e) {
      console.error('upload failed', e)
    } finally {
      // Reset input so selecting the same file again triggers onChange
      try { if (uploadInputRef.current) uploadInputRef.current.value = '' } catch {}
    }
  }

  function onContextMenu(e: React.MouseEvent, item: Entry) {
    e.preventDefault()
    setSelected(item.type === 'object' ? item.data.key : item.data.prefix, item.type)
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  // Close context menu on outside click or Escape
  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      if (!contextMenu) return
      const el = ctxMenuRef.current
      if (el && !el.contains(ev.target as Node)) {
        setContextMenu(null)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && contextMenu) setContextMenu(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  async function handleDownload(item?: Entry) {
    // If explicit item provided, download just that one; otherwise prefer multi-select if present
    const selectedKeys = item ? [keyOf(item)] : Array.from(selectedSet)
    let entries: Entry[]
    if (selectedKeys.length > 0) {
      entries = selectedKeys.map(k => keyToEntry.get(k)!).filter(Boolean)
    } else {
      const it = items.find(it => (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey)
      if (!it) return
      entries = [it]
    }
    try {
      const dest = await (window as any).api.ui.pickDirectory({ title: entries.length > 1 ? `Select download folder (${entries.length} items)` : 'Select download folder' })
      if (!dest) return
      for (const ent of entries) {
        if (ent.type === 'folder') {
          const res = await (window as any).api.transfers.startPrefixDownload({ bucket, prefix: ent.data.prefix, destDir: dest })
          if (res?.ok && res.jobId) registerJobForActiveTab(res.jobId)
        } else {
          const res = await (window as any).api.transfers.startObjectDownload({ bucket, key: ent.data.key, destDir: dest })
          if (res?.ok && res.jobId) registerJobForActiveTab(res.jobId)
        }
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
      items: [item],
      title: `Delete ${isFolder ? 'Folder' : 'File'}`,
      message: `Are you sure you want to delete "${name}"?${isFolder ? ' This will delete all objects in the folder.' : ''}`
    })
    setContextMenu(null)
  }

  const handleDeleteSelected = () => {
    const keys = Array.from(selectedSet)
    if (keys.length === 0) return
    const entries = keys.map(k => keyToEntry.get(k)!).filter(Boolean)
    const fileCount = entries.filter(e => e.type === 'object').length
    const folderCount = entries.filter(e => e.type === 'folder').length
    const title = `Delete ${keys.length} selected item${keys.length > 1 ? 's' : ''}`
    const message = `Are you sure you want to delete ${keys.length} item${keys.length > 1 ? 's' : ''}?` + (folderCount > 0 ? ` This includes ${folderCount} folder${folderCount > 1 ? 's' : ''}, which will delete all contained objects.` : '')
    setDeleteConfirmation({ items: entries, title, message })
  }

  const confirmDelete = async () => {
    if (!deleteConfirmation) return
    const { items: delItems } = deleteConfirmation
    const objKeys: string[] = []
    const folders: string[] = []
    for (const it of delItems) {
      if (it.type === 'object') objKeys.push(it.data.key)
      else folders.push(it.data.prefix)
    }
    // Delete objects in bulk if any
    if (objKeys.length > 0) {
      const result = await (window as any).api.s3.deleteObjects({ bucket, keys: objKeys })
      if (!result.ok) throw new Error(result.error)
    }
    // Delete folders individually (API is per-folder)
    for (const p of folders) {
      const result = await (window as any).api.s3.deleteFolder({ bucket, prefix: p })
      if (!result.ok) throw new Error(result.error)
    }
    // Clear selection if necessary
    setSelected(undefined, undefined)
    setSelectedDetails(undefined)
    setSelectedSet(new Set())
    // Refresh list
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
          <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-header flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 opacity-70"><path d="M3 12h2a7 7 0 0 1 7-7V3A9 9 0 0 0 3 12zm2 0H3a9 9 0 0 0 9 9v-2a7 7 0 0 1-7-7zm16 0a9 9 0 0 0-9-9v2a7 7 0 0 1 7 7h2zm-2 0a7 7 0 0 1-7 7v2a9 9 0 0 0 9-9h-2z"/></svg>
          </div>
          <h2 className="text-lg font-semibold mb-2">Not connected</h2>
          <p className="text-sm opacity-80">Select a profile from the top bar to connect.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-panel h-full" onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop} tabIndex={0} ref={listRef}>
  <div className="border-b border-default px-3 py-2 flex items-center gap-2 text-sm bg-header text-app">
        {bucket ? (
          <>
            <div className="relative">
              <button
                ref={copyBtnRef}
                className="text-app/80 hover:text-app inline-flex items-center justify-center cursor-pointer rounded p-1 row-hover transition-colors"
                title="Copy S3 path"
                onClick={async () => {
                  const uri = `s3://${bucket}${prefix ? `/${prefix}` : '/'}`
                  try { await navigator.clipboard.writeText(uri) } catch {}
                  trace('ui', 'copy s3 path', { uri })
                  setCopied(true)
                  if (copyTimer.current) window.clearTimeout(copyTimer.current)
                  // Position tooltip near the button using viewport coordinates
                  const rect = copyBtnRef.current?.getBoundingClientRect()
                  if (rect) {
                    setTooltipPos({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top - 8) })
                  }
                  copyTimer.current = window.setTimeout(() => { setCopied(false); setTooltipPos(null) }, 1200) as unknown as number
                }}
                aria-label="Copy S3 path"
              >
                <CopyIcon className="w-4 h-4" />
              </button>
              {/* Tooltip is rendered via portal to escape stacking contexts */}
              {copied && tooltipPos && createPortal(
                <div className="fixed z-[9999] px-2 py-0.5 rounded text-xs menu-bg border border-default shadow pointer-events-none"
                  style={{ left: tooltipPos.x, top: tooltipPos.y, transform: 'translate(-50%, -100%)' }}
                >
                  Copied
                </div>,
                document.body
              )}
            </div>
            <span className="opacity-70">s3://</span>
            {prefix ? (
              <button
                className="hover:underline cursor-pointer link-accent"
                onClick={() => { trace('ui', 'breadcrumb bucket'); setPrefix('') }}
                title={`Go to s3://${bucket}/`}
              >
                {bucket}
              </button>
            ) : (
              <span className="opacity-90">{bucket}</span>
            )}
            <span className="opacity-50">/</span>
            <div className="flex items-center gap-1 flex-wrap">
              {crumbs.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i < crumbs.length - 1 ? (
                    <button className="hover:underline cursor-pointer link-accent" onClick={() => { trace('ui', 'breadcrumb click', { value: c.value }); setPrefix(c.value) }}>{c.label}</button>
                  ) : (
                    <span className="opacity-90">{c.label}</span>
                  )}
                  {i < crumbs.length - 1 && <span className="opacity-50">/</span>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="opacity-70">No bucket selected</div>
        )}
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
                className="btn btn-primary text-xs cursor-pointer"
                title="Refresh folder contents"
              >
                ↻ Refresh
              </button>
              <button
                onClick={() => uploadInputRef.current?.click()}
                className="btn btn-primary text-xs cursor-pointer"
                title="Upload files to this location"
              >
                ↑ Upload
              </button>
              <button
                onClick={() => setShowCreateFolder(true)}
                className="btn btn-primary text-xs cursor-pointer"
                title="Create new folder"
              >
                + Folder
              </button>
              <button
                onClick={async () => {
                  try {
                    await handleDownload()
                  } catch (e) {
                    console.error('download failed', e)
                  }
                }}
                className="btn btn-primary text-xs disabled:opacity-50 cursor-pointer"
                title={selectedSet.size > 1 ? `Download ${selectedSet.size} selected items` : 'Download selected item'}
                disabled={selectedSet.size === 0 && !selectedKey}
              >
                ↓ Download{selectedSet.size > 1 ? ` (${selectedSet.size})` : ''}
              </button>
              <button
                onClick={() => {
                  if (selectedSet.size > 1) {
                    handleDeleteSelected()
                  } else if (selectedKey) {
                    const entry = items.find(it => (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey)
                    if (entry) handleDelete(entry)
                  }
                }}
                className="btn btn-primary text-xs disabled:opacity-50 cursor-pointer"
                title={selectedSet.size > 1 ? `Delete ${selectedSet.size} selected items` : 'Delete selected item'}
                disabled={selectedSet.size === 0 && !selectedKey}
              >
                🗑 Delete{selectedSet.size > 1 ? ` (${selectedSet.size})` : ''}
              </button>
            </>
          )}
    {prefix && <button className="text-xs underline cursor-pointer link-accent" onClick={() => { trace('ui', 'up'); setPrefix(parentPrefix) }}>Up</button>}
  {/* Hidden file input for uploads */}
  <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={(e) => onUploadFilesSelected(e.target.files)} />
        </div>
      </div>

  {/* Main content area */}
  <div className="relative flex-1 overflow-auto bg-panel min-h-0" ref={contentRef} onDragOver={onDragOver} onDrop={onDrop} onClick={(e) => {
        // Only deselect if clicking directly on the container, not on any child elements
        if (e.target === e.currentTarget) {
          trace('ui', 'deselect on background click')
          setSelected(undefined, undefined)
          setSelectedDetails(undefined)
          setSelectedSet(new Set())
          setAnchorIndex(null)
          setFocusedIndex(null)
        }
      }}>
        {/* Drop/upload feedback toast */}
        {dropFeedback && (
          <div className="pointer-events-none absolute top-3 right-3 z-20">
            <div className={`text-sm shadow ${dropFeedback.stage === 'error' ? 'alert alert-error' : 'menu-bg border border-default px-3 py-2 rounded'}`}>
              {dropFeedback.message}
            </div>
          </div>
        )}
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
                <button className="btn btn-primary text-sm cursor-pointer" onClick={() => refetch()}>Retry</button>
                <button className="btn btn-secondary text-sm cursor-pointer" onClick={() => openSettings()}>Settings</button>
              </div>
            </div>
          </div>
        )}
  {!connectionError && isSwitchingProfile && <div className="px-3 py-2 text-sm opacity-70">Switching profile…</div>}
  {!connectionError && isLoading && <div className="px-3 py-2 text-sm">Loading…</div>}
        {!connectionError && isError && (
          <div className="h-full w-full flex items-center justify-center p-6">
            <div className="max-w-2xl text-center">
              <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M11 15h2v2h-2zm0-8h2v6h-2z"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
              </div>
              <h2 className="text-lg font-semibold mb-2">Failed to list objects</h2>
              <p className="text-sm opacity-80 mb-4">{(error as Error)?.message || 'Unable to load this folder. Please try again.'}</p>
              <div className="flex items-center justify-center gap-3">
                <button className="px-3 py-1 text-sm rounded bg-[#0e639c] text-white hover:bg-[#1177bb] cursor-pointer" onClick={() => refetch()}>Retry</button>
                <button className="px-3 py-1 text-sm rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer" onClick={() => openSettings()}>Settings</button>
              </div>
            </div>
          </div>
        )}
  {/* query-specific errors are shown below; connectionError is also surfaced above */}
        {/* Render empty-state or objects table when there's no error and a bucket is selected */}
  {!connectionError && !isSwitchingProfile && !isError && bucket && (
          visibleItems.length === 0 ? (
            <div className="h-full w-full flex items-center justify-center p-6">
              <div className="max-w-xl text-center">
                <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-header flex items-center justify-center text-app/70">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
                </div>
                <h2 className="text-lg font-semibold mb-2">{objectFilter ? 'No items match your filter' : 'This folder is empty'}</h2>
                <p className="text-sm opacity-80">
                  {objectFilter
                    ? 'Try adjusting or clearing the filter to see more results.'
                    : 'Drag and drop files here to upload, or use + Folder to create a new folder.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col" onDragOver={onDragOver} onDrop={onDrop}>
              <table className="min-w-full text-sm bg-panel text-app table-zebra">
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
                const rowKey = keyOf(it)
                const isSel = selectedSet.has(rowKey)
                const name = it.type === 'folder' ? it.data.prefix.split('/').filter(Boolean).slice(-1)[0] + '/' : it.data.key.split('/').slice(-1)[0]
                return (
  <tr key={(it.type === 'object' ? 'o:' + it.data.key : 'f:' + it.data.prefix)} className={`${isSel ? 'selected-row' : 'row-hover'} cursor-default border-b border-default`} onDoubleClick={() => onDoubleClick(it)} onClick={(e) => {
                      const key = rowKey
                      const isMeta = (e as any).metaKey
                      if (e.shiftKey) {
                        // Range select from anchor to i
                        const from = anchorIndex ?? i
                        const [lo, hi] = from <= i ? [from, i] : [i, from]
                        const newSet = new Set<string>()
                        for (let j = lo; j <= hi; j++) newSet.add(keyOf(visibleItems[j]))
                        setSelectedSet(newSet)
                        setFocusedIndex(i)
                        setAnchorIndex(from)
                      } else if (e.ctrlKey || isMeta) {
                        // Toggle
                        const newSet = new Set(selectedSet)
                        if (newSet.has(key)) newSet.delete(key); else newSet.add(key)
                        setSelectedSet(newSet)
                        setFocusedIndex(i)
                        if (anchorIndex === null) setAnchorIndex(i)
                      } else {
                        // Single select
                        setSelectedSet(new Set([key]))
                        setAnchorIndex(i)
                        setFocusedIndex(i)
                      }
                      trace('ui', 'select item', { key: it.type === 'object' ? it.data.key : it.data.prefix })
                      setSelected(it.type === 'object' ? it.data.key : it.data.prefix, it.type)
                      setSelectedDetails(it.type === 'object' ? { type: 'object', object: it.data } : { type: 'folder', folder: it.data })
                    }} onContextMenu={(e) => onContextMenu(e, it)}>
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
          {/* Flex spacer to fill remaining space and catch drops */}
          <div className="flex-1 min-h-0" onClick={(e) => {
            // Deselect when clicking on empty space
            if (e.target === e.currentTarget) {
              trace('ui', 'deselect on empty space click')
              setSelected(undefined, undefined)
              setSelectedDetails(undefined)
              setSelectedSet(new Set())
              setAnchorIndex(null)
              setFocusedIndex(null)
            }
          }} />
        </div>
          )
        )}
    {hasNextPage && (
          <div className="px-3 py-3">
  <button disabled={isFetchingNextPage} onClick={() => { trace('ui', 'load more'); fetchNextPage() }} className="btn btn-secondary text-sm disabled:opacity-50 cursor-pointer">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

  {/* Details moved to bottom panel */}

   {contextMenu && (
     <div className="fixed z-50 menu-bg border border-default rounded shadow text-sm"
       style={{ left: contextMenu.x, top: contextMenu.y }}
       ref={ctxMenuRef}
     >
          <button className="block w-full text-left px-3 py-2 row-hover cursor-pointer" onClick={() => handleDownload(contextMenu.item)}>Download</button>
          <button className="block w-full text-left px-3 py-2 row-hover cursor-pointer" onClick={() => handleProperties(contextMenu.item)}>Properties</button>
          <div className="border-t border-default"></div>
          <button className="block w-full text-left px-3 py-2 text-red-600 row-hover cursor-pointer" onClick={() => handleDelete(contextMenu.item)}>
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
              <button className="btn btn-secondary text-xs cursor-pointer" onClick={() => setShowProps(null)}>Close</button>
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
        itemCount={deleteConfirmation?.items?.length || 0}
        itemType={deleteConfirmation?.items && deleteConfirmation.items.length > 1 ? 'files' : (deleteConfirmation?.items?.[0]?.type === 'folder' ? 'folder' : 'file')}
      />
    </div>
  )
}
