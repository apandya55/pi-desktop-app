import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRegistry, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { AgentSession, AgentSessionEvent, SessionInfo } from '@earendil-works/pi-coding-agent'
import { desktopCommands } from '../src/shared/commands'
import { ToolModePolicy } from './tool-mode'
import { applySessionEvent, updateTool } from '../src/shared/transcript'
import type { ChatPart, ChatTurn, CommandOption, MessageDelivery, ModelOption, SessionEvent, SessionEventPayload, SessionSnapshot, SessionSummary, ThinkingLevel, ToolCallItem, ToolMode, Workspace } from '../src/shared/types'

type PiMessage = AgentSession['messages'][number]

interface LiveSession {
  session: AgentSession
  registry: ModelRegistry
  policy: ToolModePolicy
  commandError?: string
  snapshot: SessionSnapshot
  assistantId?: string
  thinkingStarted: Map<number, number>
  thinkingDurations: Map<number, number>
  pendingTools: Map<string, string>
  aborted: boolean
  operation?: Promise<void>
  enqueue?: Promise<unknown>
  mutation?: Promise<SessionSnapshot>
}

const toolModeEntry = 'pi-desktop-mode'

// Legacy inspection and custom modes retain a conservative toolset when reopened.
function restoreToolMode(saved: unknown): ToolMode {
  return saved === undefined || saved === 'code' || saved === 'ask' || saved === 'auto' ? 'code' : 'read-only'
}
const limit = (text: string) => text.length > 80_000 ? text.slice(0, 80_000) + '\n… output truncated' : text
const stripXml = (text: string) => text.replace(/<[^>]*>/g, '').trim()

function textContent(content: string | readonly unknown[]): string {
  if (typeof content === 'string') return content
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    if ('type' in part && part.type === 'image') return ['[Image]']
    return 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : []
  }).join('\n')
}

function toolLabel(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return
  for (const key of ['path', 'file_path', 'command', 'pattern'] as const) {
    const value = (args as Record<string, unknown>)[key]
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 300)
  }
}

function toolResult(result: unknown): Pick<ToolCallItem, 'output' | 'diff'> {
  if (!result || typeof result !== 'object') return {}
  const { content, details } = result as { content?: unknown; details?: unknown }
  const diff = details && typeof details === 'object' && 'diff' in details ? details.diff : undefined
  return {
    output: Array.isArray(content) || typeof content === 'string' ? limit(textContent(content)) : undefined,
    diff: typeof diff === 'string' ? limit(diff) : undefined,
  }
}

function toTurn(message: PiMessage, id: string, durations?: Map<number, number>, historical = false): ChatTurn | null {
  if (message.role === 'user') {
    return { id, role: 'user', timestamp: message.timestamp, parts: [{ type: 'text', text: textContent(message.content) }] }
  }
  if (message.role === 'bashExecution') {
    return { id, role: 'assistant', timestamp: message.timestamp, parts: [{ type: 'tool', call: {
      id, name: 'bash', label: message.command, userInvoked: true,
      status: message.cancelled ? 'interrupted' : message.exitCode === 0 ? 'done' : 'error',
      output: limit([message.output, message.truncated && '… output truncated',
        message.exitCode !== undefined && message.exitCode !== 0 && 'Exit code ' + message.exitCode].filter(Boolean).join('\n')),
    } }] }
  }
  if (message.role !== 'assistant') return null
  const parts: ChatPart[] = message.content.flatMap((block, index): ChatPart[] => {
    switch (block.type) {
      case 'text': return [{ type: 'text', text: block.text }]
      case 'thinking': return [{ type: 'thinking', text: block.thinking, durationMs: durations?.get(index) }]
      case 'toolCall': return [{ type: 'tool', call: {
        id: block.id, name: block.name, label: toolLabel(block.arguments), status: historical ? 'interrupted' : 'pending',
      } }]
      default: return []
    }
  })
  return { id, role: 'assistant', timestamp: message.timestamp, parts, error: message.stopReason === 'error' ? message.errorMessage : undefined }
}

function history(session: AgentSession): ChatTurn[] {
  const turns: ChatTurn[] = []
  const toolTurns = new Map<string, ChatTurn>()
  for (const entry of session.sessionManager.getBranch()) {
    if (entry.type !== 'message') continue
    const { message } = entry
    const turn = toTurn(message, entry.id, undefined, true)
    if (turn) {
      turns.push(turn)
      for (const part of turn.parts) {
        if (part.type === 'tool') toolTurns.set(part.call.id, turn)
      }
    } else if (message.role === 'toolResult') {
      const owner = toolTurns.get(message.toolCallId)
      if (owner) owner.parts = updateTool(owner.parts, {
        id: message.toolCallId, name: message.toolName, status: message.isError ? 'error' : 'done', ...toolResult(message),
      })
    }
  }
  return turns
}

function summaryFromDisk(info: SessionInfo): SessionSummary {
  return {
    id: info.id,
    title: (info.name || info.firstMessage || 'New session').trim().slice(0, 100),
    workspace: { name: basename(info.cwd) || info.cwd || 'Workspace', path: info.cwd },
    updatedAt: info.modified.getTime(),
    running: false,
  }
}

function modelOption({ id, name, provider, reasoning }: ModelOption): ModelOption {
  return { id, name, provider, reasoning }
}

function getCommands(session: AgentSession, readOnly: boolean): CommandOption[] {
  const commands = new Map<string, CommandOption>(desktopCommands.map((command) => [
    command.name, { ...command, source: 'desktop' },
  ]))
  const include = (name: string, description: string | undefined, source: CommandOption['source']) => {
    if (!commands.has(name) && !session.extensionRunner.getCommand(name)) {
      commands.set(name, { name, description, source, takesArguments: true })
    }
  }
  if (!readOnly) {
    for (const command of session.extensionRunner.getRegisteredCommands()) {
      if (!commands.has(command.invocationName)) {
        commands.set(command.invocationName, { name: command.invocationName, description: command.description, source: 'extension', takesArguments: true })
      }
    }
  }
  for (const template of session.promptTemplates) include(template.name, template.description, 'prompt')
  if (session.settingsManager.getEnableSkillCommands()) {
    for (const skill of session.resourceLoader.getSkills().skills) include('skill:' + skill.name, skill.description, 'skill')
  }
  return [...commands.values()]
}

export class PiService {
  private readonly agentDir = getAgentDir()
  private readonly sessions = new Map<string, LiveSession>()
  private readonly opening = new Map<string, Promise<SessionSnapshot>>()
  private diskSessions = new Map<string, SessionInfo>()

  constructor(private readonly emit: (event: SessionEvent) => void) {}

  async listSessions(): Promise<SessionSummary[]> {
    const saved = await SessionManager.listAll()
    this.diskSessions = new Map(saved.map((info) => [info.id, info]))
    const summaries = new Map(saved.map((info) => [info.id, summaryFromDisk(info)]))
    for (const [id, { session, snapshot }] of this.sessions) {
      if (summaries.has(id) || snapshot.turns.length || snapshot.summary.running || session.sessionName) {
        summaries.set(id, snapshot.summary)
      }
    }
    return [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  workspaceFor(id: string): string | undefined {
    return this.sessions.get(id)?.snapshot.summary.workspace.path || this.diskSessions.get(id)?.cwd
  }

  async create(workspace: Workspace): Promise<SessionSnapshot> {
    return this.load(workspace)
  }

  async open(id: string, workspace: Workspace): Promise<SessionSnapshot> {
    const live = this.sessions.get(id)
    if (live) return live.snapshot
    const existing = this.opening.get(id)
    if (existing) return existing
    const info = this.diskSessions.get(id)
    if (!info) throw new Error('This session is no longer available.')
    const loading = this.load(workspace, info)
    this.opening.set(id, loading)
    try {
      return await loading
    } finally {
      this.opening.delete(id)
    }
  }

  private async load(workspace: Workspace, info?: SessionInfo): Promise<SessionSnapshot> {
    const cwd = workspace.path
    const agentDir = this.agentDir
    const sessionManager = info ? SessionManager.open(info.path, undefined, cwd) : undefined
    const saved = sessionManager?.getBranch().findLast((entry) => entry.type === 'custom' && entry.customType === toolModeEntry)
    const toolMode = restoreToolMode(saved?.type === 'custom' ? saved.data : undefined)
    const policy = new ToolModePolicy(toolMode)
    let live: LiveSession | undefined
    const settingsManager = SettingsManager.create(cwd, agentDir)
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [policy.extension] })
    await resourceLoader.reload()
    const { session } = await createAgentSession({ cwd, agentDir, sessionManager, settingsManager, resourceLoader })
    try {
      policy.apply(session)
      await session.bindExtensions({
        onError: ({ extensionPath, event, error }) => {
          console.error('Pi extension error', extensionPath, error)
          if (live?.operation && (event === 'command' || event === 'user_bash')) live.commandError = error
        },
      })
      policy.apply(session)
    } catch (error) {
      session.dispose()
      throw error
    }

    const summary = info ? { ...summaryFromDisk(info), workspace } : {
      id: session.sessionId, title: 'New session', workspace, updatedAt: Date.now(), running: false,
    }
    const loaded: LiveSession = {
      session, policy, registry: new ModelRegistry(session.modelRuntime),
      snapshot: {
        summary, turns: history(session), models: [], model: null, thinking: session.thinkingLevel,
        toolMode, streaming: false, queued: { steering: 0, followUp: 0 }, commands: [], thinkingLevels: [], revision: 0,
      },
      thinkingStarted: new Map(), thinkingDurations: new Map(), pendingTools: new Map(), aborted: false,
    }
    live = loaded
    this.updateOptions(loaded)
    this.sessions.set(summary.id, loaded)
    session.subscribe((event) => this.onEvent(loaded, event))
    return loaded.snapshot
  }

  private get(id: string): LiveSession {
    const live = this.sessions.get(id)
    if (!live) throw new Error('Open the session first.')
    return live
  }

  private updateOptions(live: LiveSession) {
    const { session } = live
    live.snapshot = {
      ...live.snapshot,
      models: live.registry.getAvailable().map(modelOption),
      model: session.model ? modelOption(session.model) : null,
      thinking: session.thinkingLevel,
      thinkingLevels: session.model ? session.getAvailableThinkingLevels() : [],
      toolMode: live.policy.mode,
      commands: getCommands(session, live.policy.mode === 'read-only'),
    }
  }

  private send(live: LiveSession, payload: SessionEventPayload) {
    const event: SessionEvent = { id: live.snapshot.summary.id, revision: live.snapshot.revision + 1, ...payload }
    live.snapshot = applySessionEvent(live.snapshot, event)
    this.emit(event)
  }

  private onEvent(live: LiveSession, event: AgentSessionEvent) {
    switch (event.type) {
      case 'agent_start':
        this.send(live, { type: 'streaming_changed', streaming: true, running: true })
        break
      case 'queue_update':
        this.send(live, { type: 'queue_changed', queued: { steering: event.steering.length, followUp: event.followUp.length } })
        break
      case 'message_start':
        if (event.message.role === 'assistant') {
          live.assistantId = randomUUID()
          live.thinkingStarted.clear()
          live.thinkingDurations.clear()
        }
        break
      case 'message_update': {
        const update = event.assistantMessageEvent
        if (!live.assistantId) break
        if (update.type === 'thinking_start') live.thinkingStarted.set(update.contentIndex, performance.now())
        if (update.type === 'thinking_end') {
          const start = live.thinkingStarted.get(update.contentIndex)
          if (start !== undefined) live.thinkingDurations.set(update.contentIndex, performance.now() - start)
        }
        if (update.type === 'thinking_delta' || update.type === 'text_delta') {
          this.send(live, {
            type: event.type, turnId: live.assistantId, timestamp: event.message.timestamp,
            index: update.contentIndex, kind: update.type === 'thinking_delta' ? 'thinking' : 'text', delta: update.delta,
          })
        }
        break
      }
      case 'message_end': {
        const assistant = event.message.role === 'assistant'
        if (assistant) {
          for (const [index, start] of live.thinkingStarted) {
            if (!live.thinkingDurations.has(index)) live.thinkingDurations.set(index, performance.now() - start)
          }
        }
        const turn = toTurn(event.message, (assistant && live.assistantId) || randomUUID(), assistant ? live.thinkingDurations : undefined)
        if (turn) {
          this.send(live, { type: event.type, turn })
          for (const part of turn.parts) {
            if (part.type === 'tool') live.pendingTools.set(part.call.id, turn.id)
          }
        }
        break
      }
      case 'tool_execution_start': {
        const turnId = live.pendingTools.get(event.toolCallId) ?? live.assistantId
        if (!turnId) break
        live.pendingTools.set(event.toolCallId, turnId)
        this.send(live, { type: event.type, turnId, call: {
          id: event.toolCallId, name: event.toolName, status: 'running', label: toolLabel(event.args),
        } })
        break
      }
      case 'tool_execution_end': {
        const turnId = live.pendingTools.get(event.toolCallId)
        if (!turnId) break
        live.pendingTools.delete(event.toolCallId)
        this.send(live, { type: event.type, turnId, call: {
          id: event.toolCallId, name: event.toolName, status: event.isError ? 'error' : 'done', ...toolResult(event.result),
        } })
        break
      }
      case 'agent_settled':
        live.aborted = event.aborted
        this.send(live, { type: 'streaming_changed', streaming: false, running: Boolean(live.operation) })
        break
    }
  }

  async prompt(id: string, text: string, delivery: MessageDelivery) {
    const live = this.get(id)
    if (!text.trim()) return
    if (delivery !== 'steer' && delivery !== 'followUp') throw new Error('Unknown message delivery mode.')
    const { session, policy } = live
    const shell = /^(!{1,2})([\s\S]*)$/.exec(text)
    if (policy.mode === 'read-only') {
      if (shell) throw new Error('Read-only mode allows inspection tools only.')
      const command = /^\/(\S+)/.exec(text)?.[1]
      if (command && session.extensionRunner.getCommand(command)) {
        throw new Error('Extension commands are available in Code mode.')
      }
    }
    if (session.isStreaming && !live.aborted) {
      if (shell) throw new Error('Wait for generation to finish before running a shell command.')
      if (live.enqueue) throw new Error('The previous message is still being queued.')
      const enqueue = delivery === 'followUp' ? session.followUp(text) : session.steer(text)
      live.enqueue = enqueue
      try {
        await enqueue
      } finally {
        live.enqueue = undefined
      }
      return
    }
    return this.run(live, async () => {
      if (shell) {
        const command = shell[2].trim()
        if (!command) throw new Error('Enter a shell command after ! or !!.')
        await this.runShell(live, command, shell[1] === '!!')
      } else {
        await session.prompt(text)
        await session.waitForIdle()
        if (live.commandError) throw new Error(live.commandError)
      }
    })
  }

  private async runShell(live: LiveSession, command: string, excludeFromContext: boolean) {
    const { session } = live
    const intercept = await session.extensionRunner.emitUserBash({
      type: 'user_bash', command, excludeFromContext, cwd: session.sessionManager.getCwd(),
    })
    if (live.aborted) return
    if (intercept?.result) session.recordBashResult(command, intercept.result, { excludeFromContext })
    else await session.executeBash(command, undefined, { excludeFromContext, operations: intercept?.operations })
    const entry = session.sessionManager.getBranch().at(-1)
    if (entry?.type === 'message' && entry.message.role === 'bashExecution') {
      const turn = toTurn(entry.message, entry.id)
      if (turn) this.send(live, { type: 'message_end', turn })
    }
  }

  private async run(live: LiveSession, action: () => Promise<unknown>) {
    if (live.operation || live.mutation || !live.session.isIdle) throw new Error('This session is busy.')
    live.aborted = false
    live.commandError = undefined
    this.send(live, { type: 'run_start' })
    const operation = Promise.resolve().then(async () => {
      if (!live.aborted) await action()
    })
    live.operation = operation
    let error: string | undefined
    try {
      await operation
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      await live.enqueue?.catch(() => {})
      const pending = live.session.pendingMessageCount ? live.session.clearQueue() : undefined
      live.operation = undefined
      live.assistantId = undefined
      live.pendingTools.clear()
      this.updateOptions(live)
      const { snapshot } = live
      const firstUser = snapshot.turns.find((turn) => turn.role === 'user')?.parts[0]
      const userText = firstUser?.type === 'text' ? stripXml(firstUser.text).slice(0, 100) : undefined
      const title = live.session.sessionName || userText || snapshot.summary.title
      const turns = snapshot.turns.map((turn) => ({
        ...turn,
        parts: turn.parts.map((part) => {
          if (part.type === 'tool' && (part.call.status === 'pending' || part.call.status === 'running')) {
            return { ...part, call: { ...part.call, status: 'interrupted' as const } }
          }
          return part.type !== 'tool' && part.streaming ? { ...part, streaming: false } : part
        }),
      }))
      this.send(live, {
        type: 'agent_settled',
        aborted: live.aborted,
        unsubmitted: pending ? [...pending.steering, ...pending.followUp] : [],
        snapshot: {
          ...snapshot, streaming: false, turns, error, revision: snapshot.revision + 1,
          summary: { ...snapshot.summary, title, running: false, updatedAt: Date.now() },
        },
      })
    }
  }

  async abort(id: string) {
    const live = this.get(id)
    if (live.operation || live.session.isStreaming) {
      live.aborted = true
      live.session.abortBash()
      const stopped = live.session.abort()
      await stopped
    }
  }

  setToolMode(id: string, mode: ToolMode) {
    if (mode !== 'code' && mode !== 'read-only') throw new Error('Unknown tool mode.')
    const live = this.get(id)
    return this.mutate(id, (session) => {
      if (mode === live.policy.mode) return
      session.sessionManager.appendCustomEntry(toolModeEntry, mode)
      live.policy.apply(session, mode)
    })
  }

  cycleThinkingLevel(id: string) {
    return this.mutate(id, (session) => { session.cycleThinkingLevel() })
  }

  async setModel(id: string, provider: string, model: string) {
    return this.mutate(id, async (session) => {
      const selection = this.get(id).registry.find(provider, model)
      if (!selection) throw new Error('This model is no longer available.')
      const hadThinking = Boolean(session.model && session.getAvailableThinkingLevels().some((level) => level !== 'off'))
      await session.setModel(selection)
      const settings = session.settingsManager
      if (!hadThinking && settings.getModelThinkingLevel(provider, model) === undefined &&
          settings.getDefaultThinkingLevel() === undefined && session.getAvailableThinkingLevels().some((level) => level !== 'off')) {
        session.setThinkingLevel('medium')
      }
    })
  }

  async setThinkingLevel(id: string, level: ThinkingLevel) {
    return this.mutate(id, (session) => {
      if (!session.model || !session.getAvailableThinkingLevels().includes(level)) {
        throw new Error('This thinking level is unavailable for the current model.')
      }
      session.setThinkingLevel(level)
    })
  }

  renameSession(id: string, name: string) {
    if (!name.trim()) throw new Error('Enter a session name.')
    const live = this.get(id)
    return this.mutate(id, (session) => {
      session.setSessionName(name.trim().slice(0, 100))
      live.snapshot = { ...live.snapshot, summary: { ...live.snapshot.summary, title: session.sessionName! } }
    })
  }

  compactSession(id: string, instructions: string) {
    const live = this.get(id)
    return this.run(live, () => live.session.compact(instructions.trim() || undefined))
  }

  reloadSession(id: string) {
    const live = this.get(id)
    return this.mutate(id, async (session) => {
      const currentModel = session.model
      const thinking = session.thinkingLevel
      try {
        await session.reload()
      } finally {
        live.policy.apply(session)
      }
      const settingsError = session.settingsManager.drainErrors()[0]
      if (settingsError) throw new Error(`Could not reload ${settingsError.path ?? settingsError.scope}: ${settingsError.error.message}`)
      await live.registry.refresh({ allowNetwork: false })
      const registryError = live.registry.getError()
      if (registryError) throw new Error(registryError)
      const available = live.registry.getAvailable()
      const refreshed = currentModel && available.find(({ provider, id }) => provider === currentModel.provider && id === currentModel.id)
      if (refreshed) {
        if (refreshed !== session.model) {
          await session.setModel(refreshed)
          session.setThinkingLevel(thinking)
        }
      } else {
        const settings = session.settingsManager
        const defaultModel = available.find(({ provider, id }) => provider === settings.getDefaultProvider() && id === settings.getDefaultModel())
        const fallback = defaultModel ?? available[0]
        if (fallback) await session.setModel(fallback)
        else if (currentModel) {
          // The SDK represents a session without an available model as undefined.
          const state: { model: AgentSession['model'] } = session.agent.state
          state.model = undefined
          session.setThinkingLevel('off')
        }
      }
    })
  }

  private async mutate(id: string, change: (session: AgentSession) => void | Promise<void>) {
    const live = this.get(id)
    if (live.operation || live.mutation || !live.session.isIdle) throw new Error('This session is busy.')
    const mutation = Promise.resolve().then(async () => {
      try {
        await change(live.session)
      } finally {
        this.updateOptions(live)
        const { snapshot } = live
        this.send(live, { type: 'session_updated', snapshot: { ...snapshot, revision: snapshot.revision + 1 } })
      }
      return live.snapshot
    })
    live.mutation = mutation
    try {
      return await mutation
    } finally {
      live.mutation = undefined
    }
  }

  dispose() {
    for (const live of this.sessions.values()) {
      live.session.dispose()
    }
    this.sessions.clear()
  }
}
