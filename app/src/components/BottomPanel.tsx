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
  const { bucket } = useStore() as any
  const [scanToken, setScanToken] = React.useState<string | undefined>(undefined)
  const [totalObjects, setTotalObjects] = React.useState(0)
  const [totalBytes, setTotalBytes] = React.useState(0)
  const [isScanning, setIsScanning] = React.useState(false)
  const [isAborted, setIsAborted] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    setScanToken(undefined)
    setTotalObjects(0)
    setTotalBytes(0)
    setIsScanning(false)
    setIsAborted(false)
    setError(undefined)
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
      setTotalBytes(prev => prev + (res.bytes || 0))
      setScanToken(res.nextToken)
    } catch (e) {
      setError((e as Error)?.message || 'Failed to scan folder')
    } finally {
      setIsScanning(false)
    }
  }

  function abortScan() {
    setIsAborted(true)
    setIsScanning(false)
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <div>
        <div className="font-semibold mb-1">Details</div>
        <div className="rounded border border-default">
          <div className="p-3 space-y-2">
            <div><span className="opacity-70">Prefix:</span> <span className="font-mono break-all">{prefix}</span></div>
          </div>
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1">Scan</div>
        <div className="rounded border border-default">
          <div className="p-3 flex flex-wrap items-center gap-4">
            <div><span className="opacity-70">Objects (scanned):</span> {totalObjects.toLocaleString()}</div>
            <div><span className="opacity-70">Size (scanned):</span> {formatSize(totalBytes)}</div>
            {error && <div className="text-red-600 dark:text-red-400">{error}</div>}
            <div className="ml-auto flex items-center gap-2">
              {!isAborted && (
                <button disabled={isScanning} onClick={scanNextPage} className="px-2 py-1 text-xs rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] disabled:opacity-50 cursor-pointer">
                  {scanToken === undefined && totalObjects === 0 ? (isScanning ? 'Scanning…' : 'Scan folder') : (isScanning ? 'Loading…' : (scanToken ? 'Load next page' : 'Rescan'))}
                </button>
              )}
              {!isAborted && (scanToken || isScanning) && (
                <button onClick={abortScan} className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/30 cursor-pointer">Abort</button>
              )}
              {isAborted && (
                <>
                  <span className="opacity-70">Aborted</span>
                  <button onClick={() => { setIsAborted(false); setError(undefined) }} className="px-2 py-1 text-xs rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] cursor-pointer">Resume</button>
                </>
              )}
            </div>
          </div>
          {(scanToken !== undefined) && (
            <div className="px-3 pb-3 opacity-70">More pages available… use "Load next page" to continue.</div>
          )}
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
