import React, { useEffect, useState } from 'react'
import { useStore } from '../lib/store'

export default function BottomTaskbar() {
  const { transferStats } = useStore()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    // Refresh frequently during large transfers
    const id = setInterval(() => setTick(t => (t + 1) % 1000), 2000)
    return () => clearInterval(id)
  }, [])

  // Stats now come from persistent counters maintained in the store/router
  const stats = transferStats

  return (
    <div className="flex items-center gap-3 px-2 h-7 text-xs border-t border-default bg-header">
      <div className="opacity-80 select-none">Transfers:</div>
      <div className="opacity-80">Active: <span className="font-medium">{stats.active}</span></div>
      <div className="opacity-80">Queued: <span className="font-medium">{stats.queued}</span></div>
  <div className="opacity-80">Completed: <span className="font-medium">{stats.completedLifetime}</span></div>
    </div>
  )
}
