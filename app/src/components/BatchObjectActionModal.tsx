import React, { useEffect, useState } from 'react'
import type { ObjectActionMode } from '../../electron/types'

interface BatchObjectActionModalProps {
  isOpen: boolean
  mode: ObjectActionMode
  objectCount: number
  folderCount: number
  defaultDestinationBucket: string
  defaultDestinationPrefix: string
  onClose: () => void
  onSubmit: (input: { destinationBucket: string; destinationPrefix: string }) => Promise<void>
}

export default function BatchObjectActionModal({
  isOpen,
  mode,
  objectCount,
  folderCount,
  defaultDestinationBucket,
  defaultDestinationPrefix,
  onClose,
  onSubmit
}: BatchObjectActionModalProps) {
  const [destinationBucket, setDestinationBucket] = useState(defaultDestinationBucket)
  const [destinationPrefix, setDestinationPrefix] = useState(defaultDestinationPrefix)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setDestinationBucket(defaultDestinationBucket)
    setDestinationPrefix(defaultDestinationPrefix)
    setIsSubmitting(false)
    setError(null)
  }, [isOpen, defaultDestinationBucket, defaultDestinationPrefix])

  if (!isOpen) return null

  const actionLabel = mode === 'copy' ? 'Copy' : 'Move'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit({
        destinationBucket: destinationBucket.trim(),
        destinationPrefix: destinationPrefix.trim().replace(/^\/+/, '')
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionLabel} failed`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 overlay-bg flex items-center justify-center z-50">
      <div className="menu-bg rounded-lg p-6 w-[32rem] max-w-[95vw] border border-default shadow-xl">
        <h2 className="text-lg font-semibold mb-4">{actionLabel} Items</h2>
        <div className="mb-4 text-sm opacity-80">
          {objectCount > 0 && <div>{objectCount} object{objectCount === 1 ? '' : 's'}</div>}
          {folderCount > 0 && <div>{folderCount} folder{folderCount === 1 ? '' : 's'} recursively</div>}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="batchDestinationBucket" className="block text-sm font-medium mb-2">Destination bucket</label>
            <input
              id="batchDestinationBucket"
              type="text"
              value={destinationBucket}
              onChange={(e) => setDestinationBucket(e.target.value)}
              className="w-full px-3 py-2 border rounded-md input-theme"
              disabled={isSubmitting}
              required
            />
          </div>
          <div>
            <label htmlFor="batchDestinationPrefix" className="block text-sm font-medium mb-2">Destination prefix</label>
            <input
              id="batchDestinationPrefix"
              type="text"
              value={destinationPrefix}
              onChange={(e) => setDestinationPrefix(e.target.value)}
              placeholder="optional/path/"
              className="w-full px-3 py-2 border rounded-md input-theme font-mono"
              disabled={isSubmitting}
            />
            <div className="mt-1 text-xs opacity-70">Items keep their filenames, and folders keep their nested structure.</div>
          </div>
          {error && <div className="alert alert-error text-sm">{error}</div>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={isSubmitting || !destinationBucket.trim()} className="btn btn-primary">
              {isSubmitting ? 'Starting...' : `${actionLabel} Items`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}