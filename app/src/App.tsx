import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import Topbar from './components/Topbar'
import SidebarBuckets from './components/SidebarBuckets'
import ObjectExplorer from './components/ObjectExplorer'
import TransferQueue from './components/TransferQueue'
import SettingsModal from './components/SettingsModal'
import { useStore } from './lib/store'

export default function App() {
  const { settings, setSettings } = useStore()
  const [drag, setDrag] = useState<null | { type: 'sidebar' | 'queue'; startX: number; startY: number; startSidebar: number; startQueue: number }>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const minSidebar = 180
  const maxSidebar = 600
  const minQueue = 120
  const maxQueue = 600
  const sidebarWidth = useMemo(() => Math.min(maxSidebar, Math.max(minSidebar, settings.sidebarWidthPx ?? 256)), [settings.sidebarWidthPx])
  const queueHeight = useMemo(() => Math.min(maxQueue, Math.max(minQueue, settings.queueHeightPx ?? 220)), [settings.queueHeightPx])

  // Apply dark mode class on initial load and when settings change
  useEffect(() => {
    if (settings.darkMode) {
      document.documentElement.classList.add('dark')
  document.body.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
  document.body.classList.remove('dark')
    }
  }, [settings.darkMode])

  // Ensure dark mode is applied immediately on app load
  useEffect(() => {
    if (settings.darkMode) {
      document.documentElement.classList.add('dark')
  document.body.classList.add('dark')
    }
  }, [])

  // Drag handlers
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag) return
      if (drag.type === 'sidebar') {
        const dx = e.clientX - drag.startX
        const next = Math.min(maxSidebar, Math.max(minSidebar, drag.startSidebar + dx))
        setSettings({ sidebarWidthPx: next })
      } else if (drag.type === 'queue') {
        const dy = drag.startY - e.clientY // invert so dragging up increases height
        const next = Math.min(maxQueue, Math.max(minQueue, drag.startQueue + dy))
        setSettings({ queueHeightPx: next })
      }
    }
    function onUp() { setDrag(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [drag, setSettings])

  function startSidebarDrag(e: React.MouseEvent) {
    setDrag({ type: 'sidebar', startX: e.clientX, startY: e.clientY, startSidebar: sidebarWidth, startQueue: queueHeight })
  }
  function startQueueDrag(e: React.MouseEvent) {
    setDrag({ type: 'queue', startX: e.clientX, startY: e.clientY, startSidebar: sidebarWidth, startQueue: queueHeight })
  }

  const dark = Boolean(settings.darkMode)
  return (
    <div ref={containerRef} className={dark ? 'dark h-full' : 'h-full'}>
      <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-[#1e1e1e] text-black dark:text-[#cccccc]">
        <Topbar />
        {/* Main area: sidebar | resizer | content */}
        <div className="flex flex-1 overflow-hidden">
          <div style={{ width: sidebarWidth }} className="flex-shrink-0 h-full">
            <SidebarBuckets />
          </div>
          {/* Vertical resizer */}
          <button
            aria-label="Resize sidebar"
            onMouseDown={startSidebarDrag}
            className={`w-1.5 cursor-col-resize hover:w-2 transition-[width] flex items-center justify-center select-none ${dark ? 'bg-[#2a2d2e] hover:bg-[#323233]' : 'bg-neutral-200 hover:bg-neutral-300'}`}
            title="Drag to resize"
          >
            <svg className="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M10 4h2v16h-2V4zm4 0h2v16h-2V4z" />
            </svg>
          </button>
          <div className="flex-1 h-full min-w-0">
            <ObjectExplorer />
          </div>
        </div>
        {/* Horizontal resizer above transfer queue */}
        <button
          aria-label="Resize transfer queue"
          onMouseDown={startQueueDrag}
          className={`h-1.5 cursor-row-resize hover:h-2 transition-[height] flex items-center justify-center select-none ${dark ? 'bg-[#2a2d2e] hover:bg-[#323233]' : 'bg-neutral-200 hover:bg-neutral-300'}`}
          title="Drag to resize"
        >
          <svg className="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M4 10h16v2H4v-2zm0 4h16v2H4v-2z" />
          </svg>
        </button>
        <div style={{ height: queueHeight }} className="flex-none overflow-hidden">
          <TransferQueue />
        </div>
        <SettingsModal />
      </div>
    </div>
  )
}
