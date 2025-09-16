import React, { useState, useEffect } from 'react'
import { useStore } from '../lib/store'

export default function SettingsModal() {
  const { isSettingsOpen, closeSettings, settings, setSettings } = useStore()
  const [local, setLocal] = useState(settings)

  useEffect(() => { if (isSettingsOpen) setLocal(settings) }, [isSettingsOpen, settings])
  if (!isSettingsOpen) return null

  function save() {
    setSettings(local)
    closeSettings()
  }

  function onKey(e: React.KeyboardEvent) { if (e.key === 'Escape') closeSettings() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={onKey}>
  <div className="absolute inset-0 bg-black/40" onClick={closeSettings} />
  <div className="relative menu-bg border border-default rounded shadow-xl w-[560px] max-w-[95vw] p-4">
        <div className="text-lg font-semibold mb-2">Settings</div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">When file exists (downloads)</label>
            <select className="w-full px-2 py-1 rounded border text-sm input-theme" value={local.overwritePolicy}
              onChange={e => setLocal(s => ({ ...s, overwritePolicy: e.target.value as any }))}>
              <option value="prompt">Prompt (Ask every time)</option>
              <option value="overwrite">Overwrite</option>
              <option value="skip">Skip</option>
              <option value="rename">Auto-rename (name (n))</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Object concurrency</label>
              <input className="w-full px-2 py-1 rounded border text-sm input-theme" type="number" min={1} max={32}
                value={local.objectConcurrency ?? ''} placeholder="4"
                onChange={e => setLocal(s => ({ ...s, objectConcurrency: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Part concurrency</label>
              <input className="w-full px-2 py-1 rounded border text-sm input-theme" type="number" min={1} max={32}
                value={local.partConcurrency ?? ''} placeholder="8"
                onChange={e => setLocal(s => ({ ...s, partConcurrency: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Part size (MiB)</label>
              <input className="w-full px-2 py-1 rounded border text-sm input-theme" type="number" min={5} max={128}
                value={local.partSizeMiB ?? ''} placeholder="16"
                onChange={e => setLocal(s => ({ ...s, partSizeMiB: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Multipart threshold (MiB)</label>
              <input className="w-full px-2 py-1 rounded border text-sm input-theme" type="number" min={8} max={128}
                value={local.multipartThresholdMiB ?? ''} placeholder="16"
                onChange={e => setLocal(s => ({ ...s, multipartThresholdMiB: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input id="requesterPays" type="checkbox" className="h-4 w-4" checked={Boolean(local.requesterPays)} onChange={e => setLocal(s => ({ ...s, requesterPays: e.target.checked }))} />
            <label htmlFor="requesterPays" className="text-sm">Requester pays</label>
          </div>

          <div className="flex items-center gap-2">
            <input id="darkMode" type="checkbox" className="h-4 w-4" checked={Boolean(local.darkMode)} onChange={e => setLocal(s => ({ ...s, darkMode: e.target.checked }))} />
            <label htmlFor="darkMode" className="text-sm">Dark mode</label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Bandwidth limit (KB/s)</label>
            <input className="w-full px-2 py-1 rounded border text-sm input-theme" type="number" min={0}
              value={local.bandwidthLimitKBps ?? ''} placeholder="0 (unlimited)"
              onChange={e => setLocal(s => ({ ...s, bandwidthLimitKBps: e.target.value ? Number(e.target.value) : undefined }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={closeSettings}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
