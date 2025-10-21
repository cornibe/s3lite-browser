import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'

export type AppSettings = {
  overwritePolicy: 'skip' | 'overwrite' | 'rename' | 'prompt'
  bandwidthLimitKBps?: number
  requesterPays?: boolean
  objectConcurrency?: number
  partConcurrency?: number
  partSizeMiB?: number
  multipartThresholdMiB?: number
  darkMode?: boolean
  compactMode?: boolean
  mounts?: Array<{ bucket: string; prefix?: string }>
  bottomPanelTab?: 'properties' | 'transfers' | 'log' | 'preview'
  sidebarWidthPx?: number
  queueHeightPx?: number
  folderScanAutoPages?: number
  sidebarProfileCollapsed?: boolean
}

function getSettingsPath() {
  const dir = app.getPath('userData')
  return path.join(dir, 'settings.json')
}

export async function loadSettingsFile(): Promise<AppSettings | undefined> {
  const file = getSettingsPath()
  try {
    const raw = await fs.promises.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as AppSettings
  } catch {
    // ignore missing/invalid
  }
  return undefined
}

export async function saveSettingsFile(settings: AppSettings): Promise<void> {
  const file = getSettingsPath()
  const dir = path.dirname(file)
  await fs.promises.mkdir(dir, { recursive: true })
  const json = JSON.stringify(settings, null, 2)
  await fs.promises.writeFile(file, json, 'utf-8')
}

export function getSettingsDir(): string { return path.dirname(getSettingsPath()) }
export async function openSettingsDir(): Promise<void> { await fs.promises.mkdir(getSettingsDir(), { recursive: true }); await shell.openPath(getSettingsDir()) }
