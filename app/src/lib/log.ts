type Lvl = 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'

const order: Record<Lvl, number> = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 }
let consoleLevel: Lvl = 'INFO'
const lastTrace: Record<string, number> = {}
const COALESCE_MS = 120
let bridgeAvailable = true
let warnedBridge = false
let lastBridgeFail = 0
const RETRY_MS = 1000

function shouldConsole(level: Lvl) { return order[level] >= order[consoleLevel] }

export function setConsoleVerbose(v: boolean) { consoleLevel = v ? 'TRACE' : 'INFO' }
export function setConsoleLevel(level: Lvl) { consoleLevel = level }

export function log(level: Lvl, scope: string, msg: string, meta?: Record<string, unknown>) {
  if (level === 'TRACE') {
    const key = scope + '|' + msg
    const now = Date.now()
    const last = lastTrace[key] || 0
    if (now - last < COALESCE_MS) return
    lastTrace[key] = now
  }
  const now = Date.now()
  if (bridgeAvailable || (now - lastBridgeFail) > RETRY_MS) {
    try {
      const p: Promise<void> = (window as any).api?.log?.write({ level, scope, msg, meta })
      if (p && typeof p.then === 'function') {
        p.catch(() => {
          bridgeAvailable = false
          lastBridgeFail = Date.now()
          if (!warnedBridge) { warnedBridge = true; console.warn('[log] bridge unavailable; console-only logging') }
        })
      }
    } catch {
      bridgeAvailable = false
      lastBridgeFail = Date.now()
      if (!warnedBridge) { warnedBridge = true; console.warn('[log] bridge unavailable; console-only logging') }
    }
  }
  if (shouldConsole(level) && process.env.NODE_ENV !== 'production') {
    const fn = level === 'ERROR' || level === 'FATAL' ? console.error : level === 'WARN' ? console.warn : console.log
    fn(`[${scope}]`, msg, meta || '')
  }
}

export const trace = (s: string, m: string, meta?: Record<string, unknown>) => log('TRACE', s, m, meta)
export const debug = (s: string, m: string, meta?: Record<string, unknown>) => log('DEBUG', s, m, meta)
export const info = (s: string, m: string, meta?: Record<string, unknown>) => log('INFO', s, m, meta)
export const warn = (s: string, m: string, meta?: Record<string, unknown>) => log('WARN', s, m, meta)
export const error = (s: string, m: string, meta?: Record<string, unknown>) => log('ERROR', s, m, meta)
