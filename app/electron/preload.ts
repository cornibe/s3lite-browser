import { contextBridge, ipcRenderer } from 'electron'
import type { RendererAPI } from './types'

const Channels = {
  S3_INIT: 's3:init',
  S3_LIST_BUCKETS: 's3:listBuckets',
  S3_LIST_OBJECTS: 's3:listObjects',
  S3_LIST_PROFILES: 's3:listProfiles',
  S3_SET_AWS_FILES: 's3:setAwsFiles',
  UI_PICK_CREDENTIALS: 'ui:pickCredentials',
  UI_PROCESS_DROPPED_FILES: 'ui:processDroppedFiles',
  LOG_WRITE: 'log:write',
  LOG_GET_LEVEL: 'log:getLevel',
  LOG_SET_LEVEL: 'log:setLevel',
  LOG_GET_CONSOLE_LEVEL: 'log:getConsoleLevel',
  LOG_SET_CONSOLE_LEVEL: 'log:setConsoleLevel',
  LOG_OPEN_DIR: 'log:openDir',
  XFER_EVENT: 'xfer:event',
  XFER_START_OBJECT: 'xfer:startObject',
  XFER_START_PREFIX: 'xfer:startPrefix',
  XFER_START_UPLOAD: 'xfer:startUpload',
  XFER_CONTROL: 'xfer:control'
} as const

const api: RendererAPI = {
  s3: {
    init: (params) => ipcRenderer.invoke(Channels.S3_INIT, params),
    listBuckets: () => ipcRenderer.invoke(Channels.S3_LIST_BUCKETS),
    listObjects: (params) => ipcRenderer.invoke(Channels.S3_LIST_OBJECTS, params),
    listProfiles: () => ipcRenderer.invoke(Channels.S3_LIST_PROFILES),
    setAwsFiles: (params) => ipcRenderer.invoke(Channels.S3_SET_AWS_FILES, params)
  },
  env: {
    isDev: () => process.env.NODE_ENV !== 'production'
  },
  ui: {
    pickCredentialsFile: () => ipcRenderer.invoke(Channels.UI_PICK_CREDENTIALS),
    processDroppedFiles: (fileData) => ipcRenderer.invoke(Channels.UI_PROCESS_DROPPED_FILES, fileData)
  },
  log: {
    write: (payload) => ipcRenderer.invoke(Channels.LOG_WRITE, payload),
    getLevel: () => ipcRenderer.invoke(Channels.LOG_GET_LEVEL),
    setLevel: (level) => ipcRenderer.invoke(Channels.LOG_SET_LEVEL, level),
    getConsoleLevel: () => ipcRenderer.invoke(Channels.LOG_GET_CONSOLE_LEVEL),
    setConsoleLevel: (level) => ipcRenderer.invoke(Channels.LOG_SET_CONSOLE_LEVEL, level),
    openDir: () => ipcRenderer.invoke(Channels.LOG_OPEN_DIR)
  },
  transfers: {
    startObjectDownload: (params: any) => ipcRenderer.invoke(Channels.XFER_START_OBJECT, params),
    startPrefixDownload: (params: any) => ipcRenderer.invoke(Channels.XFER_START_PREFIX, params),
    control: (params: any) => ipcRenderer.invoke(Channels.XFER_CONTROL, params),
    onEvent: (cb: (evt: any) => void) => {
      const handler = (_: any, evt: any) => cb(evt)
      ipcRenderer.on(Channels.XFER_EVENT, handler)
      return () => ipcRenderer.removeListener(Channels.XFER_EVENT, handler)
    },
    startUpload: (params: any) => ipcRenderer.invoke(Channels.XFER_START_UPLOAD, params)
  }
}

contextBridge.exposeInMainWorld('api', api)
