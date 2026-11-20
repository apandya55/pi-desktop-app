export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ToolMode = 'code' | 'read-only'
export type MessageDelivery = 'steer' | 'followUp'
export type MenuAction =
  | 'reload' | 'newSession' | 'openWorkspace' | 'toggleSidebar' | 'toggleChanges'
  | 'compact' | 'clearView' | 'cycleThinking' | 'stop' | 'openSettings'

export type ConfigFile = 'global' | 'project' | 'models'

export interface ConfigDocument {
  path: string
  text: string
  version: string
}

export interface CommandOption {
  name: string
  description?: string
  source: 'desktop' | 'extension' | 'prompt' | 'skill'
  takesArguments?: boolean
}

export interface Workspace {
  path: string
  name: string
}

export interface SessionSummary {
  id: string
  title: string
  workspace: Workspace
  updatedAt: number
  running: boolean
}

export interface ToolCallItem {
  id: string
  name: string
  label?: string
  userInvoked?: boolean
  status: 'pending' | 'running' | 'done' | 'error' | 'interrupted'
  output?: string
  diff?: string
}

export type ChatPart =
  | { type: 'text' | 'thinking'; text: string; durationMs?: number; streaming?: boolean }
  | { type: 'tool'; call: ToolCallItem }

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  timestamp: number
  parts: ChatPart[]
  error?: string
}

export interface ModelOption {
  id: string
  name: string
  provider: string
  reasoning: boolean
}

export interface GitChange {
  path: string
  status: string
  previousPath?: string
}

export interface GitStatus {
  branch: string | null
  changes: GitChange[]
}

export interface GitDiff {
  text: string
  truncated: boolean
}

export interface SessionSnapshot {
  summary: SessionSummary
  turns: ChatTurn[]
  models: ModelOption[]
  model: ModelOption | null
  thinking: ThinkingLevel
  thinkingLevels: ThinkingLevel[]
  commands: CommandOption[]
  toolMode: ToolMode
  streaming: boolean
  queued: { steering: number; followUp: number }
  revision: number
  error?: string
}

export type SessionEventPayload =
  | { type: 'run_start' }
  | { type: 'session_updated'; snapshot: SessionSnapshot }
  | { type: 'streaming_changed'; streaming: boolean; running: boolean }
  | { type: 'queue_changed'; queued: SessionSnapshot['queued'] }
  | { type: 'message_update'; turnId: string; timestamp: number; index: number; kind: 'text' | 'thinking'; delta: string }
  | { type: 'message_end'; turn: ChatTurn }
  | { type: 'tool_execution_start' | 'tool_execution_end'; turnId: string; call: ToolCallItem }
  | { type: 'agent_settled'; snapshot: SessionSnapshot; aborted: boolean; unsubmitted: string[] }

export type SessionEvent = { id: string; revision: number } & SessionEventPayload

export interface PiBridge {
  listWorkspaces(): Promise<Workspace[]>
  chooseWorkspace(): Promise<Workspace | null>
  createSession(workspace?: string): Promise<SessionSnapshot>
  openSession(id: string): Promise<SessionSnapshot>
  listSessions(): Promise<SessionSummary[]>
  prompt(id: string, text: string, delivery: MessageDelivery): Promise<void>
  abort(id: string): Promise<void>
  reloadSession(id: string): Promise<SessionSnapshot>
  compactSession(id: string, instructions: string): Promise<void>
  renameSession(id: string, name: string): Promise<SessionSnapshot>
  readConfig(file: ConfigFile, workspace?: string): Promise<ConfigDocument>
  writeConfig(file: ConfigFile, text: string, version: string, workspace?: string): Promise<ConfigDocument>
  revealConfigDirectory(): Promise<void>
  setToolMode(id: string, mode: ToolMode): Promise<SessionSnapshot>
  cycleThinkingLevel(id: string): Promise<SessionSnapshot>
  setModel(id: string, provider: string, model: string): Promise<SessionSnapshot>
  setThinkingLevel(id: string, level: ThinkingLevel): Promise<SessionSnapshot>
  listFiles(workspace: string): Promise<string[]>
  gitStatus(workspace: string): Promise<GitStatus>
  gitDiff(workspace: string, path: string): Promise<GitDiff>
  onMenuAction(listener: (action: MenuAction) => void): () => void
  subscribe(listener: (event: SessionEvent) => void): () => void
}
