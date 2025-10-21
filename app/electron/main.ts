import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerIpc } from './ipc'
import { openSettingsDir } from './settings'
import { getLogger, initLogger } from './log'

let mainWindow: BrowserWindow | null = null
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow = win
}

async function setup() {
  const logger = initLogger()
  await logger.init()
  const isDev = process.env.NODE_ENV !== 'production'
  logger.info('init', 'app starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    logDir: logger.getDir(),
    logFile: logger.getCurrentPath(),
    level: logger.getLevel()
  })

  process.on('uncaughtException', (err) => {
    getLogger().error('error', 'uncaughtException', { message: err?.message, stack: err?.stack })
  })
  process.on('unhandledRejection', (reason: any) => {
    getLogger().error('error', 'unhandledRejection', { reason: String(reason) })
  })

  let verboseConsole = false
  const levels: Array<'TRACE'|'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'> = ['TRACE','DEBUG','INFO','WARN','ERROR','FATAL']
  // Configure About panel with stack/build/license info
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json')
    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(pkgRaw) as any
    const reactVer = pkg?.dependencies?.react ?? 'unknown'
    const viteVer = pkg?.devDependencies?.vite ?? 'unknown'
    const awsVer = pkg?.dependencies?.['@aws-sdk/client-s3'] ?? 'unknown'
    const website = pkg?.repository?.url?.replace(/^git\+/, '') ?? 'https://github.com/cornibe/s3lite-browser'

    app.setAboutPanelOptions({
      applicationName: 'S3Browser',
      applicationVersion: app.getVersion(),
      authors: [pkg?.author ?? ''],
      website,
      // iconPath is optional; .ico works on Windows
      iconPath: process.platform === 'win32' ? path.join(app.getAppPath(), 'icons', 'icon.ico') : undefined,
      credits: [
        'Lightweight S3 bucket/object browser',
        '',
        'Stack:',
        `- Electron: ${process.versions.electron}`,
        `- Chromium: ${process.versions.chrome}`,
        `- Node.js: ${process.versions.node}`,
        `- React: ${reactVer}`,
        `- Vite: ${viteVer}`,
        `- AWS SDK v3: ${awsVer}`,
        '',
        'Build:',
        `- Version: ${app.getVersion()}`,
        `- Mode: ${isDev ? 'development' : 'production'}`,
        '',
        'License: MIT (see LICENSE)'
      ].join('\n')
    })
  } catch (err) {
    getLogger().warn('about', 'failed to set about panel options', { message: (err as Error)?.message })
  }

  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    // File menu (Win/Linux): add Quit
    ...(process.platform !== 'darwin' ? [{
      label: 'File',
      submenu: [
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        {
          label: 'Settings',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('ui:openSettings')
            }
          }
        },
        {
          label: 'AWS Profiles',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('ui:openProfiles')
            }
          }
        },
        {
          label: 'Open Logs Folder',
          click: async () => { await getLogger().openLogsFolder() }
        },
        {
          label: 'Open Settings Folder',
          click: async () => { await openSettingsDir() }
        },
        {
          label: 'Logging',
          submenu: [
            {
              label: 'Level',
              submenu: levels.map(l => ({
                id: `level-${l}`,
                label: l,
                type: 'radio' as const,
                checked: getLogger().getLevel() === l,
                click: () => { getLogger().setLevel(l) }
              }))
            },
            { type: 'separator' as const },
            {
              label: 'Verbose Console (dev)',
              type: 'checkbox' as const,
              checked: verboseConsole,
              enabled: isDev,
              click: (item) => { verboseConsole = item.checked; getLogger().setConsoleLevel(item.checked ? 'TRACE' : getLogger().getLevel()) }
            }
          ]
        }
      ]
    },
    // Help menu (Win/Linux): About
    ...(process.platform !== 'darwin' ? [{
      label: 'Help',
      role: 'help' as const,
      submenu: [
        {
          label: 'About',
          click: () => { app.showAboutPanel() }
        }
      ]
    }] : [])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  registerIpc()
  await createWindow()

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', async () => {
    await getLogger().info('shutdown', 'app quitting')
    await getLogger().flushAndClose()
  })

  if (isDev) getLogger().debug('init', 'dev mode active')
}

app.whenReady().then(() => { void setup() })
