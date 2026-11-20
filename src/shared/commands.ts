export const desktopCommands = [
  { name: 'new', description: 'Start a new session' },
  { name: 'model', description: 'Choose a model' },
  { name: 'thinking', description: 'Set reasoning effort' },
  { name: 'mode', description: 'Choose Code or Read-only tools' },
  { name: 'settings', description: 'Edit Pi configuration' },
  { name: 'reload', description: 'Reload configuration and extensions' },
  { name: 'compact', description: 'Summarize older messages', takesArguments: true },
  { name: 'name', description: 'Rename this session', takesArguments: true },
  { name: 'copy', description: 'Copy the last assistant response' },
  { name: 'help', description: 'Browse commands' },
] as const

export const thinkingNames = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
} as const
