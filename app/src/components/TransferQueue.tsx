import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import type { TransferItem as TransferItemType, TransferJob as TransferJobType, TransferEvent } from '../../electron/types'
import { clamp01, formatBytesIEC, ema, calcAlpha } from '../lib/format'

type RowState = {
  // Smoothed speed EMA
  speed?: number
  lastSampleAt?: number
}

function useThrottledListener(handler: (evt: TransferEvent) => void, fps = 15) {
  const queued = useRef<TransferEvent[]>([])
  const rafRef = useRef<number | null>(null)
  const interval = Math.max(1, 1000 / fps)
  const lastFlushRef = useRef(0)

  useEffect(() => {
    const off = (window as any).api.transfers.onEvent((evt: TransferEvent) => {
      queued.current.push(evt)
      const now = performance.now()
      if (rafRef.current == null && now - lastFlushRef.current >= interval) {
        rafRef.current = requestAnimationFrame(() => {
          lastFlushRef.current = performance.now()
          const events = queued.current
          queued.current = []
          rafRef.current = null
          for (const e of events) handler(e)
        })
      }
    })
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); off() }
  }, [handler, interval])
}

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
  const ref = useRef<RowState>({})
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

function ActionButtons({ job, onRemove }: { job: TransferJobType; onRemove: () => void }) {
  const status = job.status
  const canPause = status === 'in-progress'
  const canResume = status === 'paused' || status === 'queued'
  const canCancel = status === 'in-progress' || status === 'queued' || status === 'paused'
  const isTerminal = status === 'completed' || status === 'failed' || status === 'canceled'
  if (isTerminal) {
    return (
      <div className="flex justify-end">
  <button aria-label="Remove job" className="px-2 py-1 text-xs bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] rounded" onClick={onRemove}>Remove</button>
      </div>
    )
  }
  return (
    <div className="flex gap-1 justify-end">
      <button aria-label="Pause job" disabled={!canPause} className="px-2 py-1 text-xs bg-neutral-200 disabled:opacity-50 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] rounded" onClick={() => (window as any).api.transfers.control({ jobId: job.id, action: 'pause' })}>Pause</button>
      <button aria-label="Resume job" disabled={!canResume} className="px-2 py-1 text-xs bg-neutral-200 disabled:opacity-50 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] rounded" onClick={() => (window as any).api.transfers.control({ jobId: job.id, action: 'resume' })}>Resume</button>
      <button aria-label="Cancel job" disabled={!canCancel} className="px-2 py-1 text-xs bg-neutral-200 disabled:opacity-50 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334] rounded" onClick={() => (window as any).api.transfers.control({ jobId: job.id, action: 'cancel' })}>Cancel</button>
    </div>
  )
}

const TransferItem: React.FC<{ item: TransferItemType; job: TransferJobType }> = ({ item, job }) => {
  const { transfers, setTransfers } = useStore()
  const total = item.size || 0
  const completed = item.status === 'completed'
  const bytes = completed ? total : Math.min(Math.max(0, item.bytesTransferred || 0), total)
  const percent = computePercent(bytes, total, completed)
  const speed = useRowSpeed(item.id, item.status === 'in-progress' ? item.speedBps : undefined)
  const name = nameFromKey(item.key)
  const statusText = item.status
  const isInProgress = item.status === 'in-progress'
  const verb = job.destDir ? 'Downloading' : 'Uploading'

  function removeItem() {
    const newItems = { ...transfers.items }
    delete newItems[item.id]
    const newJobs = { ...transfers.jobs }
    if (Object.values(newItems).every(it => it.jobId !== item.jobId)) delete newJobs[item.jobId]
    setTransfers({ jobs: newJobs, items: newItems })
  }

  return (
    <div role="row" aria-live={isInProgress ? 'polite' : undefined} aria-label={isInProgress ? `${verb} ${name}, ${Math.round(percent*100)}%` : name} className="grid grid-cols-[minmax(10rem,1fr)_12rem_14rem_8rem_8rem_10rem] items-center gap-3 py-1">
      <div role="cell" className="truncate" title={item.key || '(no name)'}>{name}</div>
      <div role="cell" className="tabular-nums">
        <div className="flex items-center gap-2">
          <div className="min-w-10 text-right">{Math.round(percent * 100)}%</div>
          <div className="flex-1"><ProgressBar percent={percent} /></div>
        </div>
      </div>
      <div role="cell" className="tabular-nums text-right">{formatBytesIEC(bytes)} / {formatBytesIEC(total)}</div>
      <div role="cell" className="tabular-nums text-right text-xs">{item.status === 'in-progress' && speed && speed > 0 ? `${formatBytesIEC(speed)}/s` : ''}</div>
      <div role="cell" className="capitalize text-xs text-right">{statusText}</div>
      {/* Actions column for items intentionally minimal: only Remove on terminal states */}
      <div role="cell" className="text-right">
        {(item.status === 'completed' || item.status === 'failed' || item.status === 'canceled') && (
          <button aria-label="Remove item" className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded" onClick={removeItem}>Remove</button>
        )}
      </div>
    </div>
  )
}

export default function TransferQueue() {
  const { transfers, setTransfers } = useStore()

  // Throttled event listener to avoid flicker and cap at ~15fps
  useThrottledListener((evt) => {
    useStore.setState(s => {
      const jobs = { ...s.transfers.jobs }
      const items = { ...s.transfers.items }
      if (evt.type === 'job-state') {
        const j = evt.job
        jobs[j.id] = j
        if (j.status === 'failed') {
          for (const it of Object.values(items)) {
            if (it.jobId === j.id && it.status !== 'completed') items[it.id] = { ...it, status: 'failed', error: j.error || it.error }
          }
        }
      } else if (evt.type === 'item-state') {
        const it = evt.item
        const total = it.size || 0
        // Ensure bytesTransferred never exceeds total size
        const clamped = Math.min(Math.max(0, it.bytesTransferred || 0), total)
        // For completed items, ensure bytesTransferred equals total
        const finalBytes = it.status === 'completed' ? total : clamped
        items[it.id] = { ...it, bytesTransferred: finalBytes }
      }
      return { transfers: { jobs, items } } as any
    })
  }, 15)

  const jobs = useMemo(() => Object.values(transfers.jobs), [transfers.jobs])
  const allItems = useMemo(() => Object.values(transfers.items), [transfers.items])

  function clearJob(jobId: string) {
    const newJobs = { ...transfers.jobs }
    delete newJobs[jobId]
    const newItems = { ...transfers.items }
    for (const item of Object.values(newItems)) if (item.jobId === jobId) delete newItems[item.id]
    setTransfers({ jobs: newJobs, items: newItems })
  }

  const dark = Boolean(useStore.getState().settings?.darkMode)
  return (
    <div className={`p-2 border-t text-sm flex-none overflow-x-hidden overflow-y-auto h-full ${dark ? 'border-[#323233] bg-[#252526] text-[#cccccc]' : 'border-neutral-200 bg-neutral-50'}`}>
      <div className="font-semibold mb-2">Transfer Queue</div>
      {jobs.length === 0 && <div className="opacity-60">No active transfers.</div>}
      {jobs.map(job => {
        const jobItems = allItems.filter(it => it.jobId === job.id)
        const total = job.totalBytes || 0
        const completed = job.completedBytes || 0
        const pct = computePercent(completed, total, job.status === 'completed')
        
        // Better title generation based on job type and content
        let title: string
        if (job.type === 'object' && jobItems.length === 1) {
          title = nameFromKey(jobItems[0]?.key) || '(no name)'
        } else if (job.type === 'prefix') {
          if (job.prefix && job.prefix !== '') {
            title = job.prefix.replace(/\/$/, '') || '(no name)'
          } else {
            // Multiple files without a prefix - show file count
            title = `${job.itemCount} file${job.itemCount !== 1 ? 's' : ''}`
          }
        } else {
          title = jobItems[0]?.key || '(no name)'
        }
        
        const isTerminal = job.status === 'completed' || job.status === 'failed' || job.status === 'canceled'
        // For single-object jobs, render just the item row to avoid duplicate appearance
        if (job.type === 'object' && jobItems.length === 1) {
          const it = jobItems[0]
          return (
            <TransferItem key={it.id} item={it} job={job} />
          )
        }
        return (
          <div key={job.id} className={`mb-3 rounded ${job.status === 'failed' ? 'bg-red-500/10 dark:bg-red-900/20' : ''}`}>
            <div role="row" className="grid grid-cols-[minmax(10rem,1fr)_12rem_14rem_8rem_8rem_10rem] items-center gap-3 py-1">
              <div role="cell" className="truncate" title={title}>
                {job.type === 'prefix' && job.prefix && job.prefix !== '' ? `Folder: ${title}` : title}
              </div>
              <div role="cell" className="tabular-nums">
                <div className="flex items-center gap-2">
                  <div className="min-w-10 text-right">{Math.round(pct * 100)}%</div>
                  <div className="flex-1"><ProgressBar percent={pct} /></div>
                </div>
              </div>
              <div role="cell" className="tabular-nums text-right">{formatBytesIEC(completed)} / {formatBytesIEC(total)}</div>
              <div role="cell" className="text-xs text-right opacity-70">{/* speed hidden at job level */}</div>
              <div role="cell" className="capitalize text-xs text-right">{job.status}</div>
              <div role="cell"><ActionButtons job={job} onRemove={() => clearJob(job.id)} /></div>
            </div>
            <div className="mt-1 divide-y divide-neutral-200 dark:divide-[#323233]/50">
              {jobItems.map(it => (
                <TransferItem key={it.id} item={it} job={job} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
