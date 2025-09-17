import React, { useMemo, useState } from 'react'
import { useStore } from '../lib/store'

function PlusIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
    </svg>
  )
}

function CloseIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.18 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42z" />
    </svg>
  )
}

export default function TabBar() {
  const { tabs, tabOrder, activeTabId, activateTab, newTab, closeTab } = useStore() as any
  const [hoverId, setHoverId] = useState<string | null>(null)
  const items = useMemo(() => tabOrder.map((id: string) => tabs[id]).filter(Boolean), [tabs, tabOrder])

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-default bg-header text-app select-none">
      <div className="flex items-center gap-1 overflow-auto">
        {items.map((t: any) => {
          const active = t.id === activeTabId
          const title = t.title || (t.bucket ? `${t.bucket}${t.prefix ? '/' + t.prefix : ''}` : (t.profile || 'New tab'))
          return (
            <div key={t.id} className={`group flex items-center max-w-[22rem] text-sm rounded ${active ? 'selected-row' : 'row-hover'}`}
                 onMouseEnter={() => setHoverId(t.id)} onMouseLeave={() => setHoverId(null)}>
              <button
                onClick={() => activateTab(t.id)}
                className={`px-3 py-1 truncate`}
                title={title}
              >
                {title}
              </button>
              {items.length > 1 && (
                <button
                  className={`px-1 py-1 opacity-70 hover:opacity-100`}
                  onClick={() => closeTab(t.id)}
                  aria-label="Close tab"
                  title="Close"
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="ml-auto">
        <button className="px-2 py-1 row-hover rounded inline-flex items-center gap-1 cursor-pointer" onClick={() => newTab()} aria-label="New tab">
          <PlusIcon />
          <span className="text-sm">New Tab</span>
        </button>
      </div>
    </div>
  )
}
