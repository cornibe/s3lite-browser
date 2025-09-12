import { BrowserWindow } from 'electron'
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
export function bindS3Client(c: S3Client) { s3ClientRef = c }

const DEFAULTS = {
  objectConcurrency: 4,
  partConcurrency: 8,
  partSizeMiB: 16,
  multipartThresholdMiB: 16,
  overwritePolicy: 'skip' as const
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

function recalcJobProgress(job: TransferJob) {
  let sum = 0
  for (const it of items.values()) if (it.jobId === job.id) sum += Math.min(it.bytesTransferred, it.size)
  job.completedBytes = Math.min(sum, job.totalBytes)
}

function sanitizeWindows(name: string) {
  const reserved = /[<>:\"/\\|?*]/g
  return name.replace(reserved, '_')
}

function safeJoin(base: string, rel: string) {
  const norm = rel.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').join(path.sep)
  return path.join(base, norm)
}

async function ensureDir(p: string) { await fs.promises.mkdir(p, { recursive: true }) }

function atomicPaths(finalPath: string) {
  return { part: finalPath + '.part', manifest: finalPath + '.part.json' }
}

async function readManifest(p: string): Promise<Manifest | undefined> {
  try { const raw = await fs.promises.readFile(p, 'utf8'); return JSON.parse(raw) } catch { return undefined }
}
async function writeManifest(p: string, m: Manifest) { await fs.promises.writeFile(p, JSON.stringify(m)) }
async function writeUploadManifest(p: string, m: UploadManifest) { await fs.promises.writeFile(p, JSON.stringify(m)) }

async function fsync(fd: number) {
  // Node's fs.promises doesn't expose fsync; use callback API wrapped as Promise
  await new Promise<void>((resolve) => {
    try { fs.fsync(fd, () => resolve()) } catch { resolve() }
  })
}

function speedEta(bytesTransferred: number, startedAt?: number, total?: number) {
  if (!startedAt) return { speedBps: 0, etaSeconds: undefined as number | undefined }
  const dt = Math.max(1, Date.now() - startedAt) / 1000
  const speed = bytesTransferred / dt
  let eta: number | undefined
  if (total && speed > 0) eta = Math.max(0, Math.round((total - bytesTransferred) / speed))
  return { speedBps: Math.round(speed), etaSeconds: eta }
}

async function fileExists(p: string) { try { await fs.promises.access(p, fs.constants.F_OK); return true } catch { return false } }

function splitName(name: string) {
  const ext = path.extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  return { base, ext }
}

async function chooseDestPath(dir: string, name: string, policy: 'skip'|'overwrite'|'rename'|'prompt'): Promise<{ path: string; action: 'write'|'skip' } > {
  const p = path.join(dir, name)
  if (!(await fileExists(p))) return { path: p, action: 'write' }
  if (policy === 'overwrite') return { path: p, action: 'write' }
  if (policy === 'skip' || policy === 'prompt') return { path: p, action: 'skip' }
  const { base, ext } = splitName(name)
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!(await fileExists(candidate))) return { path: candidate, action: 'write' }
  }
  return { path: p, action: 'skip' }
}

async function headObject(bucket: string, key: string) {
  const c = ensureClient()
  return await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
}

async function* listAllKeys(bucket: string, prefix: string) {
  const c = ensureClient()
  let token: string | undefined
  do {
    const out = await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    for (const o of out.Contents ?? []) {
      const k = o.Key || ''
      if (k.endsWith('/') && (o.Size ?? 0) === 0) continue
      yield { key: k, size: o.Size ?? 0, etag: o.ETag }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined
  } while (token)
}

export function getJob(jobId: string) { return jobs.get(jobId) }

export async function startObject(win: BrowserWindow | null, params: StartObjectDownload) {
  const settings = applyDefaults(params.settings)
  const baseName = path.basename(params.key)
  const name = process.platform === 'win32' ? sanitizeWindows(baseName) : baseName
  const chosen = await chooseDestPath(params.destDir, name, settings.overwritePolicy)
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

  const it: TransferItem = {
    id: itemId,
    jobId,
    bucket: params.bucket,
    key: params.key,
    size,
    etag: head.ETag ?? undefined,
    destPath,
    status: 'queued',
    bytesTransferred: 0
  }
  items.set(itemId, it)
  emit(win, { type: 'item-state', jobId, item: it })

  try {
    await ensureDir(path.dirname(destPath))
    if (chosen.action === 'skip') {
      it.status = 'completed'
      it.bytesTransferred = it.size
      job.completedBytes += it.size
    } else {
      await downloadSingle(win, job, it, settings)
    }
    job.completedCount = 1
    job.status = 'completed'
    emit(win, { type: 'job-state', job })
    emit(win, { type: 'job-complete', jobId })
  } catch (e: any) {
    job.status = job.status === 'canceled' ? 'canceled' : 'failed'
    it.status = job.status
    it.error = e?.message || String(e)
    emit(win, { type: 'item-state', jobId, item: it })
  emit(win, { type: 'job-error', jobId, error: it.error || 'Download failed' })
  }
  return jobId
}

export async function startPrefix(win: BrowserWindow | null, params: StartPrefixDownload) {
  const settings = applyDefaults(params.settings)
  const jobId = newId('job')
  const job: TransferJob = {
    id: jobId,
    type: 'prefix',
    bucket: params.bucket,
    prefix: params.prefix,
    destDir: params.destDir,
    status: 'queued',
    totalBytes: 0,
    completedBytes: 0,
    itemCount: 0,
    completedCount: 0,
    settings
  } as any
  jobs.set(jobId, job)
  emit(win, { type: 'job-state', job })

  const keys: Array<{ key: string; size: number; etag?: string }> = []
  for await (const k of listAllKeys(params.bucket, params.prefix)) keys.push(k)
  job.itemCount = keys.length
  job.totalBytes = keys.reduce((a, b) => a + (b.size || 0), 0)
  emit(win, { type: 'job-state', job })

  let active = 0
  let idx = 0
  const next = async (): Promise<void> => {
    if (idx >= keys.length) return
    while (active >= settings.objectConcurrency) await new Promise(r => setTimeout(r, 25))
    const k = keys[idx++]
    active++
    const baseName = k.key.slice(params.prefix.length).replace(/^\//, '')
    const safeName = process.platform === 'win32' ? sanitizeWindows(baseName) : baseName
    const chosen = await chooseDestPath(params.destDir, safeName, settings.overwritePolicy)
    const destPath = safeJoin(params.destDir, path.basename(chosen.path))
    await ensureDir(path.dirname(destPath))
    const it: TransferItem = { id: newId('item'), jobId, bucket: params.bucket, key: k.key, size: k.size, etag: k.etag, destPath, status: 'queued', bytesTransferred: 0 }
    items.set(it.id, it)
    emit(win, { type: 'item-state', jobId, item: it })
    const run = async () => {
      if (chosen.action === 'skip') {
        it.status = 'completed'
        it.bytesTransferred = it.size
        job.completedBytes += it.size
      } else {
        await downloadSingle(win, job, it, settings)
      }
    }
    run().then(() => {
      active--
      job.completedCount++
      if (job.completedCount >= job.itemCount && job.status !== 'failed' && job.status !== 'canceled') {
        job.status = 'completed'
        emit(win, { type: 'job-state', job })
        emit(win, { type: 'job-complete', jobId })
      }
      void next()
    }).catch((e) => {
      active--
      it.status = 'failed'
      it.error = (e as any)?.message || String(e)
      job.status = 'failed'
      emit(win, { type: 'item-state', jobId, item: it })
      emit(win, { type: 'job-error', jobId, error: it.error! })
      void next()
    })
  }
  // pump initial concurrency
  const kicks = Math.min(settings.objectConcurrency, keys.length)
  for (let i = 0; i < kicks; i++) void next()
  return jobId
}

async function downloadSingle(win: BrowserWindow | null, job: TransferJob, it: TransferItem, settings: ReturnType<typeof applyDefaults>) {
  if (job.status === 'queued') job.status = 'in-progress'
  it.status = 'in-progress'
  it.startedAt = Date.now()
  emit(win, { type: 'job-state', job })
  emit(win, { type: 'item-state', jobId: job.id, item: it })

  const total = it.size
  const threshold = settings.multipartThresholdMiB * 1024 * 1024
  if (total >= threshold) await downloadMultipart(win, job, it, settings)
  else await downloadSimple(win, job, it, settings)

  it.status = 'completed'
  it.completedAt = Date.now()
  job.completedBytes += it.size
  emit(win, { type: 'item-state', jobId: job.id, item: it })
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
      emit(win, { type: 'item-state', jobId: job.id, item: it })
      emit(win, { type: 'job-state', job })
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
            emit(win, { type: 'item-state', jobId: job.id, item: it })
            emit(win, { type: 'job-state', job })
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

export function control(jobId: string, action: 'pause'|'resume'|'cancel'|'retry') {
  // For MVP, only cancel is implemented (sets status; in-progress streams complete quickly). Pausing would need stream abort controllers.
  const job = jobs.get(jobId)
  if (!job) throw new Error('Unknown job')
  if (action === 'cancel') job.status = 'canceled'
}

export async function startUpload(win: BrowserWindow | null, params: StartUploadParams) {
  const settings = applyDefaults(params.settings)
  const jobId = newId('job')
  const prefix = params.prefix ? params.prefix.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/?$/, '/') : ''
  getLogger().debug('xfer', 'startUpload', { jobId, bucket: params.bucket, prefix, files: params.files.length })
  const job: TransferJob = {
    id: jobId,
    type: 'prefix',
    bucket: params.bucket,
    prefix,
    destDir: '',
    status: 'queued',
    totalBytes: params.files.reduce((a, f) => a + (f.size || 0), 0),
    completedBytes: 0,
    itemCount: params.files.length,
    completedCount: 0,
    settings
  } as any
  jobs.set(jobId, job)
  emit(win, { type: 'job-state', job })

  let active = 0
  let idx = 0
  const next = async (): Promise<void> => {
    if (idx >= params.files.length) return
    while (active >= settings.objectConcurrency) await new Promise(r => setTimeout(r, 20))
    const f = params.files[idx++]
    active++
    getLogger().trace('xfer', 'upload next', { jobId, path: f.path, size: f.size })
    const key = prefix + (f.name || path.basename(f.path))
  const it: TransferItem = { id: newId('item'), jobId, bucket: params.bucket, key, size: f.size, destPath: f.path, status: 'queued', bytesTransferred: 0 }
    items.set(it.id, it)
    emit(win, { type: 'item-state', jobId, item: it })
  uploadOne(win, job, it, f.path, f.size, settings).then(() => {
      active--
      job.completedCount++
      if (job.completedCount >= job.itemCount && job.status !== 'failed' && job.status !== 'canceled') {
        job.status = 'completed'
        emit(win, { type: 'job-state', job })
        emit(win, { type: 'job-complete', jobId })
      }
      void next()
    }).catch((e) => {
      active--
      it.status = 'failed'
      it.error = (e as any)?.message || String(e)
      getLogger().warn('xfer', 'upload error', { jobId, key: it.key, error: it.error })
      job.status = 'failed'
      emit(win, { type: 'item-state', jobId, item: it })
      emit(win, { type: 'job-error', jobId, error: it.error! })
      void next()
    })
  }
  const kicks = Math.min(settings.objectConcurrency, params.files.length)
  for (let i = 0; i < kicks; i++) void next()
  return jobId
}

async function uploadOne(win: BrowserWindow | null, job: TransferJob, it: TransferItem, filePath: string, size: number, settings: ReturnType<typeof applyDefaults>) {
  // Ensure file exists before starting
  try { await fs.promises.stat(filePath) } catch {
    const msg = `Local file not found: ${filePath}`
    getLogger().warn('xfer', 'upload stat missing', { filePath })
    throw new Error(msg)
  }
  it.status = 'in-progress'
  it.startedAt = Date.now()
  emit(win, { type: 'item-state', jobId: job.id, item: it })

  const threshold = settings.multipartThresholdMiB * 1024 * 1024
  if (size >= threshold) await uploadMultipart(win, job, it, filePath, settings)
  else await uploadSimple(win, job, it, filePath)

  it.status = 'completed'
  it.completedAt = Date.now()
  job.completedBytes += it.size
  emit(win, { type: 'item-state', jobId: job.id, item: it })
}

async function uploadSimple(win: BrowserWindow | null, job: TransferJob, it: TransferItem, filePath: string) {
  const c = ensureClient()
  const rs = fs.createReadStream(filePath)
  // Attach error handler to avoid unhandledRejection from stream
  await new Promise<void>((resolve, reject) => {
    rs.once('error', reject)
    c.send(new PutObjectCommand({ Bucket: it.bucket, Key: it.key, Body: rs })).then(() => resolve(), reject)
  })
  // Minimal progress: read stream can be tapped for bytes
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
