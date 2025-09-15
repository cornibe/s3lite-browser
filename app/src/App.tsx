import { useEffect } from 'react'
import Topbar from './components/Topbar'
import SidebarBuckets from './components/SidebarBuckets'
import ObjectExplorer from './components/ObjectExplorer'
import TransferQueue from './components/TransferQueue'
import SettingsModal from './components/SettingsModal'
import { useStore } from './lib/store'

export default function App() {
  const { settings } = useStore()

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

  return (
    <div className={settings.darkMode ? 'dark h-full' : 'h-full'}>
      <div className="h-full min-h-[800px] min-w-[1200px] flex flex-col bg-white dark:bg-[#1e1e1e] text-black dark:text-[#cccccc]">
        <Topbar />
        <div className="flex flex-1 overflow-hidden">
          <SidebarBuckets />
          <ObjectExplorer />
        </div>
        <TransferQueue />
        <SettingsModal />
      </div>
    </div>
  )
}
