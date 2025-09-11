export type S3InitParams = {
  profile?: string
}

export type S3Folder = { prefix: string }

export type S3ObjectItem = {
  key: string
  size: number
  lastModified?: string
  etag?: string
  storageClass?: string
}

export type ListObjectsParams = {
  bucket: string
  prefix?: string
  token?: string
  maxKeys?: number
}

export type ListObjectsResult = {
  folders: S3Folder[]
  objects: S3ObjectItem[]
  nextToken?: string
}

export type ProfileInfo = {
  name: string
  isSso?: boolean
}

export interface RendererAPI {
  s3: {
    init(params: S3InitParams): Promise<{ ok: true } | { ok: false; error: string }>
    listBuckets(): Promise<string[]>
    listObjects(params: ListObjectsParams): Promise<ListObjectsResult>
    listProfiles(): Promise<ProfileInfo[]>
    setAwsFiles(params: { credentialsFile?: string; configFile?: string }): Promise<{ ok: true }>
  }
  env: {
    isDev(): boolean
  }
  ui: {
    pickCredentialsFile(): Promise<string | undefined>
  }
  log: {
    write(payload: { level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'; scope: string; msg: string; meta?: Record<string, unknown> }): Promise<void>
    getLevel(): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    setLevel(level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    getConsoleLevel(): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    setConsoleLevel(level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    openDir(): Promise<{ ok: true }>
  }
}

export const IpcChannels = {
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
