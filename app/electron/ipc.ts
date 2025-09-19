import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as s3 from './s3'
import * as transfers from './transfers'
import { IpcChannels } from './types'
import { getLogger, safeMeta, redact } from './log'

export function registerIpc() {
  ipcMain.handle(IpcChannels.S3_INIT, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.init(params)
      getLogger().info('ipc', 's3:init ok', { durationMs: Date.now() - t, profile: params?.profile || null })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to initialize S3 client'
      getLogger().warn('ipc', 's3:init error', { durationMs: Date.now() - t, error: msg })
      return { ok: false as const, error: msg }
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_BUCKETS, async () => {
    const t = Date.now()
    try {
      const out = await s3.listBuckets()
      getLogger().debug('ipc', 's3:listBuckets ok', { durationMs: Date.now() - t, count: out.length })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'ListBuckets', status: 'ok', durationMs: Date.now() - t })) } catch {}
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list buckets'
      getLogger().warn('ipc', 's3:listBuckets error', { durationMs: Date.now() - t, error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'ListBuckets', status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_OBJECTS, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.listObjects(params)
      getLogger().debug('ipc', 's3:listObjects ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', folders: out.folders.length, objects: out.objects.length, truncated: Boolean(out.nextToken) })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'ListObjects', bucket: params.bucket, prefix: params.prefix ?? '', status: 'ok', durationMs: Date.now() - t })) } catch {}
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list objects'
      getLogger().warn('ipc', 's3:listObjects error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'ListObjects', bucket: params.bucket, prefix: params.prefix ?? '', status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_FOLDER_STATS_PAGE, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.folderStatsPage(params)
      getLogger().debug('ipc', 's3:folderStatsPage ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, objects: out.objects, files: out.files, folders: out.folders, bytes: out.bytes, truncated: Boolean(out.nextToken) })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to scan folder'
      getLogger().warn('ipc', 's3:folderStatsPage error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_PROFILES, async () => {
    const t = Date.now()
    try {
      const out = await s3.listProfiles()
      getLogger().debug('ipc', 's3:listProfiles ok', { durationMs: Date.now() - t, count: out.length })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list profiles'
      getLogger().warn('ipc', 's3:listProfiles error', { durationMs: Date.now() - t, error: msg })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_SET_AWS_FILES, async (_e, params) => {
    s3.setAwsFiles(params)
    getLogger().info('fs', 'setAwsFiles', { credentialsFile: params.credentialsFile || null, configFile: params.configFile || null })
    return { ok: true as const }
  })
  ipcMain.handle(IpcChannels.S3_GET_AWS_FILES, async () => {
    const t = Date.now()
    try {
      const out = await s3.getAwsFiles()
      getLogger().debug('ipc', 's3:getAwsFiles ok', { durationMs: Date.now() - t })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to read AWS files'
      getLogger().warn('ipc', 's3:getAwsFiles error', { durationMs: Date.now() - t, error: msg })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_WRITE_AWS_FILES, async (_e, params: { credentialsText: string; configText: string }) => {
    const t = Date.now()
    try {
      await s3.writeAwsFiles(params)
      getLogger().info('ipc', 's3:writeAwsFiles ok', { durationMs: Date.now() - t, credsBytes: (params.credentialsText||'').length, cfgBytes: (params.configText||'').length })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to write AWS files'
      getLogger().warn('ipc', 's3:writeAwsFiles error', { durationMs: Date.now() - t, error: msg })
      return { ok: false as const, error: msg }
    }
  })
  
  ipcMain.handle(IpcChannels.S3_CREATE_BUCKET, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.createBucket(params.bucketName, params.region)
      getLogger().info('ipc', 's3:createBucket ok', { durationMs: Date.now() - t, bucket: params.bucketName, region: params.region || 'us-east-1' })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to create bucket'
      getLogger().warn('ipc', 's3:createBucket error', { durationMs: Date.now() - t, bucket: params.bucketName, error: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_OBJECT, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.deleteObject(params.bucket, params.key)
      getLogger().info('ipc', 's3:deleteObject ok', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'DeleteObject', bucket: params.bucket, key: params.key, status: 'ok', durationMs: Date.now() - t })) } catch {}
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete object'
      getLogger().warn('ipc', 's3:deleteObject error', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'DeleteObject', bucket: params.bucket, key: params.key, status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_OBJECTS, async (_e, params) => {
    const t = Date.now()
    try {
      const result = await s3.deleteObjects(params.bucket, params.keys)
      getLogger().info('ipc', 's3:deleteObjects ok', { durationMs: Date.now() - t, bucket: params.bucket, totalKeys: params.keys.length, deleted: result.deleted.length, errors: result.errors.length })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'DeleteObjects', bucket: params.bucket, status: 'ok', durationMs: Date.now() - t, extra: { totalKeys: params.keys.length, deleted: result.deleted.length, errors: result.errors.length } })) } catch {}
      return { ok: true as const, result }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete objects'
      getLogger().warn('ipc', 's3:deleteObjects error', { durationMs: Date.now() - t, bucket: params.bucket, totalKeys: params.keys.length, error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'DeleteObjects', bucket: params.bucket, status: 'error', error: msg, durationMs: Date.now() - t, extra: { totalKeys: params.keys.length } })) } catch {}
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_FOLDER, async (_e, params) => {
    const t = Date.now()
    try {
      const result = await s3.deleteFolder(params.bucket, params.prefix)
      getLogger().info('ipc', 's3:deleteFolder ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, deleted: result.deleted.length, errors: result.errors.length })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'DeleteFolder', bucket: params.bucket, prefix: params.prefix, status: 'ok', durationMs: Date.now() - t, extra: { deleted: result.deleted.length, errors: result.errors.length } })) } catch {}
      return { ok: true as const, result }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete folder'
      getLogger().warn('ipc', 's3:deleteFolder error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 's3', action: 'DeleteFolder', bucket: params.bucket, prefix: params.prefix, status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_CREATE_FOLDER, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.createFolder(params.bucket, params.prefix)
      getLogger().info('ipc', 's3:createFolder ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to create folder'
      getLogger().warn('ipc', 's3:createFolder error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
      return { ok: false as const, error: msg }
    }
  })
  ipcMain.handle(IpcChannels.UI_PICK_CREDENTIALS, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { title: 'Select AWS credentials file', properties: ['openFile'], filters: [{ name: 'AWS', extensions: ['ini','txt','credentials',''] }] })
    getLogger().trace('ui', 'pickCredentials', { canceled: res.canceled, count: res.filePaths?.length || 0 })
    return res.canceled ? undefined : res.filePaths[0]
  })

  ipcMain.handle(IpcChannels.UI_PICK_DIRECTORY, async (e, options?: { title?: string; defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { title: options?.title || 'Select download folder', defaultPath: options?.defaultPath, properties: ['openDirectory', 'createDirectory'] })
    getLogger().trace('ui', 'pickDirectory', { canceled: res.canceled, count: res.filePaths?.length || 0 })
    return res.canceled ? undefined : res.filePaths[0]
  })

  ipcMain.handle(IpcChannels.UI_PROCESS_DROPPED_FILES, async (_e, fileData: Array<{ name: string; path: string, size: number; type: string }>) => {
    getLogger().trace('ui', 'processDroppedFiles start', { count: fileData.length })

    // Return file info with paths that can be used for upload
    const result = fileData.map(f => {
      return {
        path: f.path,
        size: f.size || 0,
        name: f.name
      }
    })
    
    getLogger().trace('ui', 'processDroppedFiles success', { selected: result.length })
    return result
  })

  ipcMain.handle(IpcChannels.UI_MESSAGE_BOX, async (e, options: { type?: 'none'|'info'|'error'|'question'|'warning'; title?: string; message: string; detail?: string; buttons?: string[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showMessageBox(win, {
      type: options.type ?? 'info',
      title: options.title ?? (options.type === 'error' ? 'Error' : 'Message'),
      message: options.message,
      detail: options.detail,
      buttons: options.buttons ?? ['OK'],
      noLink: true,
      normalizeAccessKeys: true
    })
    return { response: res.response }
  })

  // Logging bridge from renderer
  ipcMain.handle(IpcChannels.LOG_WRITE, async (_e, payload: { level: string; scope: string; msg: string; meta?: Record<string, unknown> }) => {
    const lvl = (payload.level || 'INFO').toUpperCase()
    const logger = getLogger()
    const meta = safeMeta(payload.meta)
    switch (lvl) {
      case 'TRACE': return logger.trace(payload.scope, payload.msg, meta, 'renderer')
      case 'DEBUG': return logger.debug(payload.scope, payload.msg, meta, 'renderer')
      case 'INFO': return logger.info(payload.scope, payload.msg, meta, 'renderer')
      case 'WARN': return logger.warn(payload.scope, payload.msg, meta, 'renderer')
      case 'ERROR': return logger.error(payload.scope, payload.msg, meta, 'renderer')
      case 'FATAL': return logger.fatal(payload.scope, payload.msg, meta, 'renderer')
    }
  })
  ipcMain.handle(IpcChannels.LOG_GET_LEVEL, async () => ({ level: getLogger().getLevel() }))
  ipcMain.handle(IpcChannels.LOG_GET_CONSOLE_LEVEL, async () => ({ level: getLogger().getConsoleLevel() }))
  ipcMain.handle(IpcChannels.LOG_SET_LEVEL, async (_e, level: string) => { const l = (level || '').toUpperCase() as any; if (LEVELS.includes(l)) getLogger().setLevel(l); return { level: getLogger().getLevel() } })
  ipcMain.handle(IpcChannels.LOG_SET_CONSOLE_LEVEL, async (_e, level: string) => { const l = (level || '').toUpperCase() as any; if (LEVELS.includes(l)) getLogger().setConsoleLevel(l); return { level: getLogger().getConsoleLevel() } })
  ipcMain.handle(IpcChannels.LOG_OPEN_DIR, async () => { await getLogger().openLogsFolder(); return { ok: true as const } })

  // Transfer handlers
  ipcMain.handle(IpcChannels.XFER_START_OBJECT, async (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const t = Date.now()
    try {
      const jobId = await transfers.startObject(win, params)
      getLogger().info('xfer', 'start object', { durationMs: Date.now() - t, jobId, bucket: params.bucket, key: params.key })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 'xfer', action: 'DownloadObject', bucket: params.bucket, key: params.key, status: 'ok', durationMs: Date.now() - t, extra: { jobId } })) } catch {}
      return { ok: true as const, jobId }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start object download'
      getLogger().warn('xfer', 'start object failed', { error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 'xfer', action: 'DownloadObject', bucket: params.bucket, key: params.key, status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.XFER_START_PREFIX, async (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const t = Date.now()
    try {
      const jobId = await transfers.startPrefix(win, params)
      getLogger().info('xfer', 'start prefix', { durationMs: Date.now() - t, jobId, bucket: params.bucket, prefix: params.prefix })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 'xfer', action: 'DownloadPrefix', bucket: params.bucket, prefix: params.prefix, status: 'ok', durationMs: Date.now() - t, extra: { jobId } })) } catch {}
      return { ok: true as const, jobId }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start prefix download'
      getLogger().warn('xfer', 'start prefix failed', { error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 'xfer', action: 'DownloadPrefix', bucket: params.bucket, prefix: params.prefix, status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.XFER_START_UPLOAD, async (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const t = Date.now()
    try {
      const jobId = await transfers.startUpload(win, params)
      getLogger().info('xfer', 'start upload', { durationMs: Date.now() - t, jobId, bucket: params.bucket, files: params.files?.length || 0 })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 'xfer', action: 'Upload', bucket: params.bucket, status: 'ok', durationMs: Date.now() - t, extra: { jobId, files: params.files?.length || 0 } })) } catch {}
      return { ok: true as const, jobId }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start upload'
      getLogger().warn('xfer', 'start upload failed', { error: msg })
  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, { ts: Date.now(), scope: 'xfer', action: 'Upload', bucket: params.bucket, status: 'error', error: msg, durationMs: Date.now() - t })) } catch {}
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.XFER_CONTROL, async (e, params) => {
    try {
      const result = transfers.control(params.jobId, params.action)
      getLogger().debug('xfer', 'control', { jobId: params.jobId, action: params.action })
      return { ok: true as const, result }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to control transfer'
      getLogger().warn('xfer', 'control failed', { error: msg })
      return { ok: false as const, error: msg }
    }
  })
}

const LEVELS = ['TRACE','DEBUG','INFO','WARN','ERROR','FATAL']
