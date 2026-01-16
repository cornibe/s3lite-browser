import React, { useState } from 'react'

interface DeleteConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  title: string
  message: string
  itemCount?: number
  itemType?: 'file' | 'folder' | 'files'
}

export default function DeleteConfirmationModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  itemCount,
  itemType 
}: DeleteConfirmationModalProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setIsDeleting(true)
    setError(null)
    
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      // Close the modal and let the parent component handle error display (e.g., toast)
      onClose()
    } finally {
      setIsDeleting(false)
    }
  }

  const handleClose = () => {
    if (isDeleting) return
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 overlay-bg flex items-center justify-center z-50">
  <div className="menu-bg rounded-lg p-6 w-96 max-w-[90vw] border border-default shadow-xl">
        <h2 className="text-lg font-semibold mb-4 text-red-600 dark:text-red-400">
          {title}
        </h2>
        
        <div className="mb-4">
          <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-2">
            {message}
          </p>
          
          {itemCount && itemCount > 1 && (
            <div className="alert alert-warn">
              <p className="text-sm">
                ⚠️ This will delete {itemCount} {itemType || 'items'}. This action cannot be undone.
              </p>
            </div>
          )}
          
          {(!itemCount || itemCount === 1) && (
            <div className="alert alert-error">
              <p className="text-sm">
                ⚠️ This action cannot be undone.
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="alert alert-error mb-4 text-sm">{error}</div>
        )}

    <div className="flex justify-end gap-3">
      <button
            type="button"
            onClick={handleClose}
            disabled={isDeleting}
      className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
    className="btn btn-danger"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
