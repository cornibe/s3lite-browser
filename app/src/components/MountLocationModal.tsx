import React, { useEffect, useState } from 'react'

interface MountLocationModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (bucket: string, prefix?: string) => void
  initialBucket?: string
  initialPrefix?: string
  mode?: 'create' | 'edit'
}

export default function MountLocationModal({ isOpen, onClose, onSubmit, initialBucket, initialPrefix, mode = 'create' }: MountLocationModalProps) {
  const [bucket, setBucket] = useState(initialBucket ?? '')
  const [path, setPath] = useState(initialPrefix ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setBucket('')
      setPath('')
      setError(null)
    } else {
      setBucket(initialBucket ?? '')
      setPath(initialPrefix ?? '')
    }
  }, [isOpen, initialBucket, initialPrefix])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const b = bucket.trim()
    if (!b) { setError('Bucket name is required.'); return }
    // normalize prefix: remove leading '/', ensure ends with '/' if provided and not a specific object
    let p = path.trim()
    if (p.startsWith('/')) p = p.slice(1)
    // leave as-is; user may mount to an object key as well
  onSubmit(b, p || undefined)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/50 flex items-center justify-center z-50">
      <div className="menu-bg rounded-lg p-6 w-96 max-w-[90vw] border border-default shadow-xl">
    <h2 className="text-lg font-semibold mb-3">{mode === 'edit' ? 'Edit mounted location' : 'Mount S3 location'}</h2>
        <p className="text-sm opacity-80 mb-4">
          Add a shortcut to a specific S3 bucket, optionally with a path (prefix). This appears below your bucket list
          and lets you jump directly to a folder or object. Example: bucket "my-logs" with path "2025/09/".
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="mount-bucket" className="block text-sm font-medium mb-2">Bucket name</label>
            <input
              id="mount-bucket"
              type="text"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="my-bucket"
              className="w-full px-3 py-2 border rounded-md input-theme focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="mb-4">
            <label htmlFor="mount-path" className="block text-sm font-medium mb-2">Path (optional)</label>
            <input
              id="mount-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="folder/subfolder/ or object/key.txt"
              className="w-full px-3 py-2 border rounded-md input-theme focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Paths are prefixes inside the bucket. Use forward slashes. Leave empty to mount the bucket root.
            </p>
          </div>
          {error && (
            <div className="alert alert-error mb-4 text-sm">{error}</div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" className="btn btn-primary">{mode === 'edit' ? 'Save' : 'Mount'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
