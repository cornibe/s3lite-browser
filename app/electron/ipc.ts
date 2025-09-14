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
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list buckets'
      getLogger().warn('ipc', 's3:listBuckets error', { durationMs: Date.now() - t, error: msg })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_OBJECTS, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.listObjects(params)
      getLogger().debug('ipc', 's3:listObjects ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', folders: out.folders.length, objects: out.objects.length, truncated: Boolean(out.nextToken) })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list objects'
      getLogger().warn('ipc', 's3:listObjects error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', error: msg })
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
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete object'
      getLogger().warn('ipc', 's3:deleteObject error', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, error: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_OBJECTS, async (_e, params) => {
    const t = Date.now()
    try {
      const result = await s3.deleteObjects(params.bucket, params.keys)
      getLogger().info('ipc', 's3:deleteObjects ok', { durationMs: Date.now() - t, bucket: params.bucket, totalKeys: params.keys.length, deleted: result.deleted.length, errors: result.errors.length })
      return { ok: true as const, result }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete objects'
      getLogger().warn('ipc', 's3:deleteObjects error', { durationMs: Date.now() - t, bucket: params.bucket, totalKeys: params.keys.length, error: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_FOLDER, async (_e, params) => {
    const t = Date.now()
    try {
      const result = await s3.deleteFolder(params.bucket, params.prefix)
      getLogger().info('ipc', 's3:deleteFolder ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, deleted: result.deleted.length, errors: result.errors.length })
      return { ok: true as const, result }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete folder'
      getLogger().warn('ipc', 's3:deleteFolder error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
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
      return { ok: true as const, jobId }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start object download'
      getLogger().warn('xfer', 'start object failed', { error: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.XFER_START_PREFIX, async (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const t = Date.now()
    try {
      const jobId = await transfers.startPrefix(win, params)
      getLogger().info('xfer', 'start prefix', { durationMs: Date.now() - t, jobId, bucket: params.bucket, prefix: params.prefix })
      return { ok: true as const, jobId }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start prefix download'
      getLogger().warn('xfer', 'start prefix failed', { error: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.XFER_START_UPLOAD, async (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const t = Date.now()
    try {
      const jobId = await transfers.startUpload(win, params)
      getLogger().info('xfer', 'start upload', { durationMs: Date.now() - t, jobId, bucket: params.bucket, files: params.files?.length || 0 })
      return { ok: true as const, jobId }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to start upload'
      getLogger().warn('xfer', 'start upload failed', { error: msg })
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
