import React, { useMemo, useRef, useState, useEffect } from 'react'
import { useStore } from '../lib/store'
import type { TransferItem as TransferItemType, TransferJob as TransferJobType } from '../../electron/types'
import { clamp01, formatBytesIEC, ema, calcAlpha } from '../lib/format'

type RowState = {
  // Smoothed speed EMA
  speed?: number
  lastSampleAt?: number
}

// events are routed into store globally; no local listener here

function ProgressBar({ percent }: { percent: number }) {
  const pct = Math.round(clamp01(percent) * 100)
  return (
    <div className="w-full h-2 bg-neutral-200 dark:bg-[#323233] rounded" aria-hidden>
      <div className="h-2 bg-[#0e639c] rounded" style={{ width: `${pct}%` }} />
    </div>
  )
}

function nameFromKey(key?: string) {
  if (!key) return '(no name)'
  const parts = key.split('/')
  const last = parts[parts.length - 1]
  return last || '(no name)'
}

function computePercent(bytes: number, total: number, completed: boolean) {
  if (completed) return 1  // Always show 100% for completed items
  if (total <= 0) return 0
  const b = Math.max(0, Math.min(bytes, total))
  return b / total
}

function useRowSpeed(id: string, rawBps?: number) {
  const ref = useRef({} as RowState)
  const [, setTick] = useState(0)
  useEffect(() => {
    const now = performance.now()
    const dt = ref.current.lastSampleAt ? now - (ref.current.lastSampleAt || 0) : 0
    const alpha = calcAlpha(dt || 100)
    const smoothed = rawBps && rawBps > 0 ? ema(ref.current.speed, rawBps, alpha) : undefined
    ref.current = { speed: smoothed, lastSampleAt: now }
    setTick(t => (t + 1) % 1000) // force rerender
  }, [id, rawBps])
  return ref.current.speed
}

export default function TransferQueue() {
  const { transfers, setTransfers } = useStore()

  const jobsById = useMemo(() => transfers.jobs, [transfers.jobs])
  const items = useMemo(() => Object.values(transfers.items), [transfers.items])

  type SortKey = 'name' | 'direction' | 'progress' | 'bytes' | 'size' | 'speed' | 'status' | 'started'
  const [sortKey, setSortKey] = useState('started' as SortKey)
  const [sortDir, setSortDir] = useState('desc' as 'asc' | 'desc')

  const rows = useMemo(() => {
    const statusOrder: Record<string, number> = { 'in-progress': 1, queued: 2, paused: 3, completed: 4, failed: 5, canceled: 6 }
    const enrich = items.map(it => {
      const job = jobsById[it.jobId]
      const total = it.size || 0
      const completed = it.status === 'completed'
      const bytes = completed ? total : Math.min(Math.max(0, it.bytesTransferred || 0), total)
      const percent = computePercent(bytes, total, completed)
      const name = nameFromKey(it.key)
      const direction = job?.destDir ? 'Download' : 'Upload'
      const speed = it.status === 'in-progress' ? (it.speedBps || 0) : 0
      return { it, job, name, direction, bytes, total, percent, speed, statusIndex: statusOrder[it.status] ?? 999 }
    })
    const cmp = (a: any, b: any) => {
      const mul = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'name': return mul * a.name.localeCompare(b.name)
        case 'direction': return mul * a.direction.localeCompare(b.direction)
        case 'progress': return mul * ((a.percent || 0) - (b.percent || 0))
        case 'bytes': return mul * ((a.bytes || 0) - (b.bytes || 0))
        case 'size': return mul * ((a.total || 0) - (b.total || 0))
        case 'speed': return mul * ((a.speed || 0) - (b.speed || 0))
        case 'status': return mul * ((a.statusIndex || 0) - (b.statusIndex || 0))
        case 'started': return mul * ((a.it.startedAt || 0) - (b.it.startedAt || 0))
      }
    }
    return enrich.sort(cmp)
  }, [items, jobsById, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  function removeItem(it: TransferItemType) {
    const newItems = { ...transfers.items }
    delete newItems[it.id]
    const newJobs = { ...transfers.jobs }
    if (Object.values(newItems).every(x => x.jobId !== it.jobId)) delete newJobs[it.jobId]
    setTransfers({ jobs: newJobs, items: newItems })
  }

  function clearFinished() {
    const newJobs: Record<string, TransferJobType> = {}
    const terminal = new Set<string>()
    for (const j of Object.values(transfers.jobs)) {
      const isTerminal = j.status === 'completed' || j.status === 'failed' || j.status === 'canceled'
      if (!isTerminal) newJobs[j.id] = j
      else terminal.add(j.id)
    }
    const newItems: Record<string, TransferItemType> = {}
    for (const it of Object.values(transfers.items)) if (newJobs[it.jobId]) newItems[it.id] = it
    setTransfers({ jobs: newJobs, items: newItems })
  }

  function Row({ row }: any) {
    const { it, job, name, percent, bytes, total, speed, direction } = row
    const rowSpeed = useRowSpeed(it.id, it.status === 'in-progress' ? speed : undefined)
    const isTerminal = it.status === 'completed' || it.status === 'failed' || it.status === 'canceled'
    const canCancel = !isTerminal && (job?.status === 'in-progress' || job?.status === 'queued' || job?.status === 'paused')
    return (
      <div key={it.id} role="row" className="grid grid-cols-[minmax(12rem,1.5fr)_7rem_12rem_14rem_7rem_8rem_8rem] items-center gap-3 px-2 py-2">
        <div role="cell" className="truncate" title={it.key}>{name}</div>
        <div role="cell" className="text-center text-xs opacity-80">{direction}</div>
        <div role="cell" className="tabular-nums">
          <div className="flex items-center gap-2">
            <div className="min-w-10 text-right">{Math.round(percent * 100)}%</div>
            <div className="flex-1"><ProgressBar percent={percent} /></div>
          </div>
        </div>
        <div role="cell" className="tabular-nums text-right">{formatBytesIEC(bytes)} / {formatBytesIEC(total)}</div>
        <div role="cell" className="tabular-nums text-right text-xs">{it.status === 'in-progress' && rowSpeed && rowSpeed > 0 ? `${formatBytesIEC(rowSpeed)}/s` : ''}</div>
        <div role="cell" className="capitalize text-xs text-right">{it.status}</div>
        <div role="cell" className="text-right">
          {canCancel && (
            <button className="btn btn-secondary text-xs mr-1" onClick={() => (window as any).api.transfers.control({ jobId: it.jobId, action: 'cancel' })}>Cancel</button>
          )}
          {isTerminal && (
            <button className="btn btn-secondary text-xs" onClick={() => removeItem(it)}>Remove</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`p-2 border-t text-sm flex-none overflow-x-hidden overflow-y-auto h-full border-default bg-header`}>
      <div className="flex items-center mb-2">
        <div className="font-semibold">Transfer Queue</div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-secondary text-xs" title="Cancel all active/queued" onClick={() => (window as any).api.transfers.control({ jobId: '*', action: 'cancelAll' })}>Cancel All</button>
          <button className="btn btn-secondary text-xs" title="Clear finished (completed/failed/canceled)" onClick={clearFinished}>Clear finished</button>
        </div>
      </div>
      {rows.length === 0 && <div className="opacity-60">No transfers.</div>}
      {rows.length > 0 && (
        <div className="rounded border border-default overflow-hidden">
          <div role="table" className="w-full">
            <div role="row" className="grid grid-cols-[minmax(12rem,1.5fr)_7rem_12rem_14rem_7rem_8rem_8rem] items-center gap-3 px-2 py-1 bg-neutral-100 dark:bg-[#1e1e1f] border-b border-default">
              <div role="columnheader" className="font-medium cursor-pointer select-none" onClick={() => toggleSort('name')}>Name {sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : ''}</div>
              <div role="columnheader" className="font-medium cursor-pointer select-none text-center" onClick={() => toggleSort('direction')}>Dir {sortKey==='direction' ? (sortDir==='asc'?'▲':'▼') : ''}</div>
              <div role="columnheader" className="font-medium cursor-pointer select-none" onClick={() => toggleSort('progress')}>Progress {sortKey==='progress' ? (sortDir==='asc'?'▲':'▼') : ''}</div>
              <div role="columnheader" className="font-medium cursor-pointer select-none text-right" onClick={() => toggleSort('bytes')}>Bytes {sortKey==='bytes' ? (sortDir==='asc'?'▲':'▼') : ''}</div>
              <div role="columnheader" className="font-medium cursor-pointer select-none text-right" onClick={() => toggleSort('speed')}>Speed {sortKey==='speed' ? (sortDir==='asc'?'▲':'▼') : ''}</div>
              <div role="columnheader" className="font-medium cursor-pointer select-none text-right" onClick={() => toggleSort('status')}>Status {sortKey==='status' ? (sortDir==='asc'?'▲':'▼') : ''}</div>
              <div role="columnheader" className="font-medium text-right">Actions</div>
            </div>
            <div role="rowgroup" className="divide-y divide-neutral-200 dark:divide-[#323233]/50">
              {rows.map(row => (
                <Row key={row.it.id} row={row} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
