import { app, BrowserWindow, Menu, shell, dialog, protocol } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipc-channels'
import { registerIpcHandlers, registerMenuIpc } from './ipc/handlers'
import { getLogFilePath, getLogsDirectory, logInfo } from './logger'
import { localProtocolFileCallback } from './localProtocol'

const LOCAL_SCHEMES = ['local-audio', 'local-video', 'local-media'] as const

protocol.registerSchemesAsPrivileged(
  LOCAL_SCHEMES.map((scheme) => ({
    scheme,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true
    }
  }))
)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    title: 'Silence Editor',
    icon: join(app.getAppPath(), 'resources', 'icon.svg'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Don't stay blank forever if ready-to-show never fires (cache / load glitches).
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 2500)

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logInfo('app', 'Renderer failed to load', { code, desc, url })
    if (isDev && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
      void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
    }
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logInfo('app', 'Renderer process gone', details as unknown as Record<string, unknown>)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send(IPC.MENU_OPEN)
        },
        {
          label: 'Export',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send(IPC.MENU_EXPORT)
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send(IPC.MENU_UNDO)
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send(IPC.MENU_REDO)
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: () => mainWindow?.webContents.send(IPC.SHOW_SHORTCUTS)
        },
        {
          label: 'About Silence Editor',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About',
              message: 'Silence Editor v1.0.0',
              detail: `Professional AI silence removal audio editor.\n\nLogs folder:\n${getLogsDirectory()}\n\nToday's log:\n${getLogFilePath()}`
            })
          }
        },
        {
          label: 'Open Log File',
          click: () => {
            shell.showItemInFolder(getLogFilePath())
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  logInfo('app', 'Silence Editor started', {
    logsDir: getLogsDirectory(),
    logFile: getLogFilePath()
  })

  protocol.registerFileProtocol('local-audio', (request, callback) => {
    localProtocolFileCallback(request.url, 'local-audio', callback)
  })

  protocol.registerFileProtocol('local-video', (request, callback) => {
    localProtocolFileCallback(request.url, 'local-video', callback)
  })

  protocol.registerFileProtocol('local-media', (request, callback) => {
    localProtocolFileCallback(request.url, 'local-media', callback)
  })

  registerIpcHandlers(() => mainWindow)
  registerMenuIpc(() => mainWindow)
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
