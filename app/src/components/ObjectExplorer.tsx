import React, { useMemo, useRef, useEffect } from 'react'
import { useObjects } from '../lib/query'
import { useStore } from '../lib/store'
import type { S3ObjectItem, S3Folder } from '../../electron/types'
import { trace } from '../lib/log'

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

export default function ObjectExplorer() {
  const { connected, profile, bucket, prefix, setPrefix, selectedKey, setSelectedKey, isSwitchingProfile, connectionError } = useStore() as any
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useObjects({ profile, bucket: bucket!, prefix, enabled: Boolean(bucket) })
  const listRef = useRef<HTMLDivElement>(null)

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

  const items: Entry[] = useMemo(() => {
    const pages = data?.pages ?? []
    const entries: Entry[] = []
    for (const page of pages) {
      for (const f of page.folders) entries.push({ type: 'folder', data: f })
      for (const o of page.objects) entries.push({ type: 'object', data: o })
    }
    return entries
  }, [data])

  function onDoubleClick(item: Entry) {
    if (item.type === 'folder') { trace('ui', 'open folder', { prefix: item.data.prefix }); setPrefix(item.data.prefix) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!items.length) return
    const idx = items.findIndex(it => it.type === 'object' ? it.data.key === selectedKey : it.data.prefix === selectedKey)
    if (e.key === 'ArrowDown') {
      const next = Math.min((idx < 0 ? 0 : idx + 1), items.length - 1)
      const it = items[next]
      setSelectedKey(it.type === 'object' ? it.data.key : it.data.prefix)
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      const prev = Math.max((idx < 0 ? 0 : idx - 1), 0)
      const it = items[prev]
      setSelectedKey(it.type === 'object' ? it.data.key : it.data.prefix)
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const it = items[Math.max(idx, 0)]
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

  const crumbs = splitPrefix(prefix)
  const parentPrefix = prefix.split('/').slice(0, -2).join('/') + (prefix ? '/' : '')

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="border-b px-3 py-2 text-sm opacity-80">Not connected. Select a profile to connect.</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col" onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop} tabIndex={0} ref={listRef}>
      <div className="border-b px-3 py-2 flex items-center gap-2 text-sm">
        <div className="opacity-70">{bucket ? `${bucket}` : 'No bucket selected'}</div>
        <div className="ml-2">/</div>
        <div className="flex items-center gap-1 flex-wrap">
      {crumbs.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
        <button className="hover:underline" onClick={() => { trace('ui', 'breadcrumb click', { value: c.value }); setPrefix(c.value) }}>{c.label}</button>
              {i < crumbs.length - 1 && <span className="opacity-50">/</span>}
            </div>
          ))}
        </div>
    {prefix && <button className="ml-auto text-xs underline" onClick={() => { trace('ui', 'up'); setPrefix(parentPrefix) }}>Up</button>}
      </div>

      {/* Connection error banner for visibility in main panel */}
      {connectionError && (
        <div className="border-b px-3 py-2 text-sm text-red-600">{connectionError}</div>
      )}

      <div className="flex-1 overflow-auto">
        {isSwitchingProfile && <div className="px-3 py-2 text-sm opacity-70">Switching profile…</div>}
        {isLoading && <div className="px-3 py-2 text-sm">Loading…</div>}
        {isError && (
          <div className="px-3 py-2 text-sm text-red-600 flex items-center gap-3">
            <span>{(error as Error)?.message || 'Failed to load objects.'}</span>
            <button onClick={() => refetch()} className="underline">Retry</button>
          </div>
        )}
  {/* query-specific errors are shown below; connectionError is also surfaced above */}
        {/* Only render the objects table when there's no error and a bucket is selected */}
  {!isSwitchingProfile && !isError && bucket && (
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900">
              <tr className="text-left">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 w-32">Size</th>
                <th className="px-3 py-2 w-48">Last Modified</th>
                <th className="px-3 py-2 w-48">Storage Class</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const isSel = (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey
                const name = it.type === 'folder' ? it.data.prefix.split('/').filter(Boolean).slice(-1)[0] + '/' : it.data.key.split('/').slice(-1)[0]
                return (
      <tr key={(it.type === 'object' ? 'o:' + it.data.key : 'f:' + it.data.prefix)} className={`${isSel ? 'bg-blue-50 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'} cursor-default`} onDoubleClick={() => onDoubleClick(it)} onClick={() => { trace('ui', 'select item', { key: it.type === 'object' ? it.data.key : it.data.prefix }); setSelectedKey(it.type === 'object' ? it.data.key : it.data.prefix) }}>
                    <td className="px-3 py-2 font-medium">{name}</td>
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
    <button disabled={isFetchingNextPage} onClick={() => { trace('ui', 'load more'); fetchNextPage() }} className="px-3 py-1 rounded bg-neutral-200 dark:bg-neutral-700">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      <Details items={items} selectedKey={selectedKey} />
    </div>
  )
}

function Details({ items, selectedKey }: { items: Entry[]; selectedKey?: string }) {
  const { bucket } = useStore()
  const sel = useMemo(() => items.find(it => (it.type === 'object' ? it.data.key : it.data.prefix) === selectedKey), [items, selectedKey])
  if (!sel) return <div className="border-t px-3 py-2 text-sm opacity-70">Select an object or folder to see details.</div>
  if (sel.type === 'folder') {
    const name = sel.data.prefix
    const pageCount = items.length
    return (
      <div className="border-t px-3 py-2 text-sm flex flex-wrap gap-6">
        <div><span className="opacity-70">Prefix:</span> <span className="font-mono">{name}</span></div>
        <div className="opacity-70">Showing {pageCount} items on this page.</div>
      </div>
    )
  }
  const o = sel.data
  const filename = o.key.split('/').slice(-1)[0]
  const s3uri = bucket ? `s3://${bucket}/${o.key}` : o.key
  return (
    <div className="border-t px-3 py-2 text-sm grid grid-cols-2 gap-3">
      <div><span className="opacity-70">Key:</span> <span className="font-mono break-all">{o.key}</span></div>
      <div><span className="opacity-70">File name:</span> {filename}</div>
      <div><span className="opacity-70">Size:</span> {formatSize(o.size)}</div>
      <div><span className="opacity-70">Last modified:</span> {o.lastModified ? new Date(o.lastModified).toLocaleString() : '-'}</div>
      <div><span className="opacity-70">ETag:</span> <span className="font-mono">{o.etag ?? ''}</span></div>
      <div><span className="opacity-70">Storage class:</span> {o.storageClass ?? ''}</div>
      <div className="col-span-2"><span className="opacity-70">S3 URI:</span> <span className="font-mono select-all">{s3uri}</span></div>
    </div>
  )
}
