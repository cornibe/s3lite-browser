import React from 'react'
import type { ObjectActionError, ObjectActionMode } from '../../electron/types'

interface ObjectActionProgressModalProps {
  isOpen: boolean
  mode: ObjectActionMode
  total: number
  completed: number
  failed: number
  currentSourceKey?: string
  currentDestinationKey?: string
  errors: ObjectActionError[]
  status: 'starting' | 'running' | 'complete' | 'error' | 'aborted'
  fatalError?: string
  onAbort: () => void
  onBackground: () => void
  onClose: () => void
}

export default function ObjectActionProgressModal({
  isOpen,
  mode,
  total,
  completed,
  failed,
  currentSourceKey,
  currentDestinationKey,
  errors,
  status,
  fatalError,
  onAbort,
  onBackground,
  onClose
}: ObjectActionProgressModalProps) {
  if (!isOpen) return null

  const actionLabel = mode === 'copy' ? 'Copy' : 'Move'
  const processed = completed + failed
  const percent = total > 0 ? Math.round((processed / total) * 100) : status === 'starting' ? 0 : 100
  const canClose = status === 'complete' || status === 'error' || status === 'aborted'
  const canAbort = status === 'starting' || status === 'running'

  return (
    <div className="fixed inset-0 overlay-bg flex items-center justify-center z-50">
      <div className="menu-bg rounded-lg p-6 w-[36rem] max-w-[95vw] border border-default shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{actionLabel} Progress</h2>
          <button className="btn btn-secondary" disabled={!canClose} onClick={onClose}>Close</button>
        </div>

        <div className="space-y-3 text-sm">
          <div>{status === 'starting' ? 'Preparing items...' : status === 'running' ? 'Running...' : status === 'complete' ? 'Completed.' : status === 'aborted' ? 'Aborted.' : 'Stopped with an error.'}</div>
          <div className="h-2 rounded bg-header overflow-hidden">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center gap-4 text-xs opacity-80">
            <div>Total: {total}</div>
            <div>Completed: {completed}</div>
            <div>Failed: {failed}</div>
          </div>
          {currentSourceKey && (
            <div className="rounded border border-default p-3 text-xs space-y-1">
              <div><span className="opacity-70">Source:</span> <span className="font-mono break-all">{currentSourceKey}</span></div>
              <div><span className="opacity-70">Destination:</span> <span className="font-mono break-all">{currentDestinationKey}</span></div>
            </div>
          )}
          {fatalError && <div className="alert alert-error text-sm">{fatalError}</div>}
          {errors.length > 0 && (
            <div className="rounded border border-default overflow-hidden">
              <div className="px-3 py-2 bg-header border-b border-default text-xs uppercase opacity-70">Errors</div>
              <div className="max-h-48 overflow-auto p-3 space-y-2 text-xs">
                {errors.map((err, idx) => (
                  <div key={`${err.sourceKey}:${idx}`} className="rounded border border-default p-2">
                    <div className="font-mono break-all">{err.sourceKey}</div>
                    {err.destinationKey && <div className="font-mono break-all opacity-70">{err.destinationKey}</div>}
                    <div className="text-red-600 break-words">{err.error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            {canAbort && <button className="btn text-xs cursor-pointer" style={{ backgroundColor: 'rgba(220,38,38,0.12)', color: 'var(--color-fg)' }} onClick={onAbort}>Abort</button>}
            {!canClose && <button className="btn btn-secondary text-xs cursor-pointer" onClick={onBackground}>Run in background</button>}
          </div>
        </div>
      </div>
    </div>
  )
}