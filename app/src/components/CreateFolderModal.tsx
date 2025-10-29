import React, { useState } from 'react'

interface CreateFolderModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateFolder: (folderName: string) => Promise<void>
  currentPrefix: string
}

export default function CreateFolderModal({ isOpen, onClose, onCreateFolder, currentPrefix }: CreateFolderModalProps) {
  const [folderName, setFolderName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderName.trim()) return

    setIsCreating(true)
    setError(null)
    
    try {
      await onCreateFolder(folderName.trim())
      setFolderName('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    if (isCreating) return
    setFolderName('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 overlay-bg flex items-center justify-center z-50">
  <div className="menu-bg rounded-lg p-6 w-96 max-w-[90vw] border border-default shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Create New Folder</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="folderName" className="block text-sm font-medium mb-2">
              Folder Name
            </label>
            {currentPrefix && (
              <div className="text-xs text-neutral-500 mb-2">
                Will be created in: {currentPrefix}
              </div>
            )}
            <input
              id="folderName"
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="folder-name"
              className="w-full px-3 py-2 border rounded-md input-theme focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isCreating}
              pattern="^[^/]*$"
              required
            />
            <p className="text-xs text-neutral-500 mt-1">
              Folder names cannot contain forward slashes (/).
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-md text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
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
              disabled={isCreating || !folderName.trim()}
        className="btn btn-primary"
            >
              {isCreating ? 'Creating...' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
