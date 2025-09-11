import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query'
import './index.css'
import { error, info, setConsoleLevel } from './lib/log'

// Global error hooks for renderer
window.addEventListener('error', (e) => { error('error', 'renderer uncaught error', { message: e.error?.message || e.message }) })
window.addEventListener('unhandledrejection', (e) => { error('error', 'renderer unhandled rejection', { reason: String((e as any).reason) }) })

// Mirror current level from main for console echo in dev
;(async () => {
  try {
    const res = await (window as any).api.log.getConsoleLevel()
    if (res?.level) setConsoleLevel(res.level)
  } catch {}
})()

info('init', 'renderer starting')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
