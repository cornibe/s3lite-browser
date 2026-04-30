import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as s3 from './s3'
import { startObject as startObjectTransfer, startPrefix as startPrefixTransfer, startUpload as startUploadTransfer, control as controlTransfer } from './transfers'
import { IpcChannels, ExtraIpcChannels } from './types'
import * as fs from 'fs'
import * as path from 'path'
import { getLogger, safeMeta, redact } from './log'
import { loadSettingsFile, saveSettingsFile, openSettingsDir } from './settings'

function emitAwsEvent(payload: { ts?: number; scope: 's3' | 'xfer'; action: string; bucket?: string; key?: string; prefix?: string; status: 'ok' | 'error'; durationMs?: number; error?: string; extra?: any }) {
  try {
    const evt = { ts: Date.now(), ...payload }
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(IpcChannels.LOG_AWS_EVENT, evt))
  } catch {}
}

export function registerIpc() {
  const registerStartObjectActionHandler = (channel: string) => {
    ipcMain.handle(channel, async (e, params) => {
      const win = BrowserWindow.fromWebContents(e.sender)!
      const operationId = `objact_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
      const startedAt = Date.now()
      try {
        emitAwsEvent({
          scope: 's3',
          action: params.mode === 'copy' ? 'StartCopyObjects' : 'StartMoveObjects',
          bucket: params.destinationBucket,
          prefix: params.destinationPrefix ?? '',
          status: 'ok',
          extra: {
            operationId,
            sourceBucket: params.sourceBucket,
            itemCount: Array.isArray(params.items) ? params.items.length : 0
          }
        })
        void (async () => {
          try {
            const result = await s3.executeObjectAction(params, operationId, (evt) => {
              if (evt.type === 'progress') {
                emitAwsEvent({
                  scope: 's3',
                  action: evt.mode === 'copy' ? 'CopyObject' : 'MoveObject',
                  bucket: params.destinationBucket,
                  key: evt.currentDestinationKey,
                  status: 'ok',
                  durationMs: Date.now() - startedAt,
                  extra: {
                    operationId: evt.operationId,
                    sourceBucket: params.sourceBucket,
                    sourceKey: evt.currentSourceKey,
                    completed: evt.completed,
                    failed: evt.failed,
                    total: evt.total
                  }
                })
              } else if (evt.type === 'aborted') {
                emitAwsEvent({
                  scope: 's3',
                  action: evt.mode === 'copy' ? 'CopyObjects' : 'MoveObjects',
                  bucket: params.destinationBucket,
                  prefix: params.destinationPrefix ?? '',
                  status: 'error',
                  durationMs: Date.now() - startedAt,
                  error: 'Operation aborted',
                  extra: {
                    operationId: evt.operationId,
                    completed: evt.completed,
                    failed: evt.failed,
                    total: evt.total,
                    errors: evt.errors.length
                  }
                })
              }
              try { win.webContents.send(IpcChannels.S3_OBJECT_ACTION_EVENT, evt) } catch {}
            })
            try {
              emitAwsEvent({
                scope: 's3',
                action: params.mode === 'copy' ? 'CopyObjects' : 'MoveObjects',
                bucket: params.destinationBucket,
                prefix: params.destinationPrefix ?? '',
                status: result.failed > 0 ? 'error' : 'ok',
                durationMs: Date.now() - startedAt,
                error: result.failed > 0 ? `${result.failed} item(s) failed` : undefined,
                extra: {
                  operationId,
                  sourceBucket: params.sourceBucket,
                  completed: result.completed,
                  failed: result.failed,
                  total: result.total
                }
              })
              win.webContents.send(IpcChannels.S3_OBJECT_ACTION_EVENT, {
                type: 'complete',
                operationId,
                mode: params.mode,
                total: result.total,
                completed: result.completed,
                failed: result.failed,
                errors: result.errors
              })
            } catch {}
          } catch (err) {
            const msg = (err as Error)?.message || 'Object action failed'
            try {
              emitAwsEvent({
                scope: 's3',
                action: params.mode === 'copy' ? 'CopyObjects' : 'MoveObjects',
                bucket: params.destinationBucket,
                prefix: params.destinationPrefix ?? '',
                status: 'error',
                durationMs: Date.now() - startedAt,
                error: msg,
                extra: {
                  operationId,
                  sourceBucket: params.sourceBucket
                }
              })
              win.webContents.send(IpcChannels.S3_OBJECT_ACTION_EVENT, {
                type: 'error',
                operationId,
                mode: params.mode,
                total: 0,
                completed: 0,
                failed: 0,
                error: msg,
                errors: []
              })
            } catch {}
          }
        })()
        return { ok: true as const, operationId }
      } catch (e2) {
        const msg = (e2 as Error)?.message || 'Failed to start object action'
        return { ok: false as const, error: msg }
      }
    })
  }

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
      emitAwsEvent({ scope: 's3', action: 'ListBuckets', status: 'ok', durationMs: Date.now() - t })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list buckets'
      getLogger().warn('ipc', 's3:listBuckets error', { durationMs: Date.now() - t, error: msg })
      emitAwsEvent({ scope: 's3', action: 'ListBuckets', status: 'error', error: msg, durationMs: Date.now() - t })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_OBJECTS, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.listObjects(params)
      getLogger().debug('ipc', 's3:listObjects ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', folders: out.folders.length, objects: out.objects.length, truncated: Boolean(out.nextToken) })
      emitAwsEvent({ scope: 's3', action: 'ListObjects', bucket: params.bucket, prefix: params.prefix ?? '', status: 'ok', durationMs: Date.now() - t })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list objects'
      getLogger().warn('ipc', 's3:listObjects error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', error: msg })
      emitAwsEvent({ scope: 's3', action: 'ListObjects', bucket: params.bucket, prefix: params.prefix ?? '', status: 'error', error: msg, durationMs: Date.now() - t })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_OBJECTS_RECURSIVE, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.listObjectsRecursive(params)
      getLogger().debug('ipc', 's3:listObjectsRecursive ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', objects: out.objects.length, truncated: Boolean(out.nextToken) })
      emitAwsEvent({ scope: 's3', action: 'ListObjectsRecursive', bucket: params.bucket, prefix: params.prefix ?? '', status: 'ok', durationMs: Date.now() - t })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to list objects recursively'
      getLogger().warn('ipc', 's3:listObjectsRecursive error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix ?? '', error: msg })
      emitAwsEvent({ scope: 's3', action: 'ListObjectsRecursive', bucket: params.bucket, prefix: params.prefix ?? '', status: 'error', error: msg, durationMs: Date.now() - t })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_FOLDER_STATS_PAGE, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.folderStatsPage(params)
      getLogger().debug('ipc', 's3:folderStatsPage ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, objects: out.objects, files: out.files, folders: out.folders, bytes: out.bytes, truncated: Boolean(out.nextToken) })
      emitAwsEvent({ scope: 's3', action: 'FolderStatsPage', bucket: params.bucket, prefix: params.prefix, status: 'ok', durationMs: Date.now() - t, extra: { objects: out.objects, files: out.files, folders: out.folders, bytes: out.bytes } })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to scan folder'
      getLogger().warn('ipc', 's3:folderStatsPage error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
      emitAwsEvent({ scope: 's3', action: 'FolderStatsPage', bucket: params.bucket, prefix: params.prefix, status: 'error', error: msg, durationMs: Date.now() - t })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_GET_OBJECT_DETAILS, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.getObjectDetails(params)
      getLogger().debug('ipc', 's3:getObjectDetails ok', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, tags: out.tags?.length || 0 })
      emitAwsEvent({ scope: 's3', action: 'GetObjectDetails', bucket: params.bucket, key: params.key, status: 'ok', durationMs: Date.now() - t, extra: { tags: out.tags?.length || 0 } })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to get object details'
      getLogger().warn('ipc', 's3:getObjectDetails error', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, error: msg })
      emitAwsEvent({ scope: 's3', action: 'GetObjectDetails', bucket: params.bucket, key: params.key, status: 'error', error: msg, durationMs: Date.now() - t })
      throw e
    }
  })
  ipcMain.handle(IpcChannels.S3_GET_OBJECT_PREVIEW, async (_e, params) => {
    const t = Date.now()
    try {
      const out = await s3.getObjectPreview(params)
      getLogger().debug('ipc', 's3:getObjectPreview ok', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, bytes: (out.text?.length || 0), type: out.contentType || null, binary: out.isBinary })
      emitAwsEvent({ scope: 's3', action: 'GetObjectPreview', bucket: params.bucket, key: params.key, status: 'ok', durationMs: Date.now() - t, extra: { bytes: out.text?.length || 0, type: out.contentType || null, binary: out.isBinary } })
      return out
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to get object preview'
      getLogger().warn('ipc', 's3:getObjectPreview error', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, error: msg })
      emitAwsEvent({ scope: 's3', action: 'GetObjectPreview', bucket: params.bucket, key: params.key, status: 'error', error: msg, durationMs: Date.now() - t })
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
      emitAwsEvent({ scope: 's3', action: 'CreateBucket', bucket: params.bucketName, status: 'ok', durationMs: Date.now() - t, extra: { region: params.region || 'us-east-1' } })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to create bucket'
      getLogger().warn('ipc', 's3:createBucket error', { durationMs: Date.now() - t, bucket: params.bucketName, error: msg })
      emitAwsEvent({ scope: 's3', action: 'CreateBucket', bucket: params.bucketName, status: 'error', error: msg, durationMs: Date.now() - t, extra: { region: params.region || 'us-east-1' } })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_OBJECT, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.deleteObject(params.bucket, params.key)
      getLogger().info('ipc', 's3:deleteObject ok', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key })
      emitAwsEvent({ scope: 's3', action: 'DeleteObject', bucket: params.bucket, key: params.key, status: 'ok', durationMs: Date.now() - t })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete object'
      getLogger().warn('ipc', 's3:deleteObject error', { durationMs: Date.now() - t, bucket: params.bucket, key: params.key, error: msg })
      emitAwsEvent({ scope: 's3', action: 'DeleteObject', bucket: params.bucket, key: params.key, status: 'error', error: msg, durationMs: Date.now() - t })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_OBJECTS, async (_e, params) => {
    const t = Date.now()
    try {
      const result = await s3.deleteObjects(params.bucket, params.keys)
      getLogger().info('ipc', 's3:deleteObjects ok', { durationMs: Date.now() - t, bucket: params.bucket, totalKeys: params.keys.length, deleted: result.deleted.length, errors: result.errors.length })
      emitAwsEvent({ scope: 's3', action: 'DeleteObjects', bucket: params.bucket, status: 'ok', durationMs: Date.now() - t, extra: { totalKeys: params.keys.length, deleted: result.deleted.length, errors: result.errors.length } })
      return { ok: true as const, result }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete objects'
      getLogger().warn('ipc', 's3:deleteObjects error', { durationMs: Date.now() - t, bucket: params.bucket, totalKeys: params.keys.length, error: msg })
      emitAwsEvent({ scope: 's3', action: 'DeleteObjects', bucket: params.bucket, status: 'error', error: msg, durationMs: Date.now() - t, extra: { totalKeys: params.keys.length } })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_DELETE_FOLDER, async (_e, params) => {
    const t = Date.now()
    try {
      const result = await s3.deleteFolder(params.bucket, params.prefix)
      getLogger().info('ipc', 's3:deleteFolder ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, deleted: result.deleted.length, errors: result.errors.length })
      emitAwsEvent({ scope: 's3', action: 'DeleteFolder', bucket: params.bucket, prefix: params.prefix, status: 'ok', durationMs: Date.now() - t, extra: { deleted: result.deleted.length, errors: result.errors.length } })
      return { ok: true as const, result }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to delete folder'
      getLogger().warn('ipc', 's3:deleteFolder error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
      emitAwsEvent({ scope: 's3', action: 'DeleteFolder', bucket: params.bucket, prefix: params.prefix, status: 'error', error: msg, durationMs: Date.now() - t })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_CREATE_FOLDER, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.createFolder(params.bucket, params.prefix)
      getLogger().info('ipc', 's3:createFolder ok', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix })
      emitAwsEvent({ scope: 's3', action: 'CreateFolder', bucket: params.bucket, prefix: params.prefix, status: 'ok', durationMs: Date.now() - t })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to create folder'
      getLogger().warn('ipc', 's3:createFolder error', { durationMs: Date.now() - t, bucket: params.bucket, prefix: params.prefix, error: msg })
      emitAwsEvent({ scope: 's3', action: 'CreateFolder', bucket: params.bucket, prefix: params.prefix, status: 'error', error: msg, durationMs: Date.now() - t })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IpcChannels.S3_COPY_OBJECT, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.copyObject(params)
      getLogger().info('ipc', 's3:copyObject ok', {
        durationMs: Date.now() - t,
        sourceBucket: params.sourceBucket,
        sourceKey: params.sourceKey,
        destinationBucket: params.destinationBucket,
        destinationKey: params.destinationKey
      })
      emitAwsEvent({ scope: 's3', action: 'CopyObject', bucket: params.destinationBucket, key: params.destinationKey, status: 'ok', durationMs: Date.now() - t, extra: { sourceBucket: params.sourceBucket, sourceKey: params.sourceKey } })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to copy object'
      getLogger().warn('ipc', 's3:copyObject error', {
        durationMs: Date.now() - t,
        sourceBucket: params.sourceBucket,
        sourceKey: params.sourceKey,
        destinationBucket: params.destinationBucket,
        destinationKey: params.destinationKey,
        error: msg
      })
      emitAwsEvent({ scope: 's3', action: 'CopyObject', bucket: params.destinationBucket, key: params.destinationKey, status: 'error', error: msg, durationMs: Date.now() - t, extra: { sourceBucket: params.sourceBucket, sourceKey: params.sourceKey } })
      return { ok: false as const, error: msg }
    }
  })
  registerStartObjectActionHandler(IpcChannels.S3_START_OBJECT_ACTION)
  registerStartObjectActionHandler('s3:StartObjectAction')
  ipcMain.handle(IpcChannels.S3_CANCEL_OBJECT_ACTION, async (_e, params) => {
    try {
      s3.cancelObjectAction(params.operationId)
      emitAwsEvent({ scope: 's3', action: 'CancelObjectAction', status: 'ok', extra: { operationId: params.operationId } })
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to abort object action'
      emitAwsEvent({ scope: 's3', action: 'CancelObjectAction', status: 'error', error: msg, extra: { operationId: params.operationId } })
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

  // Export object list to CSV
  ipcMain.handle(ExtraIpcChannels.UI_EXPORT_OBJECT_LIST, async (e, params: { defaultPath?: string; rows: Array<Record<string, any>> }) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    try {
      const res = await dialog.showSaveDialog(win, {
        title: 'Save object list',
        defaultPath: params.defaultPath || 'objects.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false as const, canceled: true }
      const filePath = res.filePath
      // Build CSV (simple RFC4180-ish escaping of quotes)
      if (!params.rows || params.rows.length === 0) {
        fs.writeFileSync(filePath, '')
        return { ok: true as const, filePath, rows: 0 }
      }
      const headers = Object.keys(params.rows[0])
      const escape = (v: any) => {
        if (v === null || v === undefined) return ''
        const s = String(v)
        if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
        return s
      }
      const lines: string[] = []
      lines.push(headers.map(escape).join(','))
      for (const row of params.rows) {
        lines.push(headers.map(h => escape(row[h])).join(','))
      }
      fs.writeFileSync(filePath, lines.join('\n'))
      return { ok: true as const, filePath, rows: params.rows.length }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to export CSV'
      getLogger().warn('ipc', 'exportObjectList error', { error: msg })
      return { ok: false as const, error: msg }
    }
  })

  // Settings persistence
  ipcMain.handle(ExtraIpcChannels.SETTINGS_LOAD, async () => {
    try {
      const s = await loadSettingsFile()
      return { ok: true as const, settings: s }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to load settings'
      getLogger().warn('ipc', 'settings:load error', { error: msg })
      return { ok: true as const, settings: undefined }
    }
  })
  ipcMain.handle(ExtraIpcChannels.SETTINGS_SAVE, async (_e, settings: any) => {
    try {
      await saveSettingsFile(settings)
      return { ok: true as const }
    } catch (err) {
      const msg = (err as Error)?.message || 'Failed to save settings'
      getLogger().warn('ipc', 'settings:save error', { error: msg })
      return { ok: false as const, error: msg }
    }
  })
  ipcMain.handle(ExtraIpcChannels.SETTINGS_OPEN_DIR, async () => {
    try { await openSettingsDir(); return { ok: true as const } } catch { return { ok: true as const } }
  })

  // Transfer handlers
  ipcMain.handle(IpcChannels.XFER_START_OBJECT, async (e, params) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const t = Date.now()
    try {
  const jobId = await startObjectTransfer(win, params)
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
  const jobId = await startPrefixTransfer(win, params)
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
  const jobId = await startUploadTransfer(win, params)
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
      const win = BrowserWindow.fromWebContents(e.sender)!
  const result = controlTransfer(win, params.jobId, params.action)
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
