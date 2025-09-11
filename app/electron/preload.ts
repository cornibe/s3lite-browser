import { contextBridge, ipcRenderer } from 'electron'
import type { RendererAPI } from './types'

const Channels = {
  S3_INIT: 's3:init',
  S3_LIST_BUCKETS: 's3:listBuckets',
  S3_LIST_OBJECTS: 's3:listObjects',
  S3_LIST_PROFILES: 's3:listProfiles',
  S3_SET_AWS_FILES: 's3:setAwsFiles',
  UI_PICK_CREDENTIALS: 'ui:pickCredentials',
  LOG_WRITE: 'log:write',
  LOG_GET_LEVEL: 'log:getLevel',
  LOG_SET_LEVEL: 'log:setLevel',
  LOG_GET_CONSOLE_LEVEL: 'log:getConsoleLevel',
  LOG_SET_CONSOLE_LEVEL: 'log:setConsoleLevel',
  LOG_OPEN_DIR: 'log:openDir'
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
    pickCredentialsFile: () => ipcRenderer.invoke(Channels.UI_PICK_CREDENTIALS)
  },
  log: {
    write: (payload) => ipcRenderer.invoke(Channels.LOG_WRITE, payload),
    getLevel: () => ipcRenderer.invoke(Channels.LOG_GET_LEVEL),
    setLevel: (level) => ipcRenderer.invoke(Channels.LOG_SET_LEVEL, level),
    getConsoleLevel: () => ipcRenderer.invoke(Channels.LOG_GET_CONSOLE_LEVEL),
    setConsoleLevel: (level) => ipcRenderer.invoke(Channels.LOG_SET_CONSOLE_LEVEL, level),
    openDir: () => ipcRenderer.invoke(Channels.LOG_OPEN_DIR)
  }
}

contextBridge.exposeInMainWorld('api', api)
