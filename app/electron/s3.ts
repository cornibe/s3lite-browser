import { S3Client, ListBucketsCommand, ListObjectsV2Command, CreateBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getLogger } from './log'
import * as transfers from './transfers'
import type { S3InitParams, ListObjectsParams, ListObjectsResult, ProfileInfo, FolderStatsPageParams, FolderStatsPageResult } from './types'

let client: S3Client | null = null
let currentProfile: string | undefined
let overrideCredsPath: string | undefined
let overrideConfigPath: string | undefined

function ensureClient() {
  if (!client) throw new Error('S3 client not initialized. Connect to a profile first.')
  return client
}

export function getClient(): S3Client {
  return ensureClient()
}

export async function init(params: S3InitParams) {
  currentProfile = params.profile
  process.env.AWS_SDK_LOAD_CONFIG = '1'
  if (currentProfile) process.env.AWS_PROFILE = currentProfile
  // Clear any previous client so calls after a failed init don't use a stale client
  client = null
  const region = await resolveRegion(currentProfile)
  if (!region) {
    throw new Error(`Could not resolve region${currentProfile ? ` for profile "${currentProfile}"` : ''}. Set region in ~/.aws/config or credentials, or export AWS_REGION.`)
  }
  client = new S3Client({ region })
  transfers.bindS3Client(client)
  getLogger().info('aws', 's3 client initialized', { profile: currentProfile || null, region })
}

export async function listBuckets(): Promise<string[]> {
  const c = ensureClient()
  const start = Date.now()
  try {
    const out = await c.send(new ListBucketsCommand({}))
    const names = (out.Buckets ?? [])
      .map(b => b.Name!)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  getLogger().debug('aws', 'listBuckets', { durationMs: Date.now() - start, count: names.length })
    return names
  } catch (err) {
    throw toFriendlyError('List Buckets', err)
  }
}

export async function listObjects(params: ListObjectsParams): Promise<ListObjectsResult> {
  const c = ensureClient()
  const start = Date.now()
  try {
    const out = await c.send(new ListObjectsV2Command({
      Bucket: params.bucket,
      Prefix: params.prefix ?? '',
      ContinuationToken: params.token,
      MaxKeys: params.maxKeys ?? 1000,
      Delimiter: '/'
    }))
    const folders = (out.CommonPrefixes ?? [])
      .map(p => ({ prefix: p.Prefix! }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix))
    const objects = (out.Contents ?? [])
      .filter(o => (o.Key ?? '').length > 0 && !(o.Key!.endsWith('/') && (o.Size ?? 0) === 0))
      .map(o => ({
        key: o.Key!,
        size: o.Size ?? 0,
        lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : undefined,
        etag: o.ETag ?? undefined,
        storageClass: o.StorageClass ?? undefined
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
    const nextToken = out.IsTruncated ? out.NextContinuationToken : undefined
  getLogger().debug('aws', 'listObjects', { bucket: params.bucket, prefix: params.prefix ?? '', durationMs: Date.now() - start, folders: folders.length, objects: objects.length, truncated: Boolean(nextToken) })
    return { folders, objects, nextToken }
  } catch (err) {
    throw toFriendlyError(`List Objects in s3://${params.bucket}/${params.prefix ?? ''}`, err)
  }
}

// Returns a single page of folder stats (object count, bytes) under a prefix.
// Uses pagination token to continue. Caller can loop for full totals or page in UI.
export async function folderStatsPage(params: FolderStatsPageParams): Promise<FolderStatsPageResult> {
  const c = ensureClient()
  const start = Date.now()
  try {
    const out = await c.send(new ListObjectsV2Command({
      Bucket: params.bucket,
      Prefix: params.prefix,
      ContinuationToken: params.token,
      MaxKeys: params.maxKeys ?? 2000
      // No Delimiter to include all nested objects
    }))
  const pageObjects = (out.Contents ?? []).filter(o => (o.Key ?? '').length > 0)
    // Derive counts: files vs folders (folder markers are zero-size keys ending with '/')
    let files = 0
    let folders = 0
    for (const o of pageObjects) {
      const key = o.Key || ''
      const isFolderMarker = key.endsWith('/') && (o.Size ?? 0) === 0
      if (isFolderMarker) folders++
      else files++
    }
    const objects = pageObjects.length
    const bytes = pageObjects.reduce((sum, o) => sum + (o.Size ?? 0), 0)
  const nextToken = out.IsTruncated ? out.NextContinuationToken : undefined
    getLogger().debug('aws', 'folderStatsPage', { bucket: params.bucket, prefix: params.prefix, objects, files, folders, bytes, truncated: Boolean(nextToken), durationMs: Date.now() - start })
  return { objects, files, folders, bytes, keys: pageObjects.map(o => o.Key!), nextToken }
  } catch (err) {
    throw toFriendlyError(`Scan folder s3://${params.bucket}/${params.prefix}`, err)
  }
}

function parseIni(content: string) {
  const sections: Record<string, Record<string, string>> = {}
  let current: string | null = null
  const text = content.replace(/^\uFEFF/, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const m = line.match(/^\[(.+?)\]$/)
    if (m) { current = m[1].trim(); if (!sections[current]) sections[current] = {}; continue }
    const kv = line.split('=')
    if (current && kv.length >= 2) {
      const key = kv[0].trim()
      const value = kv.slice(1).join('=').trim()
      sections[current][key] = value
    }
  }
  return sections
}

async function readFileSafe(p: string) {
  try { return await fs.promises.readFile(p, 'utf8') } catch { return '' }
}

async function resolveRegion(profile?: string): Promise<string | undefined> {
  const credsPath = overrideCredsPath || process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials')
  const configPath = overrideConfigPath || process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config')
  const credsRaw = await readFileSafe(credsPath)
  const configRaw = await readFileSafe(configPath)
  const creds = credsRaw ? parseIni(credsRaw) : {}
  const cfg = configRaw ? parseIni(configRaw) : {}
  const namesToTry = new Set<string>()
  if (profile) {
    namesToTry.add(`profile ${profile}`)
    namesToTry.add(profile)
  }
  // environment vars can also provide region
  const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
  const fromCfg = firstDefined(
    [...namesToTry].map(n => cfg[n]?.['region'])
  )
  const fromCreds = firstDefined(
    [...namesToTry].map(n => creds[n]?.['region'] || creds[n]?.['aws_region'] || creds[n]?.['aws_default_region'])
  )
  const resolved = fromCfg || fromCreds || envRegion
  getLogger().debug('fs', 'resolveRegion', { profile: profile || null, resolved: resolved || null, fromCfg: !!fromCfg, fromCreds: !!fromCreds, env: !!envRegion, credsPath, configPath })
  return resolved
}

function firstDefined<T>(arr: Array<T | undefined>): T | undefined {
  for (const v of arr) if (v !== undefined && v !== '') return v
  return undefined
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const credsPath = overrideCredsPath || process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials')
  const configPath = overrideConfigPath || process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config')
  const credsRaw = await readFileSafe(credsPath)
  const configRaw = await readFileSafe(configPath)
  const creds = credsRaw ? parseIni(credsRaw) : {}
  const cfg = configRaw ? parseIni(configRaw) : {}

  const out: ProfileInfo[] = []
  for (const rawName of Object.keys(creds)) {
    const name = rawName.startsWith('profile ') ? rawName.slice('profile '.length) : rawName
    const cfgSection = cfg['profile ' + name] || cfg[name] || {}
    const isSso = Boolean(cfgSection['sso_start_url'] || cfgSection['sso_session'])
    const item: ProfileInfo = { name }
    if (isSso) (item as any).isSso = true
    out.push(item)
  }
  // If there were zero credentials, include config-only profiles as a fallback
  if (out.length === 0) {
    for (const rawName of Object.keys(cfg)) {
      const name = rawName.startsWith('profile ') ? rawName.slice('profile '.length) : rawName
      const cfgSection = cfg['profile ' + name] || cfg[name] || {}
      const isSso = Boolean(cfgSection['sso_start_url'] || cfgSection['sso_session'])
      const item: ProfileInfo = { name }
      if (isSso) (item as any).isSso = true
      out.push(item)
    }
  }
  getLogger().debug('fs', 'listProfiles', { credsPath, configPath, count: out.length })
  return out
}

export function setAwsFiles(params: { credentialsFile?: string; configFile?: string }) {
  overrideCredsPath = params.credentialsFile
  overrideConfigPath = params.configFile
}

export async function getAwsFiles(): Promise<{ credentialsPath: string; configPath: string; credentialsText: string; configText: string }> {
  const credsPath = overrideCredsPath || process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials')
  const configPath = overrideConfigPath || process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config')
  const credentialsText = await readFileSafe(credsPath)
  const configText = await readFileSafe(configPath)
  return { credentialsPath: credsPath, configPath, credentialsText, configText }
}

export async function writeAwsFiles(params: { credentialsText: string; configText: string }): Promise<void> {
  const credsPath = overrideCredsPath || process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials')
  const configPath = overrideConfigPath || process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config')
  // ensure folder exists
  const awsDir = path.dirname(credsPath)
  try { await fs.promises.mkdir(awsDir, { recursive: true }) } catch {}
  // simple backup
  async function backupIfExists(p: string) {
    try {
      const stat = await fs.promises.stat(p)
      if (stat.isFile()) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        await fs.promises.copyFile(p, `${p}.bak-${ts}`)
      }
    } catch {}
  }
  await backupIfExists(credsPath)
  await backupIfExists(configPath)
  // write files
  await fs.promises.writeFile(credsPath, params.credentialsText ?? '', 'utf8')
  await fs.promises.writeFile(configPath, params.configText ?? '', 'utf8')
}

function toFriendlyError(context: string, err: unknown): Error {
  const e = err as any
  const code = e?.name || e?.Code || e?.code || e?.$metadata?.httpStatusCode
  let msg = `${context} failed.`
  switch (code) {
    case 'CredentialsProviderError':
      msg = `${context} failed: Could not load AWS credentials. Ensure the selected profile exists and you are logged in (for SSO).`
      break
    case 'AccessDenied':
    case 'AccessDeniedException':
      msg = `${context} failed: Access denied. Your credentials may lack required S3 permissions.`
      break
    case 'ExpiredToken':
    case 'TokenExpired':
      msg = `${context} failed: Session token expired. Re-authenticate or refresh credentials.`
      break
    case 'InvalidAccessKeyId':
    case 'SignatureDoesNotMatch':
      msg = `${context} failed: Invalid AWS credentials. Check your access key/secret for the selected profile.`
      break
    case 'UnknownEndpoint':
    case 'ENOTFOUND':
    case 'ECONNRESET':
    case 'ECONNREFUSED':
      msg = `${context} failed: Network error contacting AWS. Check connectivity and region.`
      break
    case 'BucketAlreadyExists':
    case 'BucketAlreadyOwnedByYou':
      msg = `${context} failed: Bucket already exists.`
      break
    case 'InvalidBucketName':
      msg = `${context} failed: Invalid bucket name. Bucket names must be 3-63 characters, lowercase, and follow DNS naming conventions.`
      break
    case 'NoSuchBucket':
      msg = `${context} failed: Bucket does not exist.`
      break
    case 'NoSuchKey':
      msg = `${context} failed: Object does not exist.`
      break
    default:
      if (typeof code === 'number') {
        if (code === 403) msg = `${context} failed: Access denied (403).`
        else if (code === 400) msg = `${context} failed: Bad request (400).`
      } else if (e?.message) {
        msg = `${context} failed: ${String(e.message)}`
      }
  }
  const friendly = new Error(msg)
  return friendly
}

export async function createBucket(bucketName: string, region?: string): Promise<void> {
  const c = ensureClient()
  const start = Date.now()
  try {
    const commandInput: any = { Bucket: bucketName }
    if (region && region !== 'us-east-1') {
      commandInput.CreateBucketConfiguration = { LocationConstraint: region }
    }
    const command = new CreateBucketCommand(commandInput)
    await c.send(command)
    getLogger().info('aws', 'createBucket', { bucket: bucketName, region: region || 'us-east-1', durationMs: Date.now() - start })
  } catch (err) {
    throw toFriendlyError(`Create bucket "${bucketName}"`, err)
  }
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  const c = ensureClient()
  const start = Date.now()
  try {
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    getLogger().info('aws', 'deleteObject', { bucket, key, durationMs: Date.now() - start })
  } catch (err) {
    throw toFriendlyError(`Delete object s3://${bucket}/${key}`, err)
  }
}

export async function deleteObjects(bucket: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: string }> }> {
  const c = ensureClient()
  const start = Date.now()
  const deleted: string[] = []
  const errors: Array<{ key: string; error: string }> = []

  if (keys.length === 0) {
    return { deleted, errors }
  }

  try {
    // S3 allows up to 1000 objects per delete request
    const batches: string[][] = []
    for (let i = 0; i < keys.length; i += 1000) {
      batches.push(keys.slice(i, i + 1000))
    }

    for (const batch of batches) {
      const command = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map(key => ({ Key: key })),
          Quiet: false
        }
      })
      
      const result = await c.send(command)
      
      // Track successful deletions
      if (result.Deleted) {
        for (const del of result.Deleted) {
          if (del.Key) deleted.push(del.Key)
        }
      }
      
      // Track errors
      if (result.Errors) {
        for (const err of result.Errors) {
          if (err.Key) {
            errors.push({ 
              key: err.Key, 
              error: err.Message || err.Code || 'Unknown error' 
            })
          }
        }
      }
    }

    getLogger().info('aws', 'deleteObjects', { bucket, totalKeys: keys.length, deleted: deleted.length, errors: errors.length, durationMs: Date.now() - start })
    return { deleted, errors }
  } catch (err) {
    throw toFriendlyError(`Delete objects in s3://${bucket}`, err)
  }
}

export async function deleteFolder(bucket: string, prefix: string): Promise<{ deleted: string[]; errors: Array<{ key: string; error: string }> }> {
  const c = ensureClient()
  const start = Date.now()
  const allDeleted: string[] = []
  const allErrors: Array<{ key: string; error: string }> = []

  try {
    let continuationToken: string | undefined = undefined
    
    do {
      // List all objects with the prefix
      const listResult = await c.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      }))

      const keys = (listResult.Contents || [])
        .map(obj => obj.Key!)
        .filter(Boolean)

      if (keys.length > 0) {
        const deleteResult = await deleteObjects(bucket, keys)
        allDeleted.push(...deleteResult.deleted)
        allErrors.push(...deleteResult.errors)
      }

      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined
    } while (continuationToken)

    getLogger().info('aws', 'deleteFolder', { bucket, prefix, deleted: allDeleted.length, errors: allErrors.length, durationMs: Date.now() - start })
    return { deleted: allDeleted, errors: allErrors }
  } catch (err) {
    throw toFriendlyError(`Delete folder s3://${bucket}/${prefix}`, err)
  }
}

export async function createFolder(bucket: string, prefix: string): Promise<void> {
  const c = ensureClient()
  const start = Date.now()
  try {
    // Ensure prefix ends with / to represent a folder
    const folderKey = prefix.endsWith('/') ? prefix : `${prefix}/`
    
    // Create an empty object with the folder key
    await c.send(new PutObjectCommand({
      Bucket: bucket,
      Key: folderKey,
      Body: '',
      ContentLength: 0
    }))
    
    getLogger().info('aws', 'createFolder', { bucket, prefix: folderKey, durationMs: Date.now() - start })
  } catch (err) {
    throw toFriendlyError(`Create folder s3://${bucket}/${prefix}`, err)
  }
}
