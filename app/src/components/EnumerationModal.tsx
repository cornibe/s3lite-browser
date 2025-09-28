import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import { formatBytesIEC } from '../lib/format'

export default function EnumerationModal() {
  const { transfers } = useStore()
  // Avoid TSX generic on useState for compatibility with project config
  const [hiddenJobIds, setHiddenJobIds] = useState(new Set() as Set<string>)
  const [tick, setTick] = useState(0)

  // Ensure UI updates at least every few seconds during long enumerations
  useEffect(() => {
    const t = setInterval(() => setTick(t => (t + 1) % 1000), 2000)
    return () => clearInterval(t)
  }, [])

  const job = useMemo(() => {
    const jobs = Object.values(transfers.jobs)
    // Prefer showing the largest enumerating job that's not hidden
    const enumerating = jobs.filter(j => j.status === 'enumerating' && !hiddenJobIds.has(j.id))
    if (!enumerating.length) return undefined
    enumerating.sort((a, b) => (b.itemCount || 0) - (a.itemCount || 0))
    const pick = enumerating[0]
    // Only show for larger uploads to avoid flashing for tiny ones
    if ((pick.itemCount || 0) < 200) return undefined
    return pick
  }, [transfers.jobs, hiddenJobIds, tick])

  if (!job) return null

  const onAbort = () => {
    try { (window as any).api.transfers.control({ jobId: job.id, action: 'cancel' }) } catch {}
  }
  const onHide = () => {
    setHiddenJobIds(prev => new Set(prev).add(job.id))
  }

  return createPortal(
    <div className="fixed inset-0 z-[9998]">
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-w-[95vw] rounded menu-bg border border-default shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Adding files to queue…</div>
          <button className="btn btn-secondary text-xs" onClick={onHide}>Hide</button>
        </div>
        <div className="text-sm space-y-2">
          <div className="opacity-80">Preparing upload to s3://{job.bucket}/{job.prefix || ''}</div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="opacity-70">Items discovered:</span> {job.itemCount.toLocaleString()}</div>
            <div className="text-right"><span className="opacity-70">Total size so far:</span> {formatBytesIEC(job.totalBytes)}</div>
          </div>
          <div className="opacity-70">You can start transferring while discovery continues. Abort will stop adding new items.</div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button className="btn btn-secondary text-xs" onClick={onHide}>Run in background</button>
            <button className="btn text-xs" style={{ backgroundColor: 'rgba(220,38,38,0.12)' }} onClick={onAbort}>Abort</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
