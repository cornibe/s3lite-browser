import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as s3 from './s3'
import { IpcChannels } from './types'

export function registerIpc() {
  ipcMain.handle(IpcChannels.S3_INIT, async (_e, params) => {
    const t = Date.now()
    try {
      await s3.init(params)
      if (process.env.VERBOSE_LOG === '1') {
        console.log('[ipc] s3:init', { durationMs: Date.now() - t })
      }
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to initialize S3 client'
      if (process.env.VERBOSE_LOG === '1') {
        console.log('[ipc] s3:init error', { durationMs: Date.now() - t, msg })
      }
      return { ok: false as const, error: msg }
    }
  })
  ipcMain.handle(IpcChannels.S3_LIST_BUCKETS, async () => {
    return s3.listBuckets()
  })
  ipcMain.handle(IpcChannels.S3_LIST_OBJECTS, async (_e, params) => {
    return s3.listObjects(params)
  })
  ipcMain.handle(IpcChannels.S3_LIST_PROFILES, async () => {
    return s3.listProfiles()
  })
  ipcMain.handle(IpcChannels.S3_SET_AWS_FILES, async (_e, params) => {
    s3.setAwsFiles(params)
    return { ok: true as const }
  })
  ipcMain.handle(IpcChannels.UI_PICK_CREDENTIALS, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { title: 'Select AWS credentials file', properties: ['openFile'], filters: [{ name: 'AWS', extensions: ['ini','txt','credentials',''] }] })
    return res.canceled ? undefined : res.filePaths[0]
  })
}
