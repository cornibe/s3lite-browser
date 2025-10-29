import React, { useState } from 'react'

interface CreateBucketModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateBucket: (bucketName: string, region?: string) => Promise<void>
}

export default function CreateBucketModal({ isOpen, onClose, onCreateBucket }: CreateBucketModalProps) {
  const [bucketName, setBucketName] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bucketName.trim()) return

    setIsCreating(true)
    setError(null)
    
    try {
      await onCreateBucket(bucketName.trim(), region === 'us-east-1' ? undefined : region)
      setBucketName('')
      setRegion('us-east-1')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bucket')
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    if (isCreating) return
    setBucketName('')
    setRegion('us-east-1')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 overlay-bg flex items-center justify-center z-50">
  <div className="menu-bg rounded-lg p-6 w-96 max-w-[90vw] border border-default shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Create New Bucket</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="bucketName" className="block text-sm font-medium mb-2">
              Bucket Name
            </label>
            <input
              id="bucketName"
              type="text"
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value)}
              placeholder="my-bucket-name"
              className="w-full px-3 py-2 border rounded-md input-theme focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isCreating}
              pattern="^[a-z0-9][a-z0-9.-]*[a-z0-9]$"
              minLength={3}
              maxLength={63}
              required
            />
            <p className="text-xs text-neutral-500 mt-1">
              Bucket names must be 3-63 characters, lowercase, and follow DNS naming conventions.
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="region" className="block text-sm font-medium mb-2">
              Region
            </label>
            <select
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 border rounded-md input-theme focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isCreating}
            >
              <option value="us-east-1">US East (N. Virginia) - us-east-1</option>
              <option value="us-east-2">US East (Ohio) - us-east-2</option>
              <option value="us-west-1">US West (N. California) - us-west-1</option>
              <option value="us-west-2">US West (Oregon) - us-west-2</option>
              <option value="eu-west-1">Europe (Ireland) - eu-west-1</option>
              <option value="eu-central-1">Europe (Frankfurt) - eu-central-1</option>
              <option value="ap-southeast-1">Asia Pacific (Singapore) - ap-southeast-1</option>
              <option value="ap-northeast-1">Asia Pacific (Tokyo) - ap-northeast-1</option>
            </select>
          </div>

          {error && (
            <div className="alert alert-error mb-4 text-sm">{error}</div>
          )}

      <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isCreating}
        className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating || !bucketName.trim()}
        className="btn btn-primary"
            >
              {isCreating ? 'Creating...' : 'Create Bucket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
