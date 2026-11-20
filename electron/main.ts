import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import appIcon from '../assets/pi-icon.png?asset'
import { readConfig, writeConfig } from './config'
import { channels } from '../src/shared/channels'
import type { ConfigFile, MenuAction, MessageDelivery, ThinkingLevel, ToolMode, Workspace } from '../src/shared/types'
import { PiService } from './pi-service'
import { describeWorkspace, gitDiff, gitStatus, workspaceFiles } from './workspace'

let window: BrowserWindow | null = null
const workspaces = new Map<string, Workspace>()
const pi = new PiService((event) => {
  const contents = window?.webContents
  if (contents && !contents.isDestroyed()) contents.send(channels.subscribe, event)
})
const initialDirectory = process.cwd()
const recentLimit = 12
let recentPaths: string[] | undefined

function readRecentPaths(): string[] {
  if (recentPaths) return recentPaths
  try {
    const paths: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'recent-workspaces.json'), 'utf8'))
    recentPaths = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string').slice(0, recentLimit) : []
  } catch {
    recentPaths = []
  }
  return recentPaths
}

function rememberWorkspace(path: string) {
  const paths = readRecentPaths()
  if (paths[0] === path) return
  recentPaths = [path, ...paths.filter((previous) => previous !== path)].slice(0, recentLimit)
  const file = join(app.getPath('userData'), 'recent-workspaces.json')
  try {
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(recentPaths), { mode: 0o600 })
    renameSync(temp, file)
  } catch (error) {
    console.warn('Could not save recent workspaces:', error)
  }
}

async function allowWorkspace(path: string) {
  const workspace = await describeWorkspace(path)
  workspaces.set(workspace.path, workspace)
  return workspace
}

function workspace(path: string) {
  const current = workspaces.get(path)
  if (!current) throw new Error('Open a workspace first.')
  return current
}

function handle<Args extends unknown[], Result>(
  channel: string,
  handler: (...args: Args) => Result,
) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: Args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame) {
      throw new Error('Unexpected IPC sender.')
    }
    return handler(...args)
  })
}

handle(channels.listWorkspaces, async () => {
  const sessions = await pi.listSessions()
  const candidates = [...new Set([...readRecentPaths(), ...sessions.map(({ workspace }) => workspace.path)].filter(Boolean))]
  const recent: Workspace[] = []
  for (const path of candidates) {
    const folder = await allowWorkspace(path).catch(() => null)
    if (folder && !recent.some((item) => item.path === folder.path)) recent.push(folder)
    if (recent.length >= recentLimit) break
  }
  return recent
})
handle(channels.chooseWorkspace, async () => {
  if (!window) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Open workspace',
    defaultPath: readRecentPaths()[0] ?? initialDirectory,
    properties: ['openDirectory'],
  })
  return canceled || !filePaths[0] ? null : allowWorkspace(filePaths[0])
})
handle(channels.createSession, async (path?: string) => {
  const folder = path ? workspace(path) : await allowWorkspace(initialDirectory)
  const snapshot = await pi.create(folder)
  rememberWorkspace(folder.path)
  return snapshot
})
handle(channels.openSession, async (id: string) => {
  await pi.listSessions()
  const path = pi.workspaceFor(id)
  const folder = await allowWorkspace(path || initialDirectory)
  const snapshot = await pi.open(id, folder)
  rememberWorkspace(folder.path)
  return snapshot
})
handle(channels.listSessions, () => pi.listSessions())
handle(channels.prompt, (id: string, text: string, delivery: MessageDelivery) => pi.prompt(id, text, delivery))
handle(channels.abort, (id: string) => pi.abort(id))
handle(channels.reloadSession, (id: string) => pi.reloadSession(id))
handle(channels.compactSession, (id: string, instructions: string) => pi.compactSession(id, instructions))
handle(channels.renameSession, (id: string, name: string) => pi.renameSession(id, name))
handle(channels.readConfig, (file: ConfigFile, path?: string) => readConfig(file, file === 'project' ? workspace(path ?? '').path : undefined))
handle(channels.writeConfig, (file: ConfigFile, text: string, version: string, path?: string) =>
  writeConfig(file, text, version, file === 'project' ? workspace(path ?? '').path : undefined))
handle(channels.revealConfigDirectory, async () => {
  const path = getAgentDir()
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
})
handle(channels.setToolMode, (id: string, mode: ToolMode) => pi.setToolMode(id, mode))
handle(channels.cycleThinkingLevel, (id: string) => pi.cycleThinkingLevel(id))
handle(channels.setModel, (id: string, provider: string, model: string) => pi.setModel(id, provider, model))
handle(channels.setThinkingLevel, (id: string, thinking: ThinkingLevel) => pi.setThinkingLevel(id, thinking))
handle(channels.listFiles, (path: string) => workspaceFiles(workspace(path).path))
handle(channels.gitStatus, (path: string) => gitStatus(workspace(path).path))
handle(channels.gitDiff, (cwd: string, path: string) => gitDiff(workspace(cwd).path, path))

function installApplicationMenu() {
  const command = (label: string, accelerator: string, action: MenuAction): MenuItemConstructorOptions => ({
    label, accelerator,
    click: (_item, activeWindow) => {
      const current = window
      const focused = activeWindow ?? BrowserWindow.getFocusedWindow() ?? current
      if (current && focused === current && !current.webContents.isDestroyed()) {
        current.webContents.send(channels.onMenuAction, action)
      }
    },
  })
  const menu = Menu.buildFromTemplate([
    { label: 'Pi', submenu: [
      { label: 'About Pi', role: 'about' },
      { type: 'separator' },
      command('Settings…', 'CommandOrControl+,', 'openSettings'),
      command('Reload Skills & Extensions', 'CommandOrControl+Shift+R', 'reload'),
      { type: 'separator' },
      { label: 'Hide Pi', role: 'hide' },
      { label: 'Quit Pi', role: 'quit' },
    ] },
    { label: 'File', submenu: [
      command('New Session', 'CommandOrControl+N', 'newSession'),
      command('Open Workspace…', 'CommandOrControl+O', 'openWorkspace'),
      { type: 'separator' },
      { label: 'Close Window', role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      command('Toggle Sidebar', 'CommandOrControl+B', 'toggleSidebar'),
      command('Toggle Changes', 'CommandOrControl+`', 'toggleChanges'),
      { type: 'separator' },
      { label: 'Toggle Full Screen', role: 'togglefullscreen' },
    ] },
    { label: 'Session', submenu: [
      command('Compact Context', 'CommandOrControl+Shift+K', 'compact'),
      command('Clear View', 'CommandOrControl+K', 'clearView'),
      command('Cycle Thinking Level', 'Shift+Tab', 'cycleThinking'),
      command('Stop Generation', 'Escape', 'stop'),
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ])
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  const current = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 740,
    minHeight: 490,
    title: 'Pi',
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#141415',
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window = current
  current.once('ready-to-show', () => current.show())
  current.on('closed', () => { window = null })
  current.webContents.on('before-input-event', (_event, input) => {
    // Let an open picker or dialog handle these keys before the session shortcuts.
    current.webContents.setIgnoreMenuShortcuts(
      input.key === 'Escape' || (input.key === 'Tab' && input.shift && !input.meta && !input.control && !input.alt),
    )
  })
  current.webContents.on('will-navigate', (event) => event.preventDefault())
  current.webContents.on('will-frame-navigate', (event) => event.preventDefault())
  current.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === current.webContents && permission === 'clipboard-sanitized-write')
  })
  current.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = new URL(url).protocol
    if (protocol === 'https:' || protocol === 'http:') {
      void shell.openExternal(url).catch((error: unknown) => console.error('Could not open link', error))
    }
    return { action: 'deny' }
  })
  current.webContents.on('preload-error', (_event, _path, error) => console.error('Preload error', error))
  current.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') console.error('Renderer exited', details)
  })

  const developmentUrl = process.env.NODE_ENV_ELECTRON_VITE === 'development'
    ? process.env.ELECTRON_RENDERER_URL
    : undefined
  const page = developmentUrl
    ? current.loadURL(developmentUrl)
    : current.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  void page.catch((error: unknown) => console.error('Could not load Pi', error))
}

app.setName('Pi')
process.title = 'Pi'
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  installApplicationMenu()
  app.dock?.setIcon(nativeImage.createFromPath(appIcon))
  createWindow()
  app.on('activate', () => { if (!window) createWindow() })
}).catch((error: unknown) => {
  console.error('Pi startup failed', error)
  app.exit(1)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => pi.dispose())
