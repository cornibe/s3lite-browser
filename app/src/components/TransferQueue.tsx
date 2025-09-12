import { useEffect } from 'react'
import { useStore } from '../lib/store'

function formatBytes(n: number) {
  const u = ['B','KB','MB','GB','TB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export default function TransferQueue() {
  const { transfers } = useStore()

  useEffect(() => {
    const off = (window as any).api.transfers.onEvent((evt: any) => {
      useStore.setState(s => {
        const jobs = { ...s.transfers.jobs }
        const items = { ...s.transfers.items }
        if (evt.type === 'job-state') jobs[evt.job.id] = evt.job
        else if (evt.type === 'item-state') items[evt.item.id] = evt.item
        return { transfers: { jobs, items } } as any
      })
    })
    return () => off()
  }, [])

  const jobs = Object.values(transfers.jobs)
  const items = Object.values(transfers.items)

  return (
    <div className="p-2 border-t text-sm bg-neutral-50 dark:bg-neutral-900">
      <div className="font-semibold mb-1">Transfer Queue</div>
      {jobs.length === 0 && <div className="opacity-60">No active transfers.</div>}
      {jobs.map(job => (
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
            {items.filter(it => it.jobId === job.id).slice(0, 5).map(it => (
              <div key={it.id} className="flex items-center gap-3">
                <div className="min-w-48 truncate" title={it.key}>{it.key.split('/').slice(-1)[0]}</div>
                <div className="flex-1 h-2 bg-neutral-200 dark:bg-neutral-800 rounded">
                  <div className={`h-2 ${it.status === 'failed' ? 'bg-red-500' : 'bg-blue-400'} rounded`} style={{ width: `${it.size > 0 ? Math.min(100, Math.round((it.bytesTransferred / it.size) * 100)) : 0}%` }} />
                </div>
                <div className="w-40 text-right tabular-nums">{formatBytes(it.bytesTransferred)} / {formatBytes(it.size)}</div>
                <div className="w-24 text-right text-xs">{it.speedBps ? `${formatBytes(it.speedBps)}/s` : ''}</div>
                <div className="w-20 text-right text-xs">{it.etaSeconds ? `${it.etaSeconds}s` : ''}</div>
                <div className="w-20 text-right capitalize text-xs">{it.status}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
