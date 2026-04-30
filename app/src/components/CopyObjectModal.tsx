import React, { useEffect, useState } from 'react'

interface CopyObjectModalProps {
  isOpen: boolean
  sourceBucket: string
  sourceKey: string
  defaultDestinationBucket: string
  defaultDestinationKey: string
  title?: string
  submitLabel?: string
  onClose: () => void
  onSubmit: (input: { destinationBucket: string; destinationKey: string }) => Promise<void>
}

export default function CopyObjectModal({
  isOpen,
  sourceBucket,
  sourceKey,
  defaultDestinationBucket,
  defaultDestinationKey,
  title = 'Copy Object',
  submitLabel = 'Copy Object',
  onClose,
  onSubmit
}: CopyObjectModalProps) {
  const [destinationBucket, setDestinationBucket] = useState(defaultDestinationBucket)
  const [destinationKey, setDestinationKey] = useState(defaultDestinationKey)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setDestinationBucket(defaultDestinationBucket)
    setDestinationKey(defaultDestinationKey)
    setError(null)
    setIsSubmitting(false)
  }, [isOpen, defaultDestinationBucket, defaultDestinationKey])

  const handleClose = () => {
    if (isSubmitting) return
    setError(null)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nextBucket = destinationBucket.trim()
    const nextKey = destinationKey.trim().replace(/^\/+/, '')
    if (!nextBucket || !nextKey) return
    if (nextBucket === sourceBucket && nextKey === sourceKey) {
      setError('Destination must be different from the source object.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit({ destinationBucket: nextBucket, destinationKey: nextKey })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy object')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 overlay-bg flex items-center justify-center z-50">
      <div className="menu-bg rounded-lg p-6 w-[32rem] max-w-[95vw] border border-default shadow-xl">
        <h2 className="text-lg font-semibold mb-4">{title}</h2>

        <div className="mb-4 text-sm opacity-80 break-all">
          Source: <span className="font-mono">s3://{sourceBucket}/{sourceKey}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="destinationBucket" className="block text-sm font-medium mb-2">
              Destination bucket
            </label>
            <input
              id="destinationBucket"
              type="text"
              value={destinationBucket}
              onChange={(e) => setDestinationBucket(e.target.value)}
              className="w-full px-3 py-2 border rounded-md input-theme"
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label htmlFor="destinationKey" className="block text-sm font-medium mb-2">
              Destination key
            </label>
            <input
              id="destinationKey"
              type="text"
              value={destinationKey}
              onChange={(e) => setDestinationKey(e.target.value)}
              className="w-full px-3 py-2 border rounded-md input-theme font-mono"
              disabled={isSubmitting}
              required
            />
          </div>

          {error && (
            <div className="alert alert-error text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !destinationBucket.trim() || !destinationKey.trim()}
              className="btn btn-primary"
            >
              {isSubmitting ? 'Working...' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}