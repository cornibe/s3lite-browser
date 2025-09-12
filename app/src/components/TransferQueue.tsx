import React, { useEffect } from 'react'
import { useStore } from '../lib/store'
import type { TransferItem as TransferItemType } from '../../electron/types'

function formatBytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function TransferItem({ item }: { item: TransferItemType }) {
  const { transfers, setTransfers } = useStore()

  function clearItem() {
    const newItems = { ...transfers.items }
    delete newItems[item.id]
    const newJobs = { ...transfers.jobs }
    if (Object.values(newItems).every(it => it.jobId !== item.jobId)) {
      delete newJobs[item.jobId]
    }
    setTransfers({ jobs: newJobs, items: newItems })
  }

  if (item.status === 'failed') {
    const displayName = item.key ? item.key.split('/').slice(-1)[0] : 'Unknown file'
    return (
      <div className="flex items-center gap-3 text-red-500">
        <div className="min-w-48 truncate" title={item.key || 'Unknown file'}>{displayName}</div>
        <div className="flex-1">
          <div className="font-semibold">Failed</div>
          <div className="text-xs opacity-80">{item.error}</div>
        </div>
        <button className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded" onClick={clearItem}>Clear</button>
      </div>
    )
  }

  const displayName = item.key ? item.key.split('/').slice(-1)[0] : 'Unknown file'
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-48 truncate" title={item.key || 'Unknown file'}>{displayName}</div>
      <div className="flex-1 h-2 bg-neutral-200 dark:bg-neutral-800 rounded">
        <div className={`h-2 ${item.status === 'failed' ? 'bg-red-500' : 'bg-blue-400'} rounded`} style={{ width: `${item.size > 0 ? Math.min(100, Math.round((item.bytesTransferred / item.size) * 100)) : 0}%` }} />
      </div>
      <div className="w-40 text-right tabular-nums">{formatBytes(item.bytesTransferred)} / {formatBytes(item.size)}</div>
      <div className="w-24 text-right text-xs">{item.speedBps ? `${formatBytes(item.speedBps)}/s` : ''}</div>
      <div className="w-20 text-right text-xs">{item.etaSeconds ? `${item.etaSeconds}s` : ''}</div>
      <div className="w-20 text-right capitalize text-xs">{item.status}</div>
    </div>
  )
}

export default function TransferQueue() {
  const { transfers, setTransfers } = useStore()

  useEffect(() => {
    const off = (window as any).api.transfers.onEvent((evt: any) => {
      useStore.setState(s => {
        const jobs = { ...s.transfers.jobs }
        const items = { ...s.transfers.items }
        if (evt.type === 'job-state') {
          jobs[evt.job.id] = evt.job
          if (evt.job.status === 'failed') {
            for (const item of Object.values(items)) {
              if (item.jobId === evt.job.id && item.status !== 'completed') {
                items[item.id] = { ...item, status: 'failed', error: evt.job.error || 'Job failed' }
              }
            }
          }
        }
        else if (evt.type === 'item-state') items[evt.item.id] = evt.item
        return { transfers: { jobs, items } } as any
      })
    })
    return () => off()
  }, [setTransfers])

  const jobs = Object.values(transfers.jobs)
  const items = Object.values(transfers.items)

  function clearJob(jobId: string) {
    const newJobs = { ...transfers.jobs }
    delete newJobs[jobId]
    const newItems = { ...transfers.items }
    for (const item of Object.values(newItems)) {
      if (item.jobId === jobId) {
        delete newItems[item.id]
      }
    }
    setTransfers({ jobs: newJobs, items: newItems })
  }

  return (
    <div className="p-2 border-t text-sm bg-neutral-50 dark:bg-neutral-900">
      <div className="font-semibold mb-1">Transfer Queue</div>
      {jobs.length === 0 && <div className="opacity-60">No active transfers.</div>}
      {jobs.map(job => {
        const jobItems = items.filter(it => it.jobId === job.id)
        if (job.status === 'failed') {
          return (
            <div key={job.id} className="mb-2 p-2 rounded bg-red-500/10">
              <div className="flex items-center gap-3 text-red-500">
                <div className="min-w-48">{job.type === 'prefix' ? `Folder: ${job.prefix}` : 'Object'}</div>
                <div className="flex-1">
                  <div className="font-semibold">Failed</div>
                  <div className="text-xs opacity-80">{job.error}</div>
                </div>
                <button className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded" onClick={() => clearJob(job.id)}>Clear</button>
              </div>
              <div className="ml-6 mt-1 space-y-1">
                {jobItems.slice(0, 5).map((it, idx) => <TransferItem key={idx} item={it} />)}
              </div>
            </div>
          )
        }
        return (
          <div key={job.id} className="mb-2">
            <div className="flex items-center gap-3">
              <div className="min-w-48">{job.type === 'prefix' ? `Folder: ${job.prefix}` : 'Object'}</div>
              <div className="flex-1 h-2 bg-neutral-200 dark:bg-neutral-800 rounded">
                <div className="h-2 bg-blue-500 rounded" style={{ width: `${job.totalBytes > 0 ? Math.min(100, Math.round((job.completedBytes / job.totalBytes) * 100)) : 0}%` }} />
              </div>
              <div className="w-48 text-right tabular-nums">{formatBytes(job.completedBytes)} / {formatBytes(job.totalBytes)}</div>
              <div className="w-24 text-right capitalize">{job.status}</div>
              <div className="flex gap-1">
                <button className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded" onClick={() => (window as any).api.transfers.control({ jobId: job.id, action: 'pause' })}>Pause</button>
                <button className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded" onClick={() => (window as any).api.transfers.control({ jobId: job.id, action: 'resume' })}>Resume</button>
                <button className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded" onClick={() => (window as any).api.transfers.control({ jobId: job.id, action: 'cancel' })}>Cancel</button>
              </div>
            </div>
            <div className="ml-6 mt-1 space-y-1">
              {jobItems.slice(0, 5).map((it, idx) => <TransferItem key={idx} item={it} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
