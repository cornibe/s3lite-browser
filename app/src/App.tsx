import Topbar from './components/Topbar'
import SidebarBuckets from './components/SidebarBuckets'
import ObjectExplorer from './components/ObjectExplorer'
import TransferQueue from './components/TransferQueue'

export default function App() {
  return (
    <div className="h-full min-h-[800px] min-w-[1200px] flex flex-col">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <SidebarBuckets />
        <ObjectExplorer />
      </div>
      <TransferQueue />
    </div>
  )
}
