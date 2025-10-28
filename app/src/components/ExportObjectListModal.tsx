import React, { useState } from 'react'
import type { S3ObjectItem, S3Folder } from '../../electron/types'

export type ExportField = 'path' | 'size' | 'storageClass'

interface Props {
  isOpen: boolean
  onClose: () => void
  bucket: string
  currentPrefix: string
  selection: Array<{ type: 'object'; data: S3ObjectItem } | { type: 'folder'; data: S3Folder }>
}

export default function ExportObjectListModal({ isOpen, onClose, bucket, currentPrefix, selection }: Props) {
  const [fields, setFields] = useState(['path','size','storageClass'] as ExportField[])
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState(null as string | null)

  if (!isOpen) return null

  function toggleField(f: ExportField) {
    setFields(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function handleExport() {
    setIsExporting(true)
    setError(null)
    try {
      // Build rows. For folders, recursively fetch all objects within them.
      const rows: Array<Record<string, any>> = []
      
      for (const item of selection) {
        if (item.type === 'object') {
          // Simple object - add directly
          const obj: Record<string, any> = {}
          if (fields.includes('path')) {
            obj.path = `s3://${bucket}/${item.data.key}`
          }
          if (fields.includes('size')) {
            obj.size = item.data.size
          }
          if (fields.includes('storageClass')) {
            obj.storageClass = item.data.storageClass || ''
          }
          rows.push(obj)
        } else {
          // Folder - recursively fetch all objects with full metadata
          let token: string | undefined = undefined
          do {
            const res = await (window as any).api.s3.listObjectsRecursive({ 
              bucket, 
              prefix: item.data.prefix, 
              token,
              maxKeys: 2000
            })
            
            // Add each object from this page
            if (res.objects && Array.isArray(res.objects)) {
              for (const objData of res.objects) {
                const obj: Record<string, any> = {}
                if (fields.includes('path')) {
                  obj.path = `s3://${bucket}/${objData.key}`
                }
                if (fields.includes('size')) {
                  obj.size = objData.size
                }
                if (fields.includes('storageClass')) {
                  obj.storageClass = objData.storageClass || ''
                }
                rows.push(obj)
              }
            }
            
            token = res.nextToken
          } while (token)
        }
      }
  const defaultName = selection.length > 1 ? 'objects' : (selection[0]?.type === 'folder' ? selection[0].data.prefix.split('/').filter(Boolean).slice(-1)[0] : selection[0]?.type === 'object' ? selection[0].data.key.split('/').slice(-1)[0] : 'objects')
  const d = new Date(); const pad = (n: number) => n.toString().padStart(2,'0')
  const dateStamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
      const defaultPath = `${defaultName || 'objects'}_${dateStamp}.csv`
      const res = await (window as any).api.ui.exportObjectList({ defaultPath, rows })
      if (!res?.ok) {
        if (res?.canceled) { setIsExporting(false); onClose(); return }
        throw new Error(res?.error || 'Export failed')
      }
      onClose()
    } catch (e) {
      setError((e as Error)?.message || 'Failed to export')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 overlay-bg" onClick={() => !isExporting && onClose()} />
      <div className="relative z-10 w-[480px] max-w-[95vw] rounded menu-bg border border-default p-4 shadow">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-base">Export Object List</h2>
          <button className="btn btn-secondary text-xs cursor-pointer" disabled={isExporting} onClick={onClose}>Close</button>
        </div>
        <div className="text-sm space-y-4">
          <div>
            <div className="mb-1 font-medium">Fields</div>
            <div className="flex flex-col gap-1">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="checkbox" checked={fields.includes('path')} onChange={() => toggleField('path')} />
                <span>S3 Path</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="checkbox" checked={fields.includes('size')} onChange={() => toggleField('size')} />
                <span>File Size (bytes)</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="checkbox" checked={fields.includes('storageClass')} onChange={() => toggleField('storageClass')} />
                <span>Storage Class</span>
              </label>
            </div>
          </div>
          <div className="opacity-70">Exporting {selection.length} item{selection.length !== 1 && 's'} from <span className="font-mono">s3://{bucket}/{currentPrefix}</span></div>
          {error && <div className="alert alert-error text-xs">{error}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary text-xs cursor-pointer" disabled={isExporting} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary text-xs cursor-pointer disabled:opacity-50" disabled={isExporting || fields.length === 0} onClick={handleExport}>{isExporting ? 'Exporting…' : 'Export CSV'}</button>
        </div>
      </div>
    </div>
  )
}
