import { S3Client, ListBucketsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ListObjectsParams, ListObjectsResult, S3InitParams, ProfileInfo } from './types'

let client: S3Client | null = null
let currentProfile: string | undefined
let overrideCredsPath: string | undefined
let overrideConfigPath: string | undefined

function ensureClient() {
  if (!client) client = new S3Client({})
  return client
}

export async function init(params: S3InitParams) {
  currentProfile = params.profile
  process.env.AWS_SDK_LOAD_CONFIG = '1'
  if (currentProfile) process.env.AWS_PROFILE = currentProfile
  const region = await resolveRegion(currentProfile)
  if (!region) {
    throw new Error(`Could not resolve region${currentProfile ? ` for profile "${currentProfile}"` : ''}. Set region in ~/.aws/config or credentials, or export AWS_REGION.`)
  }
  client = new S3Client({ region })
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
    if (process.env.VERBOSE_LOG === '1') {
      console.log('[s3:listBuckets]', { durationMs: Date.now() - start, count: names.length })
    }
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
    if (process.env.VERBOSE_LOG === '1') {
      console.log('[s3:listObjects]', {
        bucket: params.bucket,
        prefix: params.prefix ?? '',
        durationMs: Date.now() - start,
        folders: folders.length,
        objects: objects.length,
        truncated: Boolean(nextToken)
      })
    }
    return { folders, objects, nextToken }
  } catch (err) {
    throw toFriendlyError(`List Objects in s3://${params.bucket}/${params.prefix ?? ''}`, err)
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
  if (process.env.VERBOSE_LOG === '1') {
    console.log('[s3:resolveRegion]', { profile: profile || null, resolved, fromCfg: !!fromCfg, fromCreds: !!fromCreds, env: !!envRegion })
  }
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
  if (process.env.VERBOSE_LOG === '1') {
    console.log('[s3:listProfiles]', { credsPath, configPath, count: out.length })
  }
  return out
}

export function setAwsFiles(params: { credentialsFile?: string; configFile?: string }) {
  overrideCredsPath = params.credentialsFile
  overrideConfigPath = params.configFile
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
