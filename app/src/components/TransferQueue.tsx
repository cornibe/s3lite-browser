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

  const activeJobs = jobs.filter(j => j.status === 'in-progress' || j.status === 'queued' || j.status === 'paused')
  const completedJobs = jobs.filter(j => j.status === 'completed')
  const failedJobs = jobs.filter(j => j.status === 'failed' || j.status === 'canceled')

  function renderJob(job: TransferJobType) {
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
  }

  return (
    <div className={`p-2 border-t text-sm flex-none overflow-x-hidden overflow-y-auto h-full border-default bg-header`}>
      <div className="flex items-center mb-2">
        <div className="font-semibold">Transfer Queue</div>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded bg-neutral-200 dark:bg-[#2a2d2e] hover:bg-neutral-300 dark:hover:bg-[#323334]"
            title="Clear finished (completed/failed/canceled)"
            onClick={() => {
              // Remove terminal jobs and their items
              const newJobs: Record<string, any> = {}
              for (const j of jobs) {
                const isTerminal = j.status === 'completed' || j.status === 'failed' || j.status === 'canceled'
                if (!isTerminal) newJobs[j.id] = j
              }
              const newItems: Record<string, any> = {}
              for (const it of allItems) {
                const job = newJobs[it.jobId]
                if (job) newItems[it.id] = it
              }
              setTransfers({ jobs: newJobs, items: newItems })
            }}
          >
            Clear finished
          </button>
        </div>
      </div>
      {jobs.length === 0 && <div className="opacity-60">No transfers.</div>}

      {activeJobs.length > 0 && (
        <div className="mb-3">
          <div className="font-medium mb-1">Active</div>
          <div className="rounded border border-default p-2">
            {activeJobs.map(renderJob)}
          </div>
        </div>
      )}

      {completedJobs.length > 0 && (
        <div className="mb-3">
          <div className="font-medium mb-1">Completed</div>
          <div className="rounded border border-default p-2">
            {completedJobs.map(renderJob)}
          </div>
        </div>
      )}

      {failedJobs.length > 0 && (
        <div className="mb-3">
          <div className="font-medium mb-1">Failed/Cancelled</div>
          <div className="rounded border border-default p-2">
            {failedJobs.map(renderJob)}
          </div>
        </div>
      )}
    </div>
  )
}
