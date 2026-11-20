import type { AgentSession, ExtensionFactory, ToolInfo } from '@earendil-works/pi-coding-agent'
import type { ToolMode } from '../src/shared/types'

const codeTools = ['read', 'bash', 'edit', 'write']
const inspectionTools = ['read', 'grep', 'find', 'ls']

function isInspectionTool(tool: ToolInfo) {
  return inspectionTools.includes(tool.name) && tool.sourceInfo.path === 'builtin:' + tool.name
}

export class ToolModePolicy {
  private extensionTools = new Set<string>()

  constructor(public mode: ToolMode) {}

  apply(session: AgentSession, mode = this.mode) {
    const registered = session.getAllTools()
    const extensions = new Set(registered.filter((tool) => tool.sourceInfo.path !== 'builtin:' + tool.name).map((tool) => tool.name))
    if (this.mode === 'code') this.extensionTools.clear()
    for (const name of session.getActiveToolNames()) {
      if (extensions.has(name)) this.extensionTools.add(name)
    }
    this.extensionTools = new Set([...this.extensionTools].filter((name) => extensions.has(name)))
    const names = mode === 'read-only'
      ? inspectionTools.filter((name) => registered.some((tool) => tool.name === name && isInspectionTool(tool)))
      : [...new Set([...codeTools, ...this.extensionTools])]
    session.setActiveToolsByName(names)
    this.mode = mode
  }

  readonly extension: ExtensionFactory = (pi) => {
    pi.on('tool_call', ({ toolName }) => {
      if (this.mode === 'read-only' && !pi.getAllTools().some((tool) => tool.name === toolName && isInspectionTool(tool))) {
        return { block: true, reason: 'Read-only mode allows inspection tools only.' }
      }
    })
  }
}
