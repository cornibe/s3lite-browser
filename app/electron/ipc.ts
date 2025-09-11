import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as s3 from './s3'
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
  ipcMain.handle(IpcChannels.UI_PICK_CREDENTIALS, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { title: 'Select AWS credentials file', properties: ['openFile'], filters: [{ name: 'AWS', extensions: ['ini','txt','credentials',''] }] })
    getLogger().trace('ui', 'pickCredentials', { canceled: res.canceled, count: res.filePaths?.length || 0 })
    return res.canceled ? undefined : res.filePaths[0]
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
}

const LEVELS = ['TRACE','DEBUG','INFO','WARN','ERROR','FATAL']
