import fs from 'fs'
import os from 'os'
import path from 'path'
import { app, shell } from 'electron'

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

type LogEntry = {
  time: Date
  level: LogLevel
  process: 'main' | 'renderer'
  pid: number
  sessionId: string
  scope: string
  msg: string
  meta?: Record<string, unknown>
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60
}

function pad(n: number, w = 2) { return n.toString().padStart(w, '0') }
function tzOffsetString(d: Date) {
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
function isoWithTz(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}${tzOffsetString(d)}`
}

function todayKey(d: Date) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` }

function quoteIfNeeded(v: string): string {
  if (v === '' || /\s|"/.test(v)) return '"' + v.replace(/"/g, '\\"') + '"'
  return v
}

export function redact(value: unknown): unknown {
  try {
    if (value == null) return value
    if (typeof value === 'string') {
      // redact obvious secrets and long base64/hex tokens
      if (/AWS(AccessKey|Secret|SessionToken)|aws_access_key_id|aws_secret_access_key|sessionToken|Authorization|X-Amz-|X-Auth|Bearer/i.test(value)) return '[REDACTED]'
      if (/^(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9\/+]{40,}={0,2})$/.test(value.trim())) return '[REDACTED]'
      // redact potential query params with X-Amz-
      try { const u = new URL(value); if ([...u.searchParams.keys()].some(k => /^X-Amz-|Signature|Authorization/i.test(k))) return '[REDACTED]'; } catch {}
      return value
    }
    if (Array.isArray(value)) return value.map(v => redact(v))
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {}
      const obj = value as Record<string, unknown>
      for (const [k, v] of Object.entries(obj)) {
        if (/aws_access_key_id|aws_secret_access_key|session(token)?|authorization|password|secret/i.test(k)) out[k] = '[REDACTED]'
        else out[k] = redact(v)
      }
      return out
    }
    return value
  } catch {
    return '[REDACTED]'
  }
}

function formatLine(e: LogEntry): string {
  const base = `${isoWithTz(e.time)} ${e.level} process=${e.process} pid=${e.pid} sessionId=${e.sessionId} scope=${e.scope} msg=${quoteIfNeeded(e.msg)}`
  const parts: string[] = [base]
  if (e.meta) {
    for (const [k, v] of Object.entries(e.meta)) {
      const val = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
      parts.push(`${k}=${quoteIfNeeded(String(val))}`)
    }
  }
  return parts.join(' ') + os.EOL
}

function resolveBaseLogDir(): string {
  const envDir = process.env.S3B_LOG_DIR
  if (envDir && envDir.trim()) return envDir
  const platform = process.platform
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(localAppData, 'S3Browser', 'Logs')
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', 'S3Browser')
  }
  // linux
  const xdg = process.env.XDG_STATE_HOME
  if (xdg && xdg.trim()) return path.join(xdg, 's3-browser', 'logs')
  const localState = path.join(os.homedir(), '.local', 'state', 's3-browser', 'logs')
  const cache = path.join(os.homedir(), '.cache', 's3-browser', 'logs')
  return localState || cache
}

function pickDefaultLevel(): LogLevel {
  const isDev = process.env.NODE_ENV !== 'production'
  return isDev ? 'DEBUG' : 'INFO'
}

function parseLevel(l?: string | null): LogLevel | undefined {
  if (!l) return undefined
  const u = l.toUpperCase()
  if ((['TRACE','DEBUG','INFO','WARN','ERROR','FATAL'] as const).includes(u as LogLevel)) return u as LogLevel
  return undefined
}

export class Logger {
  private dir: string
  private sessionId: string
  private level: LogLevel
  private consoleLevel: LogLevel
  private currentDateKey: string
  private baseFilename: string
  private currentPath: string
  private sizeBytes: number
  private queue: string[] = []
  private writing = false
  private droppedTrace = 0
  private maxSize = 10 * 1024 * 1024

  constructor(opts?: { level?: LogLevel; dir?: string }) {
    this.dir = opts?.dir || resolveBaseLogDir()
    this.sessionId = cryptoRandomId()
    this.level = opts?.level || this.resolveEffectiveLevel()
    this.consoleLevel = this.level
    this.currentDateKey = todayKey(new Date())
    this.baseFilename = `s3-browser-${this.currentDateKey}.log`
    this.currentPath = path.join(this.dir, this.baseFilename)
    this.sizeBytes = 0
  }

  private resolveEffectiveLevel(): LogLevel {
    const env = parseLevel(process.env.S3B_LOG_LEVEL || null)
    const cli = parseLevel(getArgValue('--log-level'))
    return cli || env || pickDefaultLevel()
  }

  getLevel() { return this.level }
  setLevel(l: LogLevel) { this.level = l }
  getConsoleLevel() { return this.consoleLevel }
  setConsoleLevel(l: LogLevel) { this.consoleLevel = l }
  getSessionId() { return this.sessionId }
  getDir() { return this.dir }
  getCurrentPath() { return this.currentPath }

  async init() {
    await fs.promises.mkdir(this.dir, { recursive: true })
    try {
      const stat = await fs.promises.stat(this.currentPath)
      this.sizeBytes = stat.size
    } catch { this.sizeBytes = 0 }
  }

  trace(scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') { this.log('TRACE', scope, msg, meta, proc) }
  debug(scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') { this.log('DEBUG', scope, msg, meta, proc) }
  info(scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') { this.log('INFO', scope, msg, meta, proc) }
  warn(scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') { this.log('WARN', scope, msg, meta, proc) }
  error(scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') { this.log('ERROR', scope, msg, meta, proc) }
  fatal(scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') { this.log('FATAL', scope, msg, meta, proc) }

  log(level: LogLevel, scope: string, msg: string, meta?: Record<string, unknown>, proc: 'main' | 'renderer' = 'main') {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return
    const now = new Date()
    this.rotateIfNeeded(now)
    const redacted = meta ? redact(meta) as Record<string, unknown> : undefined
    const entry: LogEntry = { time: now, level, process: proc, pid: process.pid, sessionId: this.sessionId, scope, msg, meta: redacted }
    const line = formatLine(entry)

    if (process.env.NODE_ENV !== 'production') {
      if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.consoleLevel]) {
        const prefix = `[${scope}]`
        // eslint-disable-next-line no-console
        ;(console as any)[level === 'ERROR' || level === 'FATAL' ? 'error' : level === 'WARN' ? 'warn' : 'log'](prefix, msg, redacted || '')
      }
    }

    // Back-pressure: prevent unbounded queue; drop TRACE if queue huge
    if (this.queue.length > 5000 && level === 'TRACE') {
      this.droppedTrace++
      return
    }
    this.queue.push(line)
    if (!this.writing) void this.flush()
  }

  private async flush() {
    this.writing = true
    try {
      if (this.droppedTrace > 0) {
        const note = formatLine({ time: new Date(), level: 'DEBUG', process: 'main', pid: process.pid, sessionId: this.sessionId, scope: 'log', msg: 'dropped trace logs', meta: { count: this.droppedTrace } })
        this.queue.unshift(note)
        this.droppedTrace = 0
      }
      while (this.queue.length > 0) {
        const chunk = this.queue.splice(0, 100).join('')
        await fs.promises.appendFile(this.currentPath, chunk, 'utf8')
        this.sizeBytes += Buffer.byteLength(chunk)
        if (this.sizeBytes >= this.maxSize) await this.rotateBySize()
      }
    } catch {
      // swallow
    } finally {
      this.writing = false
    }
  }

  private rotateIfNeeded(now: Date) {
    const key = todayKey(now)
    if (key !== this.currentDateKey) {
      this.currentDateKey = key
      this.baseFilename = `s3-browser-${this.currentDateKey}.log`
      this.currentPath = path.join(this.dir, this.baseFilename)
      this.sizeBytes = 0
    }
  }

  private async rotateBySize() {
    try {
      // roll .2 -> .3, .1 -> .2, base -> .1, then fresh base
      const p1 = path.join(this.dir, `${this.baseFilename}.1`)
      const p2 = path.join(this.dir, `${this.baseFilename}.2`)
      const p3 = path.join(this.dir, `${this.baseFilename}.3`)
      try { await fs.promises.unlink(p3) } catch {}
      try { await fs.promises.rename(p2, p3) } catch {}
      try { await fs.promises.rename(p1, p2) } catch {}
      try { await fs.promises.rename(this.currentPath, p1) } catch {}
    } catch {}
    this.sizeBytes = 0
  }

  async flushAndClose() {
    // best-effort flush queue
    const start = Date.now()
    while ((this.queue.length > 0 || this.writing) && Date.now() - start < 2000) {
      if (!this.writing) await this.flush()
      await new Promise(r => setTimeout(r, 10))
    }
  }

  async openLogsFolder() {
    await fs.promises.mkdir(this.dir, { recursive: true })
    await shell.openPath(this.dir)
  }
}

let singleton: Logger | null = null

export function initLogger(): Logger {
  if (!singleton) singleton = new Logger()
  return singleton
}
export function getLogger(): Logger {
  if (!singleton) singleton = new Logger()
  return singleton
}

function getArgValue(flag: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(flag + '='))
  if (arg) return arg.slice(flag.length + 1)
  const idx = process.argv.findIndex(a => a === flag)
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  return undefined
}

function cryptoRandomId() {
  try {
    const { randomUUID } = require('crypto') as typeof import('crypto')
    return randomUUID()
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

export function safeMeta(meta?: Record<string, unknown>) {
  return (meta ? (redact(meta) as Record<string, unknown>) : undefined)
}
