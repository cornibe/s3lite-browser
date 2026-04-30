import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { RendererAPI } from './types'

const Channels = {
  S3_INIT: 's3:init',
  S3_LIST_BUCKETS: 's3:listBuckets',
  S3_LIST_OBJECTS: 's3:listObjects',
  S3_LIST_OBJECTS_RECURSIVE: 's3:listObjectsRecursive',
  S3_FOLDER_STATS_PAGE: 's3:folderStatsPage',
  S3_GET_OBJECT_DETAILS: 's3:getObjectDetails',
  S3_GET_OBJECT_PREVIEW: 's3:getObjectPreview',
  S3_LIST_PROFILES: 's3:listProfiles',
  S3_SET_AWS_FILES: 's3:setAwsFiles',
  S3_GET_AWS_FILES: 's3:getAwsFiles',
  S3_WRITE_AWS_FILES: 's3:writeAwsFiles',
  S3_CREATE_BUCKET: 's3:createBucket',
  S3_DELETE_OBJECT: 's3:deleteObject',
  S3_DELETE_OBJECTS: 's3:deleteObjects',
  S3_DELETE_FOLDER: 's3:deleteFolder',
  S3_CREATE_FOLDER: 's3:createFolder',
  S3_COPY_OBJECT: 's3:copyObject',
  UI_PICK_CREDENTIALS: 'ui:pickCredentials',
  UI_PICK_DIRECTORY: 'ui:pickDirectory',
  UI_PROCESS_DROPPED_FILES: 'ui:processDroppedFiles',
  UI_MESSAGE_BOX: 'ui:messageBox',
  UI_OPEN_SETTINGS: 'ui:openSettings',
  UI_OPEN_PROFILES: 'ui:openProfiles',
  LOG_WRITE: 'log:write',
  LOG_GET_LEVEL: 'log:getLevel',
  LOG_SET_LEVEL: 'log:setLevel',
  LOG_GET_CONSOLE_LEVEL: 'log:getConsoleLevel',
  LOG_SET_CONSOLE_LEVEL: 'log:setConsoleLevel',
  LOG_OPEN_DIR: 'log:openDir',
  LOG_AWS_EVENT: 'log:awsEvent',
  XFER_EVENT: 'xfer:event',
  XFER_START_OBJECT: 'xfer:startObject',
  XFER_START_PREFIX: 'xfer:startPrefix',
  XFER_START_UPLOAD: 'xfer:startUpload',
  XFER_CONTROL: 'xfer:control',
  UI_EXPORT_OBJECT_LIST: 'ui:exportObjectList'
} as const

const ExtraChannels = {
  UI_EXPORT_OBJECT_LIST: 'ui:exportObjectList',
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_OPEN_DIR: 'settings:openDir'
} as const

const api: RendererAPI = {
  s3: {
    init: (params) => ipcRenderer.invoke(Channels.S3_INIT, params),
    listBuckets: () => ipcRenderer.invoke(Channels.S3_LIST_BUCKETS),
    listObjects: (params) => ipcRenderer.invoke(Channels.S3_LIST_OBJECTS, params),
    listObjectsRecursive: (params) => ipcRenderer.invoke(Channels.S3_LIST_OBJECTS_RECURSIVE, params),
  folderStatsPage: (params) => ipcRenderer.invoke(Channels.S3_FOLDER_STATS_PAGE, params),
    getObjectDetails: (params) => ipcRenderer.invoke(Channels.S3_GET_OBJECT_DETAILS, params),
    getObjectPreview: (params) => ipcRenderer.invoke(Channels.S3_GET_OBJECT_PREVIEW, params),
    listProfiles: () => ipcRenderer.invoke(Channels.S3_LIST_PROFILES),
    setAwsFiles: (params) => ipcRenderer.invoke(Channels.S3_SET_AWS_FILES, params),
  getAwsFiles: () => ipcRenderer.invoke(Channels.S3_GET_AWS_FILES),
  writeAwsFiles: (params) => ipcRenderer.invoke(Channels.S3_WRITE_AWS_FILES, params),
    createBucket: (params) => ipcRenderer.invoke(Channels.S3_CREATE_BUCKET, params),
    deleteObject: (params) => ipcRenderer.invoke(Channels.S3_DELETE_OBJECT, params),
    deleteObjects: (params) => ipcRenderer.invoke(Channels.S3_DELETE_OBJECTS, params),
    deleteFolder: (params) => ipcRenderer.invoke(Channels.S3_DELETE_FOLDER, params),
    createFolder: (params) => ipcRenderer.invoke(Channels.S3_CREATE_FOLDER, params),
    copyObject: (params) => ipcRenderer.invoke(Channels.S3_COPY_OBJECT, params)
  },
  env: {
    isDev: () => process.env.NODE_ENV !== 'production'
  },
  ui: {
    pickCredentialsFile: () => ipcRenderer.invoke(Channels.UI_PICK_CREDENTIALS),
  pickDirectory: (options?: { title?: string; defaultPath?: string }) => ipcRenderer.invoke(Channels.UI_PICK_DIRECTORY, options),
    processDroppedFiles: (files: File[]) => {
      const fileData = files.map(file => ({
        name: file.name,
        path: (file as any).path || webUtils.getPathForFile(file),
        size: file.size,
        type: file.type
      }))
      return ipcRenderer.invoke(Channels.UI_PROCESS_DROPPED_FILES, fileData)
    },
  showMessageBox: (options) => ipcRenderer.invoke(Channels.UI_MESSAGE_BOX, options),
  onOpenSettings: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(Channels.UI_OPEN_SETTINGS, handler)
      return () => ipcRenderer.removeListener(Channels.UI_OPEN_SETTINGS, handler)
  },
  onOpenProfiles: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(Channels.UI_OPEN_PROFILES, handler)
      return () => ipcRenderer.removeListener(Channels.UI_OPEN_PROFILES, handler)
  },
  exportObjectList: (params: { defaultPath?: string; rows: Array<Record<string, any>> }) => ipcRenderer.invoke(Channels.UI_EXPORT_OBJECT_LIST, params)
  },
  settings: {
    load: () => ipcRenderer.invoke(ExtraChannels.SETTINGS_LOAD),
    save: (settings: any) => ipcRenderer.invoke(ExtraChannels.SETTINGS_SAVE, settings),
    openDir: () => ipcRenderer.invoke(ExtraChannels.SETTINGS_OPEN_DIR)
  },
  log: {
    write: (payload) => ipcRenderer.invoke(Channels.LOG_WRITE, payload),
    getLevel: () => ipcRenderer.invoke(Channels.LOG_GET_LEVEL),
    setLevel: (level) => ipcRenderer.invoke(Channels.LOG_SET_LEVEL, level),
    getConsoleLevel: () => ipcRenderer.invoke(Channels.LOG_GET_CONSOLE_LEVEL),
    setConsoleLevel: (level) => ipcRenderer.invoke(Channels.LOG_SET_CONSOLE_LEVEL, level),
    openDir: () => ipcRenderer.invoke(Channels.LOG_OPEN_DIR),
    onAwsEvent: (cb) => {
      const handler = (_: any, evt: any) => cb(evt)
      ipcRenderer.on(Channels.LOG_AWS_EVENT, handler)
      return () => ipcRenderer.removeListener(Channels.LOG_AWS_EVENT, handler)
    }
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
