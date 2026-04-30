import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import TransferQueue from './TransferQueue'
import type { ObjectDetailsResult } from '../../electron/types'

// Simple tabs component to host Properties and Transfers at the bottom
export default function BottomPanel() {
  const { selectedKey, settings, setSettings } = useStore() as any
  const activeTab: 'properties'|'transfers'|'log'|'preview' = (settings.bottomPanelTab as any) || 'transfers'
  useEffect(() => {
    if (selectedKey && activeTab !== 'properties') setSettings({ bottomPanelTab: 'properties' })
  }, [selectedKey])

  return (
    <div className="h-full flex flex-col bg-header text-app border-t border-default">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-default bg-header">
        <button
          className={`tab-btn ${activeTab === 'properties' ? 'tab-btn-active' : ''}`}
          aria-selected={activeTab === 'properties'}
          onClick={() => useStore.getState().setSettings({ bottomPanelTab: 'properties' })}
        >
          Properties
        </button>
        <button
          className={`tab-btn ${activeTab === 'transfers' ? 'tab-btn-active' : ''}`}
          aria-selected={activeTab === 'transfers'}
          onClick={() => useStore.getState().setSettings({ bottomPanelTab: 'transfers' })}
        >
          Transfers
        </button>
        <button
          className={`tab-btn ${activeTab === 'log' ? 'tab-btn-active' : ''}`}
          aria-selected={activeTab === 'log'}
          onClick={() => useStore.getState().setSettings({ bottomPanelTab: 'log' })}
        >
          Log
        </button>
        <button
          className={`tab-btn ${activeTab === 'preview' ? 'tab-btn-active' : ''}`}
          aria-selected={activeTab === 'preview'}
          onClick={() => useStore.getState().setSettings({ bottomPanelTab: 'preview' })}
        >
          Preview
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'properties' ? <PropertiesPanel /> : activeTab === 'transfers' ? <TransfersPanel /> : activeTab === 'log' ? <LogPanel /> : <PreviewPanel />}
      </div>
    </div>
  )
}

function PropertiesPanel() {
  const { bucket, prefix, selectedKey, selectedType, selectedDetails } = useStore() as any
  // If no bucket, we cannot show location properties
  if (!bucket) {
    return <div className="px-3 py-2 text-sm opacity-70">Select a bucket to see details.</div>
  }
  if (selectedKey && selectedDetails?.type === 'selection-summary') {
    return <SelectionSummaryProps summary={selectedDetails} />
  }
  // If a folder or object is selected, show its details
  if (selectedKey && selectedType === 'folder') {
    return <FolderPropsTables prefix={selectedKey} />
  }
  if (selectedKey && selectedType === 'object') {
    return <ObjectPropsTables bucket={bucket} keyStr={selectedKey} details={selectedDetails?.type === 'object' ? selectedDetails.object : undefined} />
  }
  // Otherwise, default to current folder (or root bucket)
  return <FolderPropsTables prefix={prefix || ''} />
}

function TransfersPanel() {
  return (
    <div className="h-full overflow-hidden">
      <TransferQueue />
    </div>
  )
}

// Preview panel: fetches up to 256 KiB on-demand when active
function PreviewPanel() {
  const { bucket, selectedKey, selectedType } = useStore() as any
  const [state, setState] = React.useState({ loading: false } as any)
  const loadedKeyRef = React.useRef(undefined as any)

  async function load() {
    if (!bucket || !selectedKey || selectedType !== 'object') return
    if (loadedKeyRef.current === selectedKey) return
    setState({ loading: true })
    try {
      const res = await (window as any).api.s3.getObjectPreview({ bucket, key: selectedKey, maxBytes: 256 * 1024 })
      loadedKeyRef.current = selectedKey
      setState({ loading: false, text: res.text, isBinary: res.isBinary, contentType: res.contentType, truncated: res.truncated })
    } catch (e) {
      setState({ loading: false, error: (e as Error)?.message || 'Failed to load preview' })
    }
  }

  useEffect(() => { load() }, [bucket, selectedKey, selectedType])

  if (!bucket || !selectedKey) return <div className="px-3 py-2 text-sm opacity-70">Select a file to preview.</div>
  if (selectedType !== 'object') return <div className="px-3 py-2 text-sm opacity-70">Preview is available for files only.</div>
  if (state.loading) return <div className="px-3 py-2 text-sm opacity-70">Loading preview…</div>
  if (state.error) return <div className="px-3 py-2 text-sm text-red-600">{state.error}</div>
  if (state.isBinary) return <div className="px-3 py-2 text-sm opacity-70">Binary file. Preview not available.</div>
  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 border-b border-default bg-header text-xs opacity-80 flex gap-2">
        <div>Type: {state.contentType || 'unknown'}</div>
        <div>Size shown: up to 256 KB{state.truncated ? ' (truncated)' : ''}</div>
      </div>
      <pre className="flex-1 m-0 p-3 text-xs overflow-auto"><code>{state.text || ''}</code></pre>
    </div>
  )
}

function LogPanel() {
  const { awsLog, clearAwsLog } = useStore() as any
  const [selected, setSelected] = useState(null as any | null)
  const [statusFilter, setStatusFilter] = useState('all' as 'all'|'ok'|'error')
  const [scopeFilter, setScopeFilter] = useState('all' as 'all'|'s3'|'xfer')
  const [text, setText] = useState('')
  const filtered = React.useMemo(() => {
    const t = text.trim().toLowerCase()
    return awsLog.filter((e: any) => {
      if (statusFilter !== 'all' && e.status !== (statusFilter === 'ok' ? 'ok' : 'error')) return false
      if (scopeFilter !== 'all' && e.scope !== scopeFilter) return false
      if (!t) return true
      const target = e.key ? `s3://${e.bucket}/${e.key}` : (e.prefix ? `s3://${e.bucket}/${e.prefix}` : (e.bucket ? `s3://${e.bucket}` : ''))
      const hay = `${e.action || ''}\n${target}\n${e.error || ''}\n${JSON.stringify(e.extra || {})}`.toLowerCase()
      return hay.includes(t)
    })
  }, [awsLog, statusFilter, scopeFilter, text])
  return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1 border-b border-default bg-header flex items-center gap-2 flex-wrap">
        <div className="text-sm opacity-70">AWS commands: {awsLog.length}</div>
        <div className="flex items-center gap-1 text-xs">
          <span className="opacity-70">Status</span>
          <select className="input-theme text-xs h-6 px-1" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="ok">OK</option>
            <option value="error">Failed</option>
          </select>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="opacity-70">Scope</span>
          <select className="input-theme text-xs h-6 px-1" value={scopeFilter} onChange={e => setScopeFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="s3">s3</option>
            <option value="xfer">xfer</option>
          </select>
        </div>
        <input className="input-theme h-6 text-xs px-2 w-64" placeholder="Search…" value={text} onChange={e => setText(e.target.value)} />
  <button className="ml-auto btn btn-secondary text-xs cursor-pointer" onClick={() => clearAwsLog()}>Clear</button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-header border-b border-default">
            <tr className="text-left">
              <th className="px-2 py-1 w-40">Time</th>
              <th className="px-2 py-1 w-16">Scope</th>
              <th className="px-2 py-1 w-40">Action</th>
              <th className="px-2 py-1">Target</th>
              <th className="px-2 py-1 w-24">Status</th>
              <th className="px-2 py-1 w-24">Duration</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td className="px-2 py-2 opacity-60" colSpan={6}>No AWS operations yet.</td></tr>
            ) : filtered.map((e: any, idx: number) => {
              const target = e.key ? `s3://${e.bucket}/${e.key}` : (e.prefix ? `s3://${e.bucket}/${e.prefix}` : (e.bucket ? `s3://${e.bucket}` : ''))
              return (
                <tr key={idx} className="border-b border-default row-hover cursor-pointer" onClick={() => setSelected(e)} title="Click for details">
                  <td className="px-2 py-1 whitespace-nowrap">{new Date(e.ts || Date.now()).toLocaleTimeString()}</td>
                  <td className="px-2 py-1">{e.scope}</td>
                  <td className="px-2 py-1">{e.action}</td>
                  <td className="px-2 py-1 truncate max-w-[28rem]" title={target}>{target}</td>
                  <td className={`px-2 py-1 ${e.status === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{e.status === 'ok' ? 'OK' : 'Failed'}</td>
                  <td className="px-2 py-1">{typeof e.durationMs === 'number' ? `${e.durationMs} ms` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 overlay-bg" onClick={() => setSelected(null)} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] max-w-[95vw] rounded menu-bg border border-default shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Operation details</div>
              <button className="btn btn-secondary text-xs cursor-pointer" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="text-sm space-y-2">
              <div><span className="opacity-70">Time:</span> {new Date(selected.ts || Date.now()).toLocaleString()}</div>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="opacity-70">Scope:</span> {selected.scope}</div>
                <div><span className="opacity-70">Action:</span> {selected.action}</div>
                <div className="col-span-2"><span className="opacity-70">Target:</span> <span className="font-mono break-all">{selected.key ? `s3://${selected.bucket}/${selected.key}` : (selected.prefix ? `s3://${selected.bucket}/${selected.prefix}` : (selected.bucket ? `s3://${selected.bucket}` : ''))}</span></div>
                <div><span className="opacity-70">Status:</span> {selected.status === 'ok' ? 'OK' : 'Failed'}</div>
                <div><span className="opacity-70">Duration:</span> {typeof selected.durationMs === 'number' ? `${selected.durationMs} ms` : '-'}</div>
              </div>
              {selected.error && (
                <div className="alert alert-error">
                  <div className="font-semibold mb-1">Error</div>
                  <div className="whitespace-pre-wrap break-words">{selected.error}</div>
                </div>
              )}
              {selected.extra && (
                <div className="p-2 rounded border border-default bg-neutral-50 dark:bg-[#1e1f20]">
                  <div className="font-semibold mb-1">Extra</div>
                  <pre className="text-xs overflow-auto max-h-48"><code>{JSON.stringify(selected.extra, null, 2)}</code></pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SelectionSummaryProps({ summary }: { summary: { totalItems: number; objectCount: number; folderCount: number; totalObjectSize: number; mixedSelection: boolean } }) {
  const labelClass = "opacity-70 select-none w-28 flex items-center gap-1 text-xs"
  const valueClass = "min-w-0 font-mono break-all"
  const rowClass = "flex items-start gap-1 min-w-0"
  const wrapGrid = "grid grid-cols-2 gap-x-6 gap-y-2"

  const showObjectsSummary = summary.objectCount > 0 && summary.folderCount === 0
  const showFoldersSummary = summary.folderCount > 0 && summary.objectCount === 0

  return (
    <div className="p-3 text-sm">
      <div className={wrapGrid}>
        <div className={rowClass}>
          <span className={labelClass}><span>Total selected:</span></span>
          <span className={valueClass}>{summary.totalItems.toLocaleString()}</span>
        </div>

        {showObjectsSummary && (
          <>
            <div className={rowClass}>
              <span className={labelClass}><span>Total objects:</span></span>
              <span className={valueClass}>{summary.objectCount.toLocaleString()}</span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}><span>Total size:</span></span>
              <span className={valueClass}>{formatSize(summary.totalObjectSize)}</span>
            </div>
          </>
        )}

        {showFoldersSummary && (
          <div className={rowClass}>
            <span className={labelClass}><span>Total folders:</span></span>
            <span className={valueClass}>{summary.folderCount.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Reusable copy icon
function CopyIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>
    </svg>
  )
}

// Object properties split in multiple tables: Details, Metadata (placeholder), Tags (placeholder)
function ObjectPropsTables({ bucket, keyStr, details }: { bucket?: string; keyStr: string; details?: any }) {
  const { showToast } = useStore() as any
  const s3Uri = bucket ? `s3://${bucket}/${keyStr}` : ''
  const [remoteDetails, setRemoteDetails] = React.useState(null as ObjectDetailsResult | null)
  const [loadingDetails, setLoadingDetails] = React.useState(false)
  const [detailsError, setDetailsError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [tooltipPos, setTooltipPos] = React.useState(null as null | { x: number; y: number })
  const copyTimer = React.useRef(undefined as any)
  const keyBtnRef = React.useRef(null as any)
  const etagBtnRef = React.useRef(null as any)
  const uriBtnRef = React.useRef(null as any)
  const filenameBtnRef = React.useRef(null as any)

  const filename = React.useMemo(() => keyStr.split('/').slice(-1)[0], [keyStr])
  const mergedDetails = React.useMemo(() => ({ ...(details || {}), ...(remoteDetails || {}) }), [details, remoteDetails])
  const filetype = React.useMemo(() => {
    if (mergedDetails?.contentType) return mergedDetails.contentType
    const dot = filename.lastIndexOf('.')
    return dot > 0 ? filename.slice(dot + 1).toLowerCase() : 'unknown'
  }, [mergedDetails?.contentType, filename])

  React.useEffect(() => {
    let canceled = false
    async function loadDetails() {
      if (!bucket || !keyStr) return
      setLoadingDetails(true)
      setDetailsError(null)
      setRemoteDetails(null)
      try {
        const res = await (window as any).api.s3.getObjectDetails({ bucket, key: keyStr })
        if (!canceled) setRemoteDetails(res)
      } catch (e) {
        if (!canceled) setDetailsError((e as Error)?.message || 'Failed to load object details')
      } finally {
        if (!canceled) setLoadingDetails(false)
      }
    }
    void loadDetails()
    return () => { canceled = true }
  }, [bucket, keyStr])

  const labelClass = "opacity-70 select-none w-20 flex items-center gap-1 text-xs"
  const valueClass = "min-w-0"
  const rowClass = "flex items-start gap-1 min-w-0"
  const wrapGrid = "grid grid-cols-2 gap-x-6 gap-y-2"

  function showCopiedTooltip(ref: any) {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    const rect = ref?.getBoundingClientRect?.()
    if (rect) setTooltipPos({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top - 8) })
    setCopied(true)
    copyTimer.current = window.setTimeout(() => { setCopied(false); setTooltipPos(null) }, 1200) as unknown as number
  }

  return (
    <div className="p-3 text-sm">
      {(loadingDetails || detailsError) && (
        <div className={`mb-3 text-xs ${detailsError ? 'text-red-600' : 'opacity-70'}`}>
          {detailsError || 'Loading object details...'}
        </div>
      )}
      <div className={wrapGrid}>
        {/* Key (left) with copy icon left of label */}
        <div className={rowClass}>
          <span className={labelClass}>
            <button
              ref={keyBtnRef}
              className="icon-btn icon-btn-sm"
              title="Copy key"
              aria-label="Copy key"
              onClick={async () => { try { await navigator.clipboard.writeText(keyStr) } catch {}; showCopiedTooltip(keyBtnRef.current) }}
            >
              <CopyIcon />
            </button>
            <span>Key:</span>
          </span>
          <span className={`font-mono break-all ${valueClass}`}>{keyStr}</span>
        </div>

        {/* Last modified (right) */}
        <div className={rowClass}>
          <span className={labelClass}><span>Last modified:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.lastModified ? new Date(mergedDetails.lastModified).toLocaleString() : '-'}</span>
        </div>

        {/* Filename (left) with copy icon */}
        <div className={rowClass}>
          <span className={labelClass}>
            <button
              ref={filenameBtnRef}
              className="icon-btn icon-btn-sm"
              title="Copy filename"
              aria-label="Copy filename"
              onClick={async () => { try { await navigator.clipboard.writeText(filename) } catch {}; showCopiedTooltip(filenameBtnRef.current) }}
            >
              <CopyIcon />
            </button>
            <span>Filename:</span>
          </span>
          <span className={`font-mono break-all ${valueClass}`}>{filename}</span>
        </div>

        {/* File type (right) */}
        <div className={rowClass}>
          <span className={labelClass}><span>File type:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{filetype}</span>
        </div>

        {/* S3 URI (left) with copy icon left of label; show even if details missing */}
        <div className={rowClass}>
          <span className={labelClass}>
            <button
              ref={uriBtnRef}
              className="icon-btn icon-btn-sm"
              title="Copy S3 URI"
              aria-label="Copy S3 URI"
              disabled={!s3Uri}
              onClick={async () => { if (!s3Uri) return; try { await navigator.clipboard.writeText(s3Uri) } catch {}; showCopiedTooltip(uriBtnRef.current) }}
            >
              <CopyIcon />
            </button>
            <span>S3 URI:</span>
          </span>
          <span className={`font-mono break-all ${valueClass}`}>{s3Uri}</span>
        </div>

        {/* Storage class (right) */}
        <div className={rowClass}>
          <span className={labelClass}><span>Storage class:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.storageClass ?? ''}</span>
        </div>

        {/* ETag (left) with copy */}
        <div className={rowClass}>
          <span className={labelClass}>
            <button
              ref={etagBtnRef}
              className="icon-btn icon-btn-sm"
              title="Copy ETag"
              aria-label="Copy ETag"
              disabled={!mergedDetails?.etag}
              onClick={async () => { if (!mergedDetails?.etag) return; try { await navigator.clipboard.writeText(mergedDetails.etag) } catch {}; showCopiedTooltip(etagBtnRef.current) }}
            >
              <CopyIcon />
            </button>
            <span>ETag:</span>
          </span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.etag ?? ''}</span>
        </div>

        {/* Size (right) */}
        <div className={rowClass}>
          <span className={labelClass}><span>Size:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{formatSize(mergedDetails?.size || 0)}</span>
        </div>

        <div className={rowClass}>
          <span className={labelClass}><span>Content type:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.contentType ?? '-'}</span>
        </div>

        <div className={rowClass}>
          <span className={labelClass}><span>Cache control:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.cacheControl ?? '-'}</span>
        </div>

        <div className={rowClass}>
          <span className={labelClass}><span>Encryption:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.serverSideEncryption ?? '-'}</span>
        </div>

        <div className={rowClass}>
          <span className={labelClass}><span>Version ID:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{mergedDetails?.versionId ?? '-'}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded border border-default overflow-hidden">
          <div className="px-3 py-2 bg-header border-b border-default text-xs uppercase opacity-70">Metadata</div>
          <div className="p-3 text-xs">
            {mergedDetails?.metadata && Object.keys(mergedDetails.metadata).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(mergedDetails.metadata).map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[10rem_1fr] gap-2">
                    <div className="font-mono opacity-70 break-all">{key}</div>
                    <div className="font-mono break-all">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="opacity-60">No custom metadata.</div>
            )}
          </div>
        </div>

        <div className="rounded border border-default overflow-hidden">
          <div className="px-3 py-2 bg-header border-b border-default text-xs uppercase opacity-70">Tags</div>
          <div className="p-3 text-xs">
            {mergedDetails?.tagsError && (!mergedDetails.tags || mergedDetails.tags.length === 0) ? (
              <div className="text-red-600 break-words">{mergedDetails.tagsError}</div>
            ) : mergedDetails?.tags && mergedDetails.tags.length > 0 ? (
              <div className="space-y-2">
                {mergedDetails.tags.map((tag) => (
                  <div key={`${tag.key}:${tag.value}`} className="grid grid-cols-[10rem_1fr] gap-2">
                    <div className="font-mono opacity-70 break-all">{tag.key}</div>
                    <div className="font-mono break-all">{tag.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="opacity-60">No object tags.</div>
            )}
          </div>
        </div>
      </div>

      {/* Tooltip via portal */}
      {copied && tooltipPos && createPortal(
        <div className="fixed z-[9999] px-2 py-0.5 rounded text-xs menu-bg border border-default shadow pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y, transform: 'translate(-50%, -100%)' }}
        >
          Copied
        </div>,
        document.body
      )}
    </div>
  )
}

// Folder properties split in multiple tables with scanning controls
function FolderPropsTables({ prefix }: { prefix: string }) {
  const { bucket, settings } = useStore() as any
  const [scanToken, setScanToken] = React.useState(undefined as string | undefined)
  const [totalObjects, setTotalObjects] = React.useState(0)
  const [totalBytes, setTotalBytes] = React.useState(0)
  const [totalFiles, setTotalFiles] = React.useState(0)
  const [totalFolders, setTotalFolders] = React.useState(0)
  const uniqueFoldersRef = React.useRef(new Set<string>())
  const [isScanning, setIsScanning] = React.useState(false)
  const [isAborted, setIsAborted] = React.useState(false)
  const [error, setError] = React.useState(undefined as string | undefined)
  const [pagesScanned, setPagesScanned] = React.useState(0)
  const [autoStopped, setAutoStopped] = React.useState(false)
  const abortRef = React.useRef(false)

  const s3Uri = bucket ? `s3://${bucket}/${prefix}` : ''
  const name = React.useMemo(() => prefix || '/', [prefix])
  const [copied, setCopied] = React.useState(false)
  const [tooltipPos, setTooltipPos] = React.useState(null as null | { x: number; y: number })
  const copyTimer = React.useRef(undefined as any)
  const nameBtnRef = React.useRef(null as any)
  const uriBtnRef = React.useRef(null as any)

  function showCopiedTooltip(ref: any) {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    const rect = ref?.getBoundingClientRect?.()
    if (rect) setTooltipPos({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top - 8) })
    setCopied(true)
    copyTimer.current = window.setTimeout(() => { setCopied(false); setTooltipPos(null) }, 1200) as unknown as number
  }

  // Reset all state when changing folders to ensure clean slate
  React.useEffect(() => {
    // Abort any ongoing scan
    abortRef.current = true
    
    // Reset all state
    setScanToken(undefined)
    setTotalObjects(0)
    setTotalBytes(0)
    setTotalFiles(0)
    setTotalFolders(0)
    setIsScanning(false)
    setIsAborted(false)
    setError(undefined)
    setPagesScanned(0)
    setAutoStopped(false)
    uniqueFoldersRef.current = new Set()
    
    // Clear abort flag after state reset
    abortRef.current = false
  }, [prefix, bucket])

  async function scanNextPage() {
    if (!bucket || isScanning || isAborted) return
    setIsScanning(true)
    setError(undefined)
    try {
      const tokenToUse = scanToken
      if (tokenToUse === undefined && (totalObjects > 0 || totalBytes > 0)) {
        setTotalObjects(0)
        setTotalBytes(0)
      }
      const res = await (window as any).api.s3.folderStatsPage({ bucket, prefix, token: tokenToUse })
      // Track totals: use files for displayed "Total objects" (exclude folder markers)
      setTotalObjects(prev => prev + (res.objects || 0))
      setTotalFiles(prev => prev + (res.files || 0))
      // Derive unique folder paths from keys to avoid over/under counting
      if (Array.isArray(res.keys)) {
        const set = uniqueFoldersRef.current
        for (const k of res.keys) {
          // derive folder segments relative to the selected prefix
          if (!k.startsWith(prefix)) continue
          const remainder = k.slice(prefix.length)
          const parts = remainder.split('/').filter(Boolean)
          const isFolderKey = k.endsWith('/')
          // Include all directory levels. For files, exclude the final filename segment.
          const depth = isFolderKey ? parts.length : Math.max(0, parts.length - 1)
          if (parts.length === 0 && isFolderKey) {
            // Key equals the current prefix (rare), count it as one folder
            set.add(prefix)
          } else if (depth > 0) {
            let acc = prefix
            for (let i = 0; i < depth; i++) {
              acc += parts[i] + '/'
              set.add(acc)
            }
          }
        }
        setTotalFolders(uniqueFoldersRef.current.size)
      } else {
        // fallback to backend hint
        setTotalFolders(prev => prev + (res.folders || 0))
      }
      setTotalBytes(prev => prev + (res.bytes || 0))
      setScanToken(res.nextToken)
      setPagesScanned(p => p + 1)
    } catch (e) {
      setError((e as Error)?.message || 'Failed to scan folder')
    } finally {
      setIsScanning(false)
    }
  }

  function abortScan() {
    setIsAborted(true)
    setIsScanning(false)
    abortRef.current = true
  }

  // Auto-scan on open: scan up to configured number of pages, then stop and show lower-bound if more remains
  React.useEffect(() => {
    // Allow auto-scan even at root (empty prefix)
    if (!bucket) return
    const limit = Math.max(1, Number(settings?.folderScanAutoPages || 10))
    let mounted = true
    ;(async () => {
    // Avoid overlapping with manual scans
      if (isScanning || abortRef.current) return
      setIsScanning(true)
      setError(undefined)
      setAutoStopped(false)
      setPagesScanned(0)
      let token: string | undefined = undefined
      try {
        for (let i = 0; i < limit; i++) {
          if (!mounted || abortRef.current) break
          const res = await (window as any).api.s3.folderStatsPage({ bucket, prefix, token })
          if (!mounted || abortRef.current) break
          // Use files for displayable objects
          setTotalObjects(prev => prev + (res.objects || 0))
          setTotalFiles(prev => prev + (res.files || 0))
          if (Array.isArray(res.keys)) {
            const set = uniqueFoldersRef.current
            for (const k of res.keys) {
              if (!k.startsWith(prefix)) continue
              const remainder = k.slice(prefix.length)
              const parts = remainder.split('/').filter(Boolean)
              const isFolderKey = k.endsWith('/')
              const depth = isFolderKey ? parts.length : Math.max(0, parts.length - 1)
              if (parts.length === 0 && isFolderKey) {
                set.add(prefix)
              } else if (depth > 0) {
                let acc = prefix
                for (let i = 0; i < depth; i++) {
                  acc += parts[i] + '/'
                  set.add(acc)
                }
              }
            }
            setTotalFolders(set.size)
          } else {
            setTotalFolders(prev => prev + (res.folders || 0))
          }
          setTotalBytes(prev => prev + (res.bytes || 0))
          setPagesScanned(p => p + 1)
          token = res.nextToken
          setScanToken(token)
          if (!token) break
        }
        if (token && !abortRef.current) {
          // More remains -> show as lower bound until user continues
          setAutoStopped(true)
        }
      } catch (e) {
        if (mounted && !abortRef.current) setError((e as Error)?.message || 'Failed to scan folder')
      } finally {
        if (mounted) setIsScanning(false)
      }
    })()
    return () => { mounted = false }
  // re-run when bucket/prefix or limit changes
  }, [bucket, prefix, settings?.folderScanAutoPages])

  // Continue collecting until completion or user stops
  async function continueToCompletion() {
    if (!bucket || isScanning) return
    setIsScanning(true)
    setIsAborted(false)
    abortRef.current = false
    setError(undefined)
    setAutoStopped(false)
    try {
      let token = scanToken
      while (token && !abortRef.current) {
        const res = await (window as any).api.s3.folderStatsPage({ bucket, prefix, token })
        if (abortRef.current) break
        setTotalObjects(prev => prev + (res.objects || 0))
        setTotalFiles(prev => prev + (res.files || 0))
        if (Array.isArray(res.keys)) {
          const set = uniqueFoldersRef.current
          for (const k of res.keys) {
            if (!k.startsWith(prefix)) continue
            const remainder = k.slice(prefix.length)
            const parts = remainder.split('/').filter(Boolean)
            const isFolderKey = k.endsWith('/')
            const depth = isFolderKey ? parts.length : Math.max(0, parts.length - 1)
            if (parts.length === 0 && isFolderKey) {
              set.add(prefix)
            } else if (depth > 0) {
              let acc = prefix
              for (let i = 0; i < depth; i++) {
                acc += parts[i] + '/'
                set.add(acc)
              }
            }
          }
          setTotalFolders(set.size)
        } else {
          setTotalFolders(prev => prev + (res.folders || 0))
        }
        setTotalBytes(prev => prev + (res.bytes || 0))
        setPagesScanned(p => p + 1)
        token = res.nextToken
        setScanToken(token)
      }
    } catch (e) {
      if (!abortRef.current) setError((e as Error)?.message || 'Failed to scan folder')
    } finally {
      setIsScanning(false)
    }
  }

  const labelClass = "opacity-70 select-none w-20 flex items-center gap-1 text-xs"
  const valueClass = "min-w-0"
  const rowClass = "flex items-start gap-1 min-w-0"

  return (
    <div className="p-3 text-sm flex flex-col h-full">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 items-start">
        {/* Name with copy icon */}
        <div className={rowClass}>
          <span className={labelClass}>
            <button
              ref={nameBtnRef}
              className="icon-btn icon-btn-sm"
              title="Copy name"
              aria-label="Copy name"
              onClick={async () => { try { await navigator.clipboard.writeText(name) } catch {}; showCopiedTooltip(nameBtnRef.current) }}
            >
              <CopyIcon />
            </button>
            <span>Name:</span>
          </span>
          <span className={`font-mono break-all ${valueClass}`}>{name}</span>
        </div>
        {/* Storage class (right) */}
        <div className={rowClass}>
          <span className={labelClass}><span>Storage class:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>-</span>
        </div>

        {/* S3 URI with copy icon */}
        <div className={rowClass}>
          <span className={labelClass}>
            <button
              ref={uriBtnRef}
              className="icon-btn icon-btn-sm"
              title="Copy S3 URI"
              aria-label="Copy S3 URI"
              disabled={!s3Uri}
              onClick={async () => { if (!s3Uri) return; try { await navigator.clipboard.writeText(s3Uri) } catch {}; showCopiedTooltip(uriBtnRef.current) }}
            >
              <CopyIcon />
            </button>
            <span>S3 URI:</span>
          </span>
          <span className={`font-mono break-all ${valueClass}`}>{s3Uri}</span>
        </div>

        {/* Display files under the label "Total objects" */}
        <div className={rowClass}>
          <span className={labelClass}><span>Total objects:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{(scanToken && (autoStopped || isScanning) ? '>' : '') + totalFiles.toLocaleString()}</span>
        </div>

        {/* Total folders */}
        <div className={rowClass}>
          <span className={labelClass}><span>Total folders:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{(scanToken && (autoStopped || isScanning) ? '>' : '') + totalFolders.toLocaleString()}</span>
        </div>

        {/* Total size */}
        <div className={rowClass}>
          <span className={labelClass}><span>Total size:</span></span>
          <span className={`font-mono break-all ${valueClass}`}>{(scanToken && (autoStopped || isScanning) ? '>' : '') + formatSize(totalBytes)}</span>
        </div>
      </div>
      
      {/* Scanning controls - locked to bottom */}
      <div className="pt-1 mt-auto" style={{ borderTop: '1px solid rgba(128, 128, 128, 0.15)' }}>
        <div className="flex items-center justify-between gap-1">
          <div className="opacity-60 min-w-[110px] text-xs leading-tight">Pages scanned: {pagesScanned}</div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {scanToken && !isScanning && !isAborted && (
              <button onClick={continueToCompletion} className="btn btn-secondary text-xs cursor-pointer">Continue collecting</button>
            )}
            {(scanToken || isScanning) && !isAborted && (
              <button onClick={abortScan} className="btn text-xs cursor-pointer" style={{ backgroundColor: 'rgba(220,38,38,0.12)', color: 'var(--color-fg)' }}>Stop</button>
            )}
            {!scanToken && !isScanning && !isAborted && (
              <button onClick={() => { setScanToken(undefined); setTotalObjects(0); setTotalFiles(0); setTotalFolders(0); setTotalBytes(0); setPagesScanned(0); setAutoStopped(false); abortRef.current = false; setIsAborted(false); return scanNextPage(); }} className="btn btn-secondary text-xs cursor-pointer">Rescan</button>
            )}
            {isAborted && (
              <>
                <span className="opacity-70 text-xs">Stopped</span>
                <button onClick={() => { setIsAborted(false); abortRef.current = false; if (scanToken) { continueToCompletion() } else { scanNextPage() } }} className="btn btn-secondary text-xs cursor-pointer">Resume</button>
              </>
            )}
          </div>
        </div>
        {error && <div className="alert alert-error mt-2">{error}</div>}
      </div>
    </div>
  )
}

function formatSize(n: number) {
  const units = ['B','KB','MB','GB','TB']
  let i = 0; let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
