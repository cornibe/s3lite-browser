import React, { useMemo } from 'react'
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
  const items = useMemo(() => tabOrder.map((id: string) => tabs[id]).filter(Boolean), [tabs, tabOrder])

  // Pre-compute how many tabs exist per profile name
  const profileCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of items) {
      const p = t?.profile as string | undefined
      if (!p) continue
      counts.set(p, (counts.get(p) || 0) + 1)
    }
    return counts
  }, [items])

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-default bg-header text-app select-none">
      <div className="flex items-center gap-1 overflow-auto" role="tablist" aria-label="Tabs">
        {(() => {
          // Keep sequence per profile for numbering (1), (2), ...
          const seq = new Map<string, number>()
          return items.map((t: any) => {
            const active = t.id === activeTabId
            const profile: string | undefined = t.profile
            let title: string = t.title || 'New tab'
            if (profile) {
              const total = profileCounts.get(profile) || 0
              if (total > 1) {
                const n = (seq.get(profile) || 0) + 1
                seq.set(profile, n)
                title = `${profile} (${n})`
              } else {
                title = profile
              }
            }

            return (
              <div key={t.id} className={`group flex items-center max-w-[22rem] text-sm`} role="presentation">
                <div
                  onClick={() => activateTab(t.id)}
                  className={`tab-btn ${active ? 'tab-btn-active' : ''} flex items-center gap-1 truncate`}
                  role="tab"
                  aria-selected={active}
                  title={title}
                >
                  <span className="truncate">{title}</span>
                  {items.length > 1 && (
                    <button
                      className="p-0.5 opacity-70 hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
                      aria-label="Close tab"
                      title="Close"
                    >
                      <CloseIcon />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        })()}
        {/* New Tab button placed immediately after the last tab */}
        <button
          className="tab-btn inline-flex items-center justify-center"
          onClick={() => newTab()}
          aria-label="New tab"
          title="New tab"
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  )
}
