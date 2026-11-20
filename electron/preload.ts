import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { channels } from '../src/shared/channels'
import type { MenuAction, PiBridge, SessionEvent } from '../src/shared/types'

const bridge: PiBridge = {
  listWorkspaces: () => ipcRenderer.invoke(channels.listWorkspaces),
  chooseWorkspace: () => ipcRenderer.invoke(channels.chooseWorkspace),
  createSession: (workspace) => ipcRenderer.invoke(channels.createSession, workspace),
  openSession: (id) => ipcRenderer.invoke(channels.openSession, id),
  listSessions: () => ipcRenderer.invoke(channels.listSessions),
  prompt: (id, text, delivery) => ipcRenderer.invoke(channels.prompt, id, text, delivery),
  abort: (id) => ipcRenderer.invoke(channels.abort, id),
  reloadSession: (id) => ipcRenderer.invoke(channels.reloadSession, id),
  compactSession: (id, instructions) => ipcRenderer.invoke(channels.compactSession, id, instructions),
  renameSession: (id, name) => ipcRenderer.invoke(channels.renameSession, id, name),
  readConfig: (file, workspace) => ipcRenderer.invoke(channels.readConfig, file, workspace),
  writeConfig: (file, text, version, workspace) => ipcRenderer.invoke(channels.writeConfig, file, text, version, workspace),
  revealConfigDirectory: () => ipcRenderer.invoke(channels.revealConfigDirectory),
  setToolMode: (id, mode) => ipcRenderer.invoke(channels.setToolMode, id, mode),
  cycleThinkingLevel: (id) => ipcRenderer.invoke(channels.cycleThinkingLevel, id),
  setModel: (id, provider, model) => ipcRenderer.invoke(channels.setModel, id, provider, model),
  setThinkingLevel: (id, level) => ipcRenderer.invoke(channels.setThinkingLevel, id, level),
  listFiles: (workspace) => ipcRenderer.invoke(channels.listFiles, workspace),
  gitStatus: (workspace) => ipcRenderer.invoke(channels.gitStatus, workspace),
  gitDiff: (workspace, path) => ipcRenderer.invoke(channels.gitDiff, workspace, path),
  onMenuAction(listener) {
    const forward = (_event: IpcRendererEvent, action: MenuAction) => listener(action)
    ipcRenderer.on(channels.onMenuAction, forward)
    return () => ipcRenderer.removeListener(channels.onMenuAction, forward)
  },
  subscribe(listener) {
    const forward = (_event: IpcRendererEvent, event: SessionEvent) => listener(event)
    ipcRenderer.on(channels.subscribe, forward)
    return () => ipcRenderer.removeListener(channels.subscribe, forward)
  },
}

contextBridge.exposeInMainWorld('pi', bridge)
