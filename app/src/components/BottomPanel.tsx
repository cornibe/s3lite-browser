import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import TransferQueue from './TransferQueue'

// Simple tabs component to host Properties and Transfers at the bottom
export default function BottomPanel() {
  const { selectedKey, settings, setSettings } = useStore() as any
  const activeTab = settings.bottomPanelTab || 'transfers'
  useEffect(() => {
    if (selectedKey && activeTab !== 'properties') setSettings({ bottomPanelTab: 'properties' })
  }, [selectedKey])

  return (
    <div className="h-full flex flex-col bg-header text-app border-t border-default">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-default bg-header">
        <button
          className={`px-2 py-1 text-sm rounded ${activeTab === 'properties' ? 'bg-neutral-200 dark:bg-[#2a2d2e]' : 'hover:bg-neutral-200 dark:hover:bg-[#2a2d2e]'} cursor-pointer`}
          onClick={() => useStore.getState().setSettings({ bottomPanelTab: 'properties' })}
        >
          Properties
        </button>
        <button
          className={`px-2 py-1 text-sm rounded ${activeTab === 'transfers' ? 'bg-neutral-200 dark:bg-[#2a2d2e]' : 'hover:bg-neutral-200 dark:hover:bg-[#2a2d2e]'} cursor-pointer`}
          onClick={() => useStore.getState().setSettings({ bottomPanelTab: 'transfers' })}
        >
          Transfers
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'properties' ? <PropertiesPanel /> : <TransfersPanel />}
      </div>
    </div>
  )
}

function PropertiesPanel() {
  const { bucket, selectedKey, selectedType, selectedDetails } = useStore() as any
  if (!selectedKey || !selectedType) {
    return <div className="px-3 py-2 text-sm opacity-70">Select an object or folder to see details.</div>
  }
  if (selectedType === 'folder') {
    return <FolderPropsTables prefix={selectedKey} />
  }
  return <ObjectPropsTables bucket={bucket} keyStr={selectedKey} details={selectedDetails?.type === 'object' ? selectedDetails.object : undefined} />
}

function TransfersPanel() {
  return (
    <div className="h-full overflow-hidden">
      <TransferQueue />
    </div>
  )
}

// Object properties split in multiple tables: Details, Metadata (placeholder), Tags (placeholder)
function ObjectPropsTables({ bucket, keyStr, details }: { bucket?: string; keyStr: string; details?: any }) {
  // For now, we use information encoded in the key; deeper metadata/tags could be queried later.
  const name = keyStr.split('/').slice(-1)[0]
  return (
    <div className="p-3 space-y-4 text-sm">
      <div>
        <div className="font-semibold mb-1">Details</div>
        <div className="rounded border border-default">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-3">
            <div><span className="opacity-70">Key:</span> <span className="font-mono break-all">{keyStr}</span></div>
            <div><span className="opacity-70">File name:</span> {name}</div>
            {details && (
              <>
                <div><span className="opacity-70">Size:</span> {formatSize(details.size || 0)}</div>
                <div><span className="opacity-70">Last modified:</span> {details.lastModified ? new Date(details.lastModified).toLocaleString() : '-'}</div>
                <div><span className="opacity-70">ETag:</span> <span className="font-mono">{details.etag ?? ''}</span></div>
                <div><span className="opacity-70">Storage class:</span> {details.storageClass ?? ''}</div>
              </>
            )}
            {bucket && (
              <div className="col-span-2"><span className="opacity-70">S3 URI:</span> <span className="font-mono">s3://{bucket}/{keyStr}</span></div>
            )}
          </div>
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1">Metadata</div>
        <div className="rounded border border-default">
          <div className="p-3 opacity-70">Metadata loading not implemented.</div>
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1">Tags</div>
        <div className="rounded border border-default">
          <div className="p-3 opacity-70">Tags loading not implemented.</div>
        </div>
      </div>
    </div>
  )
}

// Folder properties split in multiple tables with scanning controls
function FolderPropsTables({ prefix }: { prefix: string }) {
  const { bucket, settings } = useStore() as any
  const [scanToken, setScanToken] = React.useState<string | undefined>(undefined)
  const [totalObjects, setTotalObjects] = React.useState(0)
  const [totalBytes, setTotalBytes] = React.useState(0)
  const [totalFiles, setTotalFiles] = React.useState(0)
  const [totalFolders, setTotalFolders] = React.useState(0)
  const uniqueFoldersRef = React.useRef<Set<string>>(new Set())
  const [isScanning, setIsScanning] = React.useState(false)
  const [isAborted, setIsAborted] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [pagesScanned, setPagesScanned] = React.useState(0)
  const [autoStopped, setAutoStopped] = React.useState(false)
  const abortRef = React.useRef(false)

  React.useEffect(() => {
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
    abortRef.current = false
  uniqueFoldersRef.current = new Set()
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
          // If key is exactly the folder marker (remainder empty), count current prefix as a folder once
          if (parts.length === 0) {
            set.add(prefix)
          } else {
            // add each directory level for nested folders
            let acc = prefix
            for (let i = 0; i < parts.length - 1; i++) {
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
    if (!bucket || !prefix) return
    const limit = Math.max(1, Number(settings?.folderScanAutoPages || 10))
    let mounted = true
    ;(async () => {
    // Avoid overlapping with manual scans
      if (isScanning) return
      setIsScanning(true)
      setError(undefined)
      setAutoStopped(false)
      setPagesScanned(0)
      let token: string | undefined = undefined
      try {
        for (let i = 0; i < limit; i++) {
          if (!mounted || abortRef.current) break
          const res = await (window as any).api.s3.folderStatsPage({ bucket, prefix, token })
          if (!mounted) break
      setTotalObjects(prev => prev + (res.objects || 0))
      setTotalFiles(prev => prev + (res.files || 0))
          if (Array.isArray(res.keys)) {
            const set = uniqueFoldersRef.current
            for (const k of res.keys) {
              if (!k.startsWith(prefix)) continue
              const remainder = k.slice(prefix.length)
              const parts = remainder.split('/').filter(Boolean)
              if (parts.length === 0) {
                set.add(prefix)
              } else {
                let acc = prefix
                for (let i = 0; i < parts.length - 1; i++) {
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
        if (token) {
          // More remains -> show as lower bound until user continues
          setAutoStopped(true)
        }
      } catch (e) {
        if (mounted) setError((e as Error)?.message || 'Failed to scan folder')
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
  setTotalObjects(prev => prev + (res.objects || 0))
  setTotalFiles(prev => prev + (res.files || 0))
        if (Array.isArray(res.keys)) {
          const set = uniqueFoldersRef.current
          for (const k of res.keys) {
            if (!k.startsWith(prefix)) continue
            const remainder = k.slice(prefix.length)
            const parts = remainder.split('/').filter(Boolean)
            if (parts.length === 0) {
              set.add(prefix)
            } else {
              let acc = prefix
              for (let i = 0; i < parts.length - 1; i++) {
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
      setError((e as Error)?.message || 'Failed to scan folder')
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <div>
  <div className="font-semibold mb-1">Details</div>
        <div className="rounded border border-default">
          <div className="p-3 grid grid-cols-2 gap-x-6 gap-y-2 items-start">
            <div><span className="opacity-70">Name:</span> <span className="font-mono break-all">{prefix}</span></div>
            <div><span className="opacity-70">Storage class:</span> <span className="opacity-80">-</span></div>
            <div><span className="opacity-70">Total objects:</span> {scanToken && (autoStopped || isScanning) ? '>' : ''}{totalObjects.toLocaleString()}</div>
            <div><span className="opacity-70">Total files:</span> {scanToken && (autoStopped || isScanning) ? '>' : ''}{totalFiles.toLocaleString()}</div>
            <div><span className="opacity-70">Total folders:</span> {scanToken && (autoStopped || isScanning) ? '>' : ''}{totalFolders.toLocaleString()}</div>
            <div><span className="opacity-70">Total size:</span> {scanToken && (autoStopped || isScanning) ? '>' : ''}{formatSize(totalBytes)}</div>
            <div className="col-span-2 flex flex-wrap items-center gap-2 mt-2">
              <div className="opacity-60">Pages scanned: {pagesScanned}</div>
              {error && <div className="text-red-600 dark:text-red-400">{error}</div>}
              <div className="ml-auto flex items-center gap-2">
                {scanToken && !isScanning && !isAborted && (
                  <button onClick={continueToCompletion} className="px-2 py-1 text-xs rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer">Continue collecting</button>
                )}
                {(scanToken || isScanning) && !isAborted && (
                  <button onClick={abortScan} className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/30 cursor-pointer">Stop</button>
                )}
                {!scanToken && !isScanning && (
                  <button onClick={() => { setScanToken(undefined); setTotalObjects(0); setTotalFiles(0); setTotalFolders(0); setTotalBytes(0); setPagesScanned(0); setAutoStopped(false); abortRef.current = false; return scanNextPage(); }} className="px-2 py-1 text-xs rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer">Rescan</button>
                )}
                {isAborted && (
                  <>
                    <span className="opacity-70">Stopped</span>
                    <button onClick={() => { setIsAborted(false); abortRef.current = false; if (scanToken) { continueToCompletion() } else { scanNextPage() } }} className="px-2 py-1 text-xs rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer">Resume</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
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
