import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'

type MenuSection = 'file' | 'view' | 'help'

const MENU_LABELS: Array<{ section: MenuSection; label: string }> = [
  { section: 'file', label: 'File' },
  { section: 'view', label: 'View' },
  { section: 'help', label: 'Help' }
]

export default function AppMenuBar() {
  const { tabs, activeTabId, bucket, profile, connected, transferStats } = useStore() as any
  const [activeMenu, setActiveMenu] = useState<MenuSection | null>(null)
  const buttonRefs = useRef<Record<MenuSection, HTMLButtonElement | null>>({ file: null, view: null, help: null })
  const clearTimerRef = useRef<number | null>(null)
  const platform = window.api.env.platform()

  useEffect(() => {
    function clearActive() {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current)
      }
      clearTimerRef.current = window.setTimeout(() => setActiveMenu(null), 140)
    }

    window.addEventListener('blur', clearActive)
    return () => {
      window.removeEventListener('blur', clearActive)
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current)
      }
    }
  }, [])

  const activeTab = activeTabId ? tabs?.[activeTabId] : undefined
  const title = useMemo(() => {
    const tabTitle = activeTab?.title || activeTab?.profile || profile
    if (!tabTitle) return 'S3 Browser-lite'
    return `${tabTitle} - S3 Browser-lite`
  }, [activeTab, profile])

  if (platform === 'darwin') return null

  async function openMenu(section: MenuSection) {
    const button = buttonRefs.current[section]
    if (!button) return

    const rect = button.getBoundingClientRect()
    setActiveMenu(section)
    await window.api.ui.popupAppMenu({
      section,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4)
    })

    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
    }
    clearTimerRef.current = window.setTimeout(() => setActiveMenu(null), 140)
  }

  return (
    <div
      className="drag-region h-9 border-b border-default bg-header toolbar-surface text-app"
      style={{ paddingRight: platform === 'win32' ? 148 : 12 }}
    >
      <div className="flex h-full items-center gap-3 px-2">
        <div className="no-drag flex items-center gap-1">
          {MENU_LABELS.map(({ section, label }) => (
            <button
              key={section}
              ref={(node) => { buttonRefs.current[section] = node }}
              type="button"
              className="menu-trigger"
              data-active={activeMenu === section}
              onClick={() => { void openMenu(section) }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-panel-strong border border-default text-[11px] font-semibold text-app">
            S3
          </div>
          <div className="min-w-0 text-xs font-medium tracking-[0.02em] text-app truncate">
            {title}
          </div>
        </div>

        <div className="ml-auto no-drag flex items-center gap-2">
          <div className={`status-pill ${connected ? 'status-pill-strong' : ''}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span>{connected ? 'Connected' : 'Offline'}</span>
          </div>
          {profile && (
            <div className="status-pill max-w-40 truncate" title={profile}>
              {profile}
            </div>
          )}
          {bucket && (
            <div className="status-pill max-w-48 truncate" title={bucket}>
              {bucket}
            </div>
          )}
          {transferStats?.active > 0 && (
            <div className="status-pill" title="Active transfers">
              {transferStats.active} transfer{transferStats.active === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}