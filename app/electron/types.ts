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

// Folder stats (paged aggregation)
export type FolderStatsPageParams = {
  bucket: string
  prefix: string
  token?: string
  maxKeys?: number
}

export type FolderStatsPageResult = {
  objects: number
  bytes: number
  files?: number
  folders?: number
  keys?: string[]
  nextToken?: string
}

export type ProfileInfo = {
  name: string
  isSso?: boolean
}

// New operation types
export type CreateBucketParams = {
  bucketName: string
  region?: string
}

export type DeleteObjectParams = {
  bucket: string
  key: string
}

export type DeleteObjectsParams = {
  bucket: string
  keys: string[]
}

export type DeleteFolderParams = {
  bucket: string
  prefix: string
}

export type CreateFolderParams = {
  bucket: string
  prefix: string
}

export type DeleteResult = {
  deleted: string[]
  errors: Array<{ key: string; error: string }>
}

// Transfer types
export type DownloadSettings = {
  objectConcurrency?: number
  partConcurrency?: number
  partSizeMiB?: number
  multipartThresholdMiB?: number
  overwritePolicy?: 'skip' | 'overwrite' | 'rename' | 'prompt'
  bandwidthLimitKBps?: number
  requesterPays?: boolean
}

export type StartObjectDownload = {
  bucket: string
  key: string
  destDir: string
  settings?: DownloadSettings
}

export type StartPrefixDownload = {
  bucket: string
  prefix: string
  destDir: string
  settings?: DownloadSettings
}

export type StartUploadParams = {
  bucket: string
  prefix?: string
  files: Array<{ path: string; size: number; name?: string }>
  settings?: DownloadSettings
}

export type TransferItem = {
  id: string
  jobId: string
  bucket: string
  key: string
  size: number
  destPath: string
  status: 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'canceled' | 'in-progress'
  bytesTransferred: number
  error?: string
  etag?: string
  startedAt?: number
  completedAt?: number
  speedBps?: number
  etaSeconds?: number
}

export type TransferJob = {
  id: string
  type: 'object' | 'prefix'
  bucket: string
  prefix: string
  destDir: string
  status: 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'canceled' | 'in-progress'
  totalBytes: number
  completedBytes: number
  itemCount: number
  completedCount: number
  settings: DownloadSettings
  error?: string
}

export type TransferEvent =
  | { type: 'job-state'; job: TransferJob }
  | { type: 'item-state'; jobId: string; item: TransferItem }
  | { type: 'job-complete'; jobId: string }
  | { type: 'job-error'; jobId: string; error: string }

export interface RendererAPI {
  s3: {
    init(params: S3InitParams): Promise<{ ok: true } | { ok: false; error: string }>
    listBuckets(): Promise<string[]>
    listObjects(params: ListObjectsParams): Promise<ListObjectsResult>
    folderStatsPage(params: FolderStatsPageParams): Promise<FolderStatsPageResult>
    listProfiles(): Promise<ProfileInfo[]>
    setAwsFiles(params: { credentialsFile?: string; configFile?: string }): Promise<{ ok: true }>
  getAwsFiles(): Promise<{ credentialsPath: string; configPath: string; credentialsText: string; configText: string }>
  writeAwsFiles(params: { credentialsText: string; configText: string }): Promise<{ ok: true } | { ok: false; error: string }>
    createBucket(params: CreateBucketParams): Promise<{ ok: true } | { ok: false; error: string }>
    deleteObject(params: DeleteObjectParams): Promise<{ ok: true } | { ok: false; error: string }>
    deleteObjects(params: DeleteObjectsParams): Promise<{ ok: true; result: DeleteResult } | { ok: false; error: string }>
    deleteFolder(params: DeleteFolderParams): Promise<{ ok: true; result: DeleteResult } | { ok: false; error: string }>
    createFolder(params: CreateFolderParams): Promise<{ ok: true } | { ok: false; error: string }>
  }
  env: {
    isDev(): boolean
  }
  ui: {
    pickCredentialsFile(): Promise<string | undefined>
    pickDirectory(options?: { title?: string; defaultPath?: string }): Promise<string | undefined>
    processDroppedFiles(fileData: Array<{ name: string; size: number; type: string }>): Promise<Array<{ path: string; size: number; name: string }>>
  onOpenSettings(cb: () => void): () => void
  }
  log: {
    write(payload: { level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'; scope: string; msg: string; meta?: Record<string, unknown> }): Promise<void>
    getLevel(): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    setLevel(level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    getConsoleLevel(): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    setConsoleLevel(level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'): Promise<{ level: 'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL' }>
    openDir(): Promise<{ ok: true }>
  onAwsEvent(cb: (evt: { ts: number; scope: 's3'|'xfer'; action: string; bucket?: string; key?: string; prefix?: string; status: 'ok'|'error'; durationMs?: number; error?: string; extra?: any }) => void): () => void
  }
  transfers: {
    startObjectDownload(params: StartObjectDownload): Promise<{ ok: true; jobId: string } | { ok: false; error: string }>
    startPrefixDownload(params: StartPrefixDownload): Promise<{ ok: true; jobId: string } | { ok: false; error: string }>
    startUpload(params: StartUploadParams): Promise<{ ok: true; jobId: string } | { ok: false; error: string }>
    control(params: any): Promise<any>
    onEvent(cb: (evt: TransferEvent) => void): () => void
  }
}

export const IpcChannels = {
  S3_INIT: 's3:init',
  S3_LIST_BUCKETS: 's3:listBuckets',
  S3_LIST_OBJECTS: 's3:listObjects',
  S3_FOLDER_STATS_PAGE: 's3:folderStatsPage',
  S3_LIST_PROFILES: 's3:listProfiles',
  S3_SET_AWS_FILES: 's3:setAwsFiles',
  S3_GET_AWS_FILES: 's3:getAwsFiles',
  S3_WRITE_AWS_FILES: 's3:writeAwsFiles',
  S3_CREATE_BUCKET: 's3:createBucket',
  S3_DELETE_OBJECT: 's3:deleteObject',
  S3_DELETE_OBJECTS: 's3:deleteObjects',
  S3_DELETE_FOLDER: 's3:deleteFolder',
  S3_CREATE_FOLDER: 's3:createFolder',
  UI_PICK_CREDENTIALS: 'ui:pickCredentials',
  UI_PICK_DIRECTORY: 'ui:pickDirectory',
  UI_PROCESS_DROPPED_FILES: 'ui:processDroppedFiles',
  UI_OPEN_SETTINGS: 'ui:openSettings',
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
  XFER_CONTROL: 'xfer:control'
} as const
