import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import path from 'path'
import { registerIpc } from './ipc'
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
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
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
          label: 'Open Logs Folder',
          click: async () => { await getLogger().openLogsFolder() }
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
    }
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
