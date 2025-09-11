import { contextBridge, ipcRenderer } from 'electron'
import type { RendererAPI } from './types'

const Channels = {
  S3_INIT: 's3:init',
  S3_LIST_BUCKETS: 's3:listBuckets',
  S3_LIST_OBJECTS: 's3:listObjects',
  S3_LIST_PROFILES: 's3:listProfiles',
  S3_SET_AWS_FILES: 's3:setAwsFiles',
  UI_PICK_CREDENTIALS: 'ui:pickCredentials'
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
  }
}

contextBridge.exposeInMainWorld('api', api)
