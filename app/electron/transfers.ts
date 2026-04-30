import { BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { S3Client, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getLogger } from './log'
import type { DownloadSettings, StartObjectDownload, StartPrefixDownload, StartUploadParams, TransferEvent, TransferItem, TransferJob } from './types'
import { IpcChannels } from './types'
import { init as s3Init } from './s3'

let s3ClientRef: S3Client | null = null
function ensureClient(): S3Client {
  if (!s3ClientRef) throw new Error('S3 client not initialized. Connect to a profile first.')
  return s3ClientRef
}
export function bindS3Client(c: S3Client | null) { s3ClientRef = c }

const DEFAULTS = {
  objectConcurrency: 4,
  partConcurrency: 8,
  partSizeMiB: 16,
  multipartThresholdMiB: 16,
  overwritePolicy: 'prompt' as const
}

type Manifest = {
  bucket: string
  key: string
  size: number
  etag?: string
  partSize: number
  parts: Array<{ start: number; end: number; done: boolean }>
}
type UploadManifest = {
  bucket: string
  key: string
  size: number
  partSize: number
  uploadId: string
  parts: Array<{ partNumber: number; start: number; end: number; etag?: string }>
}

const jobs = new Map<string, TransferJob>()
const items = new Map<string, TransferItem>()

function newId(prefix = 'job'): string { return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}` }

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

function applyDefaults(s?: DownloadSettings) {
  return {
    objectConcurrency: clamp(s?.objectConcurrency ?? DEFAULTS.objectConcurrency, 1, 32),
    partConcurrency: clamp(s?.partConcurrency ?? DEFAULTS.partConcurrency, 1, 32),
    partSizeMiB: clamp(s?.partSizeMiB ?? DEFAULTS.partSizeMiB, 5, 128),
    multipartThresholdMiB: clamp(s?.multipartThresholdMiB ?? DEFAULTS.multipartThresholdMiB, 8, 128),
    overwritePolicy: s?.overwritePolicy ?? DEFAULTS.overwritePolicy,
    bandwidthLimitKBps: s?.bandwidthLimitKBps,
    requesterPays: s?.requesterPays
  }
}

function emit(win: BrowserWindow | null, evt: TransferEvent) {
  if (!win) return
  win.webContents.send(IpcChannels.XFER_EVENT, evt)
}

const activeStreams = new Map<string, NodeJS.ReadableStream>()
let lastEmitMap: Record<string, number> = {}
function emitThrottled(win: BrowserWindow | null, evt: TransferEvent, key?: string) {
  const now = Date.now()
  const k = key || (evt.type === 'item-state' ? evt.item.id : evt.type === 'job-state' ? evt.job.id : undefined)
  if (k) {
    const last = lastEmitMap[k] || 0
    const isTerminal = evt.type === 'item-state' ? ['completed','failed','canceled'].includes(evt.item.status) : false
    if (!isTerminal && now - last < 150) return
    lastEmitMap[k] = now
  }
  emit(win, evt)
}

function recalcJobProgress(job: TransferJob) {
  let sum = 0
  for (const it of items.values()) if (it.jobId === job.id) sum += Math.min(it.bytesTransferred, it.size)
  job.completedBytes = Math.min(sum, job.totalBytes)
}

function sanitizeWindows(name: string) {
  const reserved = /[<>:\"/\\|?*]/g
  return name.replace(reserved, '_')
}

// Sanitize a relative path while preserving its directory structure.
// Each segment is cleaned for Windows-invalid characters, but path separators are kept.
function sanitizeRelativePathPreserveDirs(relPath: string) {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean)
  const cleaned = parts.map(seg => sanitizeWindows(seg))
  return cleaned.join(path.sep)
}

function safeJoin(base: string, rel: string) {
  const norm = rel.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').join(path.sep)
  return path.join(base, norm)
}

async function ensureDir(p: string) { await fs.promises.mkdir(p, { recursive: true }) }

function atomicPaths(finalPath: string) { return { part: finalPath + '.part', manifest: finalPath + '.part.json' } }

async function readManifest(p: string): Promise<Manifest | undefined> { try { const raw = await fs.promises.readFile(p, 'utf8'); return JSON.parse(raw) } catch { return undefined } }
async function writeManifest(p: string, m: Manifest) { await fs.promises.writeFile(p, JSON.stringify(m)) }
async function writeUploadManifest(p: string, m: UploadManifest) { await fs.promises.writeFile(p, JSON.stringify(m)) }

async function fsync(fd: number) { await new Promise<void>(resolve => { try { fs.fsync(fd, () => resolve()) } catch { resolve() } }) }

function speedEta(bytesTransferred: number, startedAt?: number, total?: number) {
  if (!startedAt) return { speedBps: 0, etaSeconds: undefined as number | undefined }
  const dt = Math.max(1, Date.now() - startedAt) / 1000
  const speed = bytesTransferred / dt
  let eta: number | undefined
  if (total && speed > 0) eta = Math.max(0, Math.round((total - bytesTransferred) / speed))
  return { speedBps: Math.round(speed), etaSeconds: eta }
}

async function fileExists(p: string) { try { await fs.promises.access(p, fs.constants.F_OK); return true } catch { return false } }

function splitName(name: string) { const ext = path.extname(name); const base = ext ? name.slice(0, -ext.length) : name; return { base, ext } }

async function chooseDestPath(dir: string, name: string, policy: 'skip'|'overwrite'|'rename'|'prompt', win?: BrowserWindow): Promise<{ path: string; action: 'write'|'skip' } > {
  const p = path.join(dir, name)
  if (!(await fileExists(p))) return { path: p, action: 'write' }
  if (policy === 'overwrite') return { path: p, action: 'write' }
  if (policy === 'skip' || policy === 'prompt') return { path: p, action: 'skip' }
  const { base, ext } = splitName(name)
  for (let i = 1; i < 10000; i++) { const candidate = path.join(dir, `${base} (${i})${ext}`); if (!(await fileExists(candidate))) return { path: candidate, action: 'write' } }
  return { path: p, action: 'skip' }
}

async function promptOnConflict(win: BrowserWindow | null, destDir: string, baseName: string): Promise<{ path: string; action: 'write'|'skip' }> {
  const parent = win || BrowserWindow.getFocusedWindow() || null
  const p = path.join(destDir, baseName)
  if (!(await fileExists(p))) return { path: p, action: 'write' }
  const { base, ext } = splitName(baseName)
  const res = await dialog.showMessageBox(parent!, { type: 'question', buttons: ['Overwrite', 'Skip', 'Rename'], defaultId: 2, cancelId: 1, title: 'File already exists', message: `${baseName} already exists in the destination folder. What would you like to do?`, noLink: true })
  const idx = res.response
  if (idx === 0) return { path: p, action: 'write' }
  if (idx === 1) return { path: p, action: 'skip' }
  for (let i = 1; i < 10000; i++) { const candidateName = `${base} (${i})${ext}`; const candidate = path.join(destDir, candidateName); if (!(await fileExists(candidate))) return { path: candidate, action: 'write' } }
  return { path: p, action: 'skip' }
}

async function headObject(bucket: string, key: string) { const c = ensureClient(); return await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key })) }

async function* listAllKeys(bucket: string, prefix: string) {
  const c = ensureClient(); let token: string | undefined
  do { const out = await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })); for (const o of out.Contents ?? []) { const k = o.Key || ''; if (k.endsWith('/') && (o.Size ?? 0) === 0) continue; yield { key: k, size: o.Size ?? 0, etag: o.ETag } } token = out.IsTruncated ? out.NextContinuationToken : undefined } while (token)
}

// Download: single object
export async function startObject(win: BrowserWindow | null, params: StartObjectDownload) {
  const settings = applyDefaults(params.settings)
  const baseName = path.basename(params.key)
  const name = process.platform === 'win32' ? sanitizeWindows(baseName) : baseName
  const chosen = settings.overwritePolicy === 'prompt'
    ? await promptOnConflict(win, params.destDir, name)
    : await chooseDestPath(params.destDir, name, settings.overwritePolicy, win || undefined)
  const destPath = safeJoin(params.destDir, path.basename(chosen.path))
  const jobId = newId('job')
  const itemId = newId('item')
  const job: TransferJob = {
    id: jobId,
    type: 'object',
    bucket: params.bucket,
    destDir: params.destDir,
    status: 'queued',
    totalBytes: 0,
    completedBytes: 0,
    itemCount: 1,
    completedCount: 0,
    settings
  } as any
  jobs.set(jobId, job)
  emit(win, { type: 'job-state', job })
  const head = await headObject(params.bucket, params.key)
  const size = head.ContentLength ?? 0
  job.totalBytes = size
  emit(win, { type: 'job-state', job })
  const it: TransferItem = { id: itemId, jobId, bucket: params.bucket, key: params.key, size, etag: head.ETag ?? undefined, destPath, status: 'queued', bytesTransferred: 0 }
  items.set(it.id, it)
  emit(win, { type: 'item-state', jobId, item: it })
  try {
    await ensureDir(path.dirname(destPath))
    if (chosen.action === 'skip') {
      it.status = 'completed'; it.bytesTransferred = it.size; job.completedBytes += it.size
    } else {
      await downloadSingle(win, job, it, settings)
    }
    job.completedCount = 1
    job.status = 'completed'
    emit(win, { type: 'job-state', job }); emit(win, { type: 'job-complete', jobId })
  } catch (e: any) {
    job.status = job.status === 'canceled' ? 'canceled' : 'failed'
    it.status = job.status; it.error = e?.message || String(e)
    emit(win, { type: 'item-state', jobId, item: it }); emit(win, { type: 'job-error', jobId, error: it.error || 'Download failed' })
  }
  return jobId
}

// Download: prefix (enumerates and downloads existing implementation kept)
export async function startPrefix(win: BrowserWindow | null, params: StartPrefixDownload) {
  const settings = applyDefaults(params.settings)
  const jobId = newId('job')
  const job: TransferJob = { id: jobId, type: 'prefix', bucket: params.bucket, prefix: params.prefix, destDir: params.destDir, status: 'queued', totalBytes: 0, completedBytes: 0, itemCount: 0, completedCount: 0, settings } as any
  jobs.set(jobId, job)
  emit(win, { type: 'job-state', job })
  const keys: Array<{ key: string; size: number; etag?: string }> = []
  for await (const k of listAllKeys(params.bucket, params.prefix)) keys.push(k)
  job.itemCount = keys.length
  job.totalBytes = keys.reduce((a, b) => a + (b.size || 0), 0)
  emit(win, { type: 'job-state', job })
  const rawRootName = params.prefix.replace(/\/+$/, '').split('/').filter(Boolean).pop() || ''
  const rootName = process.platform === 'win32' ? sanitizeWindows(rawRootName) : rawRootName
  const baseDestDir = rootName ? path.join(params.destDir, rootName) : params.destDir
  try { await ensureDir(baseDestDir) } catch {}
  let active = 0
  let idx = 0
  const next = async (): Promise<void> => {
    if ((job as any).status === 'canceled') return
    if (idx >= keys.length) return
    while (active >= settings.objectConcurrency) await new Promise(r => setTimeout(r, 25))
    const k = keys[idx++]; active++
    const baseRel = k.key.slice(params.prefix.length).replace(/^\//, '')
    const safeRel = process.platform === 'win32' ? sanitizeRelativePathPreserveDirs(baseRel) : baseRel
    const chosen = settings.overwritePolicy === 'prompt' ? await promptOnConflict(win, baseDestDir, safeRel) : await chooseDestPath(baseDestDir, safeRel, settings.overwritePolicy, win || undefined)
    const destPath = chosen.path
    await ensureDir(path.dirname(destPath))
    const it: TransferItem = { id: newId('item'), jobId, bucket: params.bucket, key: k.key, size: k.size, etag: k.etag, destPath, status: 'queued', bytesTransferred: 0 }
    items.set(it.id, it)
    emit(win, { type: 'item-state', jobId, item: it })
    const run = async () => {
      if (chosen.action === 'skip') { it.status = 'completed'; it.bytesTransferred = it.size; job.completedBytes += it.size }
      else if ((job as any).status !== 'canceled') await downloadSingle(win, job, it, settings)
    }
    run().then(() => {
      active--; job.completedCount++
      if (job.completedCount >= job.itemCount && job.status !== 'failed' && job.status !== 'canceled') {
        job.status = 'completed'; emit(win, { type: 'job-state', job }); emit(win, { type: 'job-complete', jobId })
      }
      void next()
    }).catch((e) => {
      active--; it.status = 'failed'; it.error = (e as any)?.message || String(e); job.status = 'failed'
      emit(win, { type: 'item-state', jobId, item: it }); emit(win, { type: 'job-error', jobId, error: it.error! }); void next()
    })
  }
  const kicks = Math.min(settings.objectConcurrency, keys.length)
  for (let i = 0; i < kicks; i++) void next()
  return jobId
}

// Streaming/batched upload enumeration implementation
export async function startUpload(win: BrowserWindow | null, params: StartUploadParams) {
  const settings = applyDefaults(params.settings)
  const prefix = params.prefix ? params.prefix.replace(/\/+/, '/').replace(/^\//, '').replace(/\/?$/, '/') : ''

  // Fast-path: multiple explicit files (no dirs), no prefix -> create individual jobs (legacy behavior)
  let topHasDir = false
  if (!prefix && params.files.length > 1) {
    const topStats: Array<{ f: { path: string; size: number; name?: string }; st: fs.Stats | null }> = []
    for (const f of params.files) {
      try { const st = await fs.promises.stat(f.path); topStats.push({ f, st }); if (st.isDirectory()) topHasDir = true } catch { topStats.push({ f, st: null }) }
    }
    if (!topHasDir && topStats.every(t => t.st?.isFile())) {
      const jobIds: string[] = []
      for (const t of topStats) {
        const file = t.f
        const jobId = newId('job')
        getLogger().debug('xfer', 'startUpload individual', { jobId, bucket: params.bucket, file: file.name })
        const job: TransferJob = {
          id: jobId,
          type: 'object',
          bucket: params.bucket,
          prefix: '',
          destDir: '',
          status: 'queued',
          totalBytes: file.size || 0,
          completedBytes: 0,
          itemCount: 1,
          completedCount: 0,
          settings
        } as any
        jobs.set(jobId, job)
        emit(win, { type: 'job-state', job })
        const key = file.name || path.basename(file.path)
        const it: TransferItem = { id: newId('item'), jobId, bucket: params.bucket, key, size: file.size || 0, destPath: file.path, status: 'queued', bytesTransferred: 0 }
        items.set(it.id, it)
        emit(win, { type: 'item-state', jobId, item: it })
        uploadOne(win, job, it, file.path, it.size, settings).then(() => {
          job.completedCount = 1
          job.status = 'completed'
          emit(win, { type: 'job-state', job })
          emit(win, { type: 'job-complete', jobId })
        }).catch(e => {
          it.status = 'failed'; it.error = (e as any)?.message || String(e); job.status = 'failed';
          emit(win, { type: 'item-state', jobId, item: it })
          emit(win, { type: 'job-error', jobId, error: it.error! })
        })
        jobIds.push(jobId)
      }
      return jobIds[0]
    }
  }

  // Streaming (enumerating) single job path
  const jobId = newId('job')
  const job: TransferJob = {
    id: jobId,
    type: 'prefix', // treat as collection upload
    bucket: params.bucket,
    prefix,
    destDir: '',
    status: 'enumerating',
    totalBytes: 0,
    completedBytes: 0,
    itemCount: 0,
    completedCount: 0,
    settings
  } as any
  jobs.set(jobId, job)
  emit(win, { type: 'job-state', job })

  const queue: string[] = [] // item ids waiting to start
  let active = 0
  let enumerationDone = false
  let lastBatchEmit = Date.now()
  const BATCH_SIZE = 75
  const BATCH_INTERVAL_MS = 200
  let batch: TransferItem[] = []

  const maybeDispatch = () => {
  getLogger().trace('xfer', 'maybeDispatch enter', { active, queued: queue.length })
    while (active < settings.objectConcurrency && queue.length) {
      const itemId = queue.shift()!
      const it = items.get(itemId)
      if (!it) continue
      if ((job as any).status === 'canceled') { it.status = 'canceled'; continue }
      active++
      // First actual upload switches job to in-progress
      if (job.status === 'enumerating') {
        job.status = 'in-progress'
        emitThrottled(win, { type: 'job-state', job })
      }
  uploadOne(win, job, it, it.destPath, it.size, settings).then(() => {
        active--
        job.completedCount++
        maybeFinish()
        maybeDispatch()
      }).catch(e => {
        active--
        it.status = 'failed'; it.error = (e as any)?.message || String(e)
        job.status = job.status === 'canceled' ? 'canceled' : 'failed'
        emit(win, { type: 'item-state', jobId, item: it })
        emit(win, { type: 'job-error', jobId, error: it.error || 'upload failed' })
        maybeFinish()
        maybeDispatch()
      })
    }
  }

  const maybeFlushBatch = (force = false) => {
    const now = Date.now()
    if (!force && batch.length < BATCH_SIZE && (now - lastBatchEmit) < BATCH_INTERVAL_MS) return
    if (!batch.length) return
    getLogger().debug('xfer', 'emit items-added batch', { count: batch.length, queued: queue.length })
    emit(win, { type: 'items-added', jobId, items: batch.map(b => ({ ...b })) })
    // Update job state (counts / total) after batch emission
    emitThrottled(win, { type: 'job-state', job })
    batch = []
    lastBatchEmit = now
    maybeDispatch()
  }

  const maybeFinish = () => {
    if (!enumerationDone) return
    if (job.status === 'failed' || job.status === 'canceled') return
    if (job.completedCount >= job.itemCount) {
      job.status = 'completed'
      emit(win, { type: 'job-state', job })
      emit(win, { type: 'job-complete', jobId })
    }
  }

  const addFile = (absPath: string, relName: string, size: number) => {
    if ((job as any).status === 'canceled') return
    const key = prefix + relName
    const it: TransferItem = { id: newId('item'), jobId, bucket: params.bucket, key, size, destPath: absPath, status: 'queued', bytesTransferred: 0 }
    items.set(it.id, it)
    job.itemCount++
    job.totalBytes += size
    batch.push(it)
    queue.push(it.id)
    maybeFlushBatch()
  }

  const walkDir = async (rootAbs: string, baseName: string) => {
    const stack: Array<{ abs: string; rel: string }> = [{ abs: rootAbs, rel: '' }]
    let ops = 0
    while (stack.length) {
      if ((job as any).status === 'canceled') return
      const { abs, rel } = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(abs, { withFileTypes: true }) } catch { continue }
      for (const de of entries) {
        const childAbs = path.join(abs, de.name)
        const childRel = rel ? path.posix.join(rel.replace(/\\/g, '/'), de.name) : de.name
        if (de.isDirectory()) {
          stack.push({ abs: childAbs, rel: childRel })
        } else if (de.isFile()) {
          let st: fs.Stats | undefined
          try { st = await fs.promises.stat(childAbs) } catch {}
          addFile(childAbs, path.posix.join(baseName, childRel), st?.size || 0)
        }
        ops++
  if (ops >= 150) { // yield periodically
          ops = 0
          await new Promise(r => setTimeout(r, 0))
          maybeFlushBatch()
        }
      }
    }
  }

  // Kick off enumeration async (don't await full expansion before returning jobId)
  ;(async () => {
    try {
      for (const f of params.files) {
        const abs = f.path
        if (!abs) continue
        let st: fs.Stats | undefined
        try { st = await fs.promises.stat(abs) } catch {}
        const displayNameRaw = f.name || (abs ? path.basename(abs) : 'file')
        const displayName = process.platform === 'win32' ? sanitizeWindows(displayNameRaw) : displayNameRaw
        if (st?.isDirectory()) {
          await walkDir(abs, displayName)
        } else if (st?.isFile()) {
          addFile(abs, displayName, st.size)
        }
        maybeFlushBatch()
      }
    } finally {
      enumerationDone = true
      maybeFlushBatch(true)
      maybeFinish()
    }
  })().catch(e => {
    job.status = 'failed'
    job.error = (e as any)?.message || String(e)
    emit(win, { type: 'job-state', job })
    emit(win, { type: 'job-error', jobId, error: job.error! })
  })

  // Dispatcher timer to ensure periodic flush & dispatch even if batch threshold not met
  const tick = () => {
    if (job.status === 'failed' || job.status === 'canceled' || (enumerationDone && job.status === 'completed')) return
    maybeFlushBatch()
    maybeDispatch()
    setTimeout(tick, 150)
  }
  setTimeout(tick, 150)

  return jobId
}

async function downloadSingle(win: BrowserWindow | null, job: TransferJob, it: TransferItem, settings: ReturnType<typeof applyDefaults>) {
  if (job.status === 'queued' || job.status === 'enumerating') job.status = 'in-progress'
  it.status = 'in-progress'
  it.startedAt = Date.now()
  emit(win, { type: 'job-state', job })
  emit(win, { type: 'item-state', jobId: job.id, item: it })

  const total = it.size
  const threshold = settings.multipartThresholdMiB * 1024 * 1024
  if (total >= threshold) await downloadMultipart(win, job, it, settings)
  else await downloadSimple(win, job, it, settings)

  if ((it as any).status !== 'canceled') {
    it.status = 'completed'
    it.completedAt = Date.now()
    job.completedBytes += it.size
    emit(win, { type: 'item-state', jobId: job.id, item: it })
  }
}

async function downloadSimple(win: BrowserWindow | null, job: TransferJob, it: TransferItem, settings: ReturnType<typeof applyDefaults>) {
  const c = ensureClient()
  const { part, manifest } = atomicPaths(it.destPath)
  const req: any = { Bucket: it.bucket, Key: it.key }
  if (settings.requesterPays) req.RequestPayer = 'requester'
  const res = await c.send(new GetObjectCommand(req))
  const body = res.Body as any
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(part)
    let transferred = 0
    body.on('data', (chunk: Buffer) => {
      transferred += chunk.length
      it.bytesTransferred = transferred
      const { speedBps, etaSeconds } = speedEta(it.bytesTransferred, it.startedAt, it.size)
      it.speedBps = speedBps; it.etaSeconds = etaSeconds
      recalcJobProgress(job)
      emitThrottled(win, { type: 'item-state', jobId: job.id, item: it })
      emitThrottled(win, { type: 'job-state', job })
    })
    body.on('error', reject)
    ws.on('error', reject)
    ws.on('finish', resolve)
    body.pipe(ws)
  })
  const fd = await fs.promises.open(part, 'r+')
  try { await fsync(fd.fd) } finally { await fd.close() }
  await fs.promises.rename(part, it.destPath)
  try { await fs.promises.unlink(manifest) } catch {}
}

async function downloadMultipart(win: BrowserWindow | null, job: TransferJob, it: TransferItem, settings: ReturnType<typeof applyDefaults>) {
  const c = ensureClient()
  const partSize = settings.partSizeMiB * 1024 * 1024
  const { part, manifest } = atomicPaths(it.destPath)
  let man: Manifest | undefined = await readManifest(manifest)
  if (!man || man.size !== it.size || man.etag !== it.etag || man.partSize !== partSize) {
    const parts: Manifest['parts'] = []
    for (let start = 0; start < it.size; start += partSize) {
      const end = Math.min(it.size - 1, start + partSize - 1)
      parts.push({ start, end, done: false })
    }
    man = { bucket: it.bucket, key: it.key, size: it.size, etag: it.etag, partSize, parts }
    await writeManifest(manifest, man)
    const fh = await fs.promises.open(part, 'w')
    try { await fh.truncate(it.size) } finally { await fh.close() }
  }

  const fh = await fs.promises.open(part, 'r+')
  try {
    let active = 0
    let idx = 0
    const pending = man.parts
    const next = async (): Promise<void> => {
      if ((job as any).status === 'canceled' || (it as any).status === 'canceled') return
      if (idx >= pending.length) return
      while (active >= settings.partConcurrency) await new Promise(r => setTimeout(r, 10))
      const pIndex = idx++
      const p = pending[pIndex]
      if (p.done) { void next(); return }
      active++
      const range = `bytes=${p.start}-${p.end}`
      const req: any = { Bucket: it.bucket, Key: it.key, Range: range }
      if (settings.requesterPays) req.RequestPayer = 'requester'
      try {
        const res = await c.send(new GetObjectCommand(req))
        const stream = res.Body as any
        await new Promise<void>((resolve, reject) => {
          stream.on('error', reject)
          const writer = fs.createWriteStream(part, { start: p.start, flags: 'r+' })
          writer.on('error', reject)
          writer.on('finish', resolve)
          let transferred = 0
          stream.on('data', (chunk: Buffer) => {
            transferred += chunk.length
            it.bytesTransferred += chunk.length
            const { speedBps, etaSeconds } = speedEta(it.bytesTransferred, it.startedAt, it.size)
            it.speedBps = speedBps; it.etaSeconds = etaSeconds
            if (it.bytesTransferred - job.completedBytes >= partSize || transferred >= partSize) {
              // coarse updates; throttled via UI anyway
            }
            recalcJobProgress(job)
            emitThrottled(win, { type: 'item-state', jobId: job.id, item: it })
            emitThrottled(win, { type: 'job-state', job })
          })
          stream.pipe(writer)
        })
        p.done = true
        await writeManifest(manifest, man)
      } catch (e) {
        // retry with backoff in outer loop by re-queueing
        idx = Math.min(idx, pIndex)
      } finally {
        active--
        void next()
      }
    }
    const kicks = Math.min(settings.partConcurrency, man.parts.length)
    for (let i = 0; i < kicks; i++) await next()
    while (man.parts.some(p => !p.done)) await new Promise(r => setTimeout(r, 25))
  } finally {
    await fsync(fh.fd)
    await fh.close()
  }
  await fs.promises.rename(part, it.destPath)
  try { await fs.promises.unlink(manifest) } catch {}
}

export function control(win: BrowserWindow | null, jobId: string, action: 'pause'|'resume'|'cancel'|'retry'|'cancelAll') {
  if (action === 'cancelAll') {
    let affectedJobs = 0
    let affectedItems = 0
    for (const job of jobs.values()) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') continue
      job.status = 'canceled'
      affectedJobs++
      for (const it of items.values()) {
        if (it.jobId !== job.id) continue
        if (['completed','failed','canceled'].includes(it.status)) continue
        it.status = 'canceled'
        affectedItems++
        const s = activeStreams.get(it.id)
        try { (s as any)?.destroy?.(new Error('canceled')) } catch {}
  // Emit per-item updates so the renderer can clear them
  emit(win, { type: 'item-state', jobId: job.id, item: it })
      }
      emit(win, { type: 'job-state', job })
    }
    getLogger().debug('xfer', 'cancelAll applied', { jobs: affectedJobs, items: affectedItems })
    return
  }
  // For MVP, implement cancel with UI updates. Pausing would need stream abort controllers.
  const job = jobs.get(jobId)
  if (!job) throw new Error('Unknown job')
  if (action === 'cancel') {
    job.status = 'canceled'
    // Mark all active/queued items as canceled and emit updates
    for (const it of items.values()) {
      if (it.jobId !== job.id) continue
      if (it.status === 'completed' || it.status === 'failed' || it.status === 'canceled') continue
      it.status = 'canceled'
      emit(win, { type: 'item-state', jobId: job.id, item: it })
    }
    emit(win, { type: 'job-state', job })
  }
}

async function uploadOne(win: BrowserWindow | null, job: TransferJob, it: TransferItem, filePath: string, size: number, settings: ReturnType<typeof applyDefaults>) {
  // Ensure file exists before starting
  try { await fs.promises.stat(filePath) } catch {
    const msg = `Local file not found: ${filePath}`
    getLogger().warn('xfer', 'upload stat missing', { filePath })
    throw new Error(msg)
  }
  
  if (job.status === 'queued') job.status = 'in-progress'
  it.status = 'in-progress'
  it.startedAt = Date.now()
  it.bytesTransferred = 0  // Ensure clean start
  emit(win, { type: 'job-state', job })
  emit(win, { type: 'item-state', jobId: job.id, item: it })

  const threshold = settings.multipartThresholdMiB * 1024 * 1024
  if (size >= threshold) await uploadMultipart(win, job, it, filePath, settings)
  else await uploadSimple(win, job, it, filePath)

  if ((it as any).status !== 'canceled') {
    it.status = 'completed'
    it.completedAt = Date.now()
    it.bytesTransferred = it.size  // Ensure 100% completion
    recalcJobProgress(job)
    emit(win, { type: 'item-state', jobId: job.id, item: it })
    emit(win, { type: 'job-state', job })
  }
}

async function uploadSimple(win: BrowserWindow | null, job: TransferJob, it: TransferItem, filePath: string) {
  const c = ensureClient()
  const rs = fs.createReadStream(filePath)
  
  // Attach error handler to avoid unhandledRejection from stream
  await new Promise<void>((resolve, reject) => {
    rs.once('error', reject)
    c.send(new PutObjectCommand({ Bucket: it.bucket, Key: it.key, Body: rs })).then(() => {
      // Set final progress after upload completes
      it.bytesTransferred = it.size
      recalcJobProgress(job)
      emit(win, { type: 'item-state', jobId: job.id, item: it })
      emit(win, { type: 'job-state', job })
      resolve()
    }, reject)
  })
}

async function uploadMultipart(win: BrowserWindow | null, job: TransferJob, it: TransferItem, filePath: string, settings: ReturnType<typeof applyDefaults>) {
  const c = ensureClient()
  const partSize = settings.partSizeMiB * 1024 * 1024
  const manPath = filePath + '.upload.json'
  let man: UploadManifest | undefined
  try { const raw = await fs.promises.readFile(manPath, 'utf8'); man = JSON.parse(raw) } catch {}
  if (!man || man.size !== it.size || man.partSize !== partSize || man.bucket !== it.bucket || man.key !== it.key) {
    const create = await c.send(new CreateMultipartUploadCommand({ Bucket: it.bucket, Key: it.key }))
    const uploadId = create.UploadId!
    const parts: UploadManifest['parts'] = []
    let partNumber = 1
    for (let start = 0; start < it.size; start += partSize) {
      const end = Math.min(it.size - 1, start + partSize - 1)
      parts.push({ partNumber: partNumber++, start, end })
    }
    man = { bucket: it.bucket, key: it.key, size: it.size, partSize, uploadId, parts }
    await writeUploadManifest(manPath, man)
  }

  let active = 0
  let idx = 0
  const etags: { PartNumber: number; ETag: string }[] = []
  const next = async (): Promise<void> => {
    if (idx >= man!.parts.length) return
    while (active >= settings.partConcurrency) await new Promise(r => setTimeout(r, 10))
    const p = man!.parts[idx++]
    if ((p as any).etag) { void next(); return }
    active++
    const start = p.start
    const end = p.end
    const len = end - start + 1
    const stream = fs.createReadStream(filePath, { start, end })
    try {
      const out = await c.send(new UploadPartCommand({ Bucket: it.bucket, Key: it.key, UploadId: man!.uploadId, PartNumber: p.partNumber, Body: stream, ContentLength: len }))
      const etag = out.ETag!
      ;(p as any).etag = etag
      await writeUploadManifest(manPath, man!)
      etags.push({ PartNumber: p.partNumber, ETag: etag })
      it.bytesTransferred += len
      const { speedBps, etaSeconds } = speedEta(it.bytesTransferred, it.startedAt, it.size)
      it.speedBps = speedBps; it.etaSeconds = etaSeconds
      recalcJobProgress(job)
      emit(win, { type: 'item-state', jobId: job.id, item: it })
      emit(win, { type: 'job-state', job })
    } catch (e) {
      // leave part without etag for retry
      idx = Math.min(idx, man!.parts.findIndex(pp => pp.partNumber === p.partNumber))
    } finally {
      active--
      void next()
    }
  }
  const kicks = Math.min(settings.partConcurrency, man.parts.length)
  for (let i = 0; i < kicks; i++) await next()
  while (man.parts.some(p => !(p as any).etag)) await new Promise(r => setTimeout(r, 25))
  await c.send(new CompleteMultipartUploadCommand({ Bucket: it.bucket, Key: it.key, UploadId: man.uploadId, MultipartUpload: { Parts: man.parts.map(p => ({ PartNumber: p.partNumber, ETag: (p as any).etag })) } }))
  try { await fs.promises.unlink(manPath) } catch {}
}


