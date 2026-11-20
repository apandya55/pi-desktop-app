import { Command } from 'cmdk'
import { ArrowUp, Code, Eye, File, Plus, Square } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { thinkingNames } from '../shared/commands'
import type { CommandOption, MessageDelivery, SessionSnapshot, ThinkingLevel, ToolMode } from '../shared/types'
import { Picker } from './Picker'
import type { Option } from './Picker'
import './composer.css'

export type Menu = 'tool-mode' | 'model' | 'thinking'
const toolModeOptions = [
  { id: 'code', label: 'Code', detail: 'Read, edit and run commands', icon: <Code size={14} /> },
  { id: 'read-only', label: 'Read-only', detail: 'Inspect and search the project', icon: <Eye size={14} /> },
] satisfies (Option & { id: ToolMode })[]
const sourceNames: Record<CommandOption['source'], string> = { desktop: 'Pi', extension: 'Extension', prompt: 'Prompt', skill: 'Skill' }
const modelKey = (provider: string, id: string) => JSON.stringify([provider, id])

function fuzzyFiles(files: string[], query: string) {
  const needle = query.toLowerCase()
  return files.flatMap((path) => {
    const lower = path.toLowerCase()
    const filename = lower.split('/').at(-1) ?? lower
    const match = lower.indexOf(needle)
    if (match !== -1) return [{ path, score: filename.startsWith(needle) ? match / 100 : 10 + match }]
    let cursor = 0
    for (const char of needle) {
      const index = lower.indexOf(char, cursor)
      if (index === -1) return []
      cursor = index + 1
    }
    return [{ path, score: 50 + cursor }]
  }).sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, 8).map(({ path }) => path)
}

interface Props {
  input: RefObject<HTMLTextAreaElement | null>
  draft: string
  session?: SessionSnapshot
  disabled: boolean
  running: boolean
  stopping: boolean
  menu: Menu | null
  onConfigureModels: () => void
  onToolMode: (mode: ToolMode) => void
  onDraft: (text: string) => void
  onSend: (text?: string, delivery?: MessageDelivery) => void
  onStop: () => void
  onMenu: (menu: Menu) => void
  onCloseMenu: (menu?: Menu) => void
  onModel: (provider: string, model: string) => void
  onThinking: (level: ThinkingLevel) => void
  onError: (error: unknown) => void
}

export function Composer({ input, draft, session, disabled, running, stopping, menu, onConfigureModels, onToolMode,
  onDraft, onSend, onStop, onMenu, onCloseMenu, onModel, onThinking, onError }: Props) {
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState('')
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const suggestionsList = useRef<HTMLDivElement>(null)
  const suggestionButtons = useRef<HTMLDivElement>(null)
  const fileCache = useRef(new Map<string, Promise<string[]>>())
  const [files, setFiles] = useState<{ key: string; items: string[] }>()
  const [fileError, setFileError] = useState('')
  const before = draft.slice(0, cursor)
  const slash = draft === before ? /^\/([\w:.-]*)$/.exec(before) : null
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before)
  const workspace = session?.summary.workspace.path
  const streaming = Boolean(session?.streaming)
  const toolMode = session?.toolMode ?? 'code'
  const allowCommands = !running || streaming
  const fileKey = workspace ? JSON.stringify([workspace, session?.summary.updatedAt]) : ''
  const canSuggest = focused && !composing && !menu && !disabled && dismissed !== before
  const showFiles = Boolean(canSuggest && mention && workspace)
  const showCommands = Boolean(canSuggest && slash && allowCommands)
  const showSuggestions = showFiles || showCommands
  const suggestionLabel = showFiles ? 'Workspace files' : 'Commands'
  const query = slash?.[1].toLowerCase() ?? ''
  const commandOptions = showCommands
    ? (session?.commands ?? []).filter(({ name, source }) => name.toLowerCase().includes(query) && (!running || source === 'skill' || source === 'prompt'))
      .sort((a, b) => Number(b.name.toLowerCase() === query) - Number(a.name.toLowerCase() === query)) : []
  const fileOptions = showFiles && files?.key === fileKey ? fuzzyFiles(files.items, mention?.[1] ?? '') : []
  const options = commandOptions.length || fileOptions.length
  const selectedIndex = Math.min(selected, Math.max(0, options - 1))
  const selectedValue = options ? String(selectedIndex) : ''
  const candidate = session?.model
  const model = candidate?.provider === 'unknown' && candidate.id === 'unknown' ? null : candidate
  const models = session?.models ?? []
  const thinking = session?.thinking
  const thinkingLevels = model ? session?.thinkingLevels ?? [] : []
  const queued = session?.queued

  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = Math.min(element.scrollHeight, 175) + 'px'
  }, [draft, input])

  useEffect(() => {
    if (!showFiles || !workspace) return
    let current = true
    setFileError('')
    let request = fileCache.current.get(fileKey)
    if (!request) {
      request = window.pi.listFiles(workspace)
      fileCache.current.clear()
      fileCache.current.set(fileKey, request)
    }
    void request.then((items) => {
      if (current) setFiles({ key: fileKey, items })
    }).catch((error: unknown) => {
      if (fileCache.current.get(fileKey) === request) fileCache.current.delete(fileKey)
      if (current) {
        setFileError('Could not list workspace files.')
        onError(error)
      }
    })
    return () => { current = false }
  }, [showFiles, workspace, fileKey, onError])

  function attachSuggestionsList(list: HTMLDivElement | null) {
    const element = input.current
    suggestionsList.current = list
    const active = list?.querySelector<HTMLElement>('[cmdk-item][data-value="' + selectedValue + '"]')
    if (list) element?.setAttribute('aria-controls', list.id)
    else element?.removeAttribute('aria-controls')
    if (active) element?.setAttribute('aria-activedescendant', active.id)
    else element?.removeAttribute('aria-activedescendant')
  }

  function select(index: number, complete = false) {
    const command = commandOptions[index]
    if (command) {
      const invocation = '/' + command.name
      if (complete || command.takesArguments && draft !== invocation) {
        const value = invocation + ' '
        onDraft(value)
        setCursor(value.length)
        requestAnimationFrame(() => {
          input.current?.setSelectionRange(value.length, value.length)
        })
      } else {
        onSend(invocation)
      }
    } else {
      const path = fileOptions[index]
      if (!path || !mention) return
      const reference = `@${/[\s"\\]/.test(path) ? JSON.stringify(path) : path}`
      const start = cursor - mention[1].length - 1
      const end = cursor + (draft.slice(cursor).match(/^[^\s@]*/)?.[0].length ?? 0)
      const next = draft.slice(0, start) + reference + ' ' + draft.slice(end)
      const caret = start + reference.length + 1
      onDraft(next)
      setCursor(caret)
      requestAnimationFrame(() => {
        input.current?.setSelectionRange(caret, caret)
      })
    }
  }

  function mentionFile() {
    onCloseMenu()
    const position = input.current?.selectionStart ?? draft.length
    const left = draft.slice(0, position)
    const value = left + (left && !/\s$/.test(left) ? ' ' : '') + '@'
    onDraft(value + draft.slice(input.current?.selectionEnd ?? position))
    setCursor(value.length)
    setSelected(0)
    setDismissed('')
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(value.length, value.length)
    })
  }

  function browseCommands() {
    onCloseMenu()
    if (showCommands) {
      setDismissed(before)
      input.current?.focus()
      return
    }
    onDraft(slash ? draft : '/')
    setSelected(0)
    setDismissed('')
    const caret = slash ? draft.length : 1
    setCursor(caret)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(caret, caret)
    })
  }

  return (
    <Popover.Root open={showSuggestions} onOpenChange={(open) => { if (!open) setDismissed(before) }}>
      <Popover.Anchor asChild>
        <div className="composer-area mx-auto w-full">
          <div className="composer">
            <textarea ref={input} rows={1} placeholder={streaming ? 'Enter to steer · ⌥/⌘ Enter to queue' : 'Message Pi…'} aria-label="Message Pi"
              aria-autocomplete="list"
              value={draft} disabled={disabled}
              onChange={(event) => {
                onDraft(event.currentTarget.value)
                setCursor(event.currentTarget.selectionStart)
                setSelected(0)
                setDismissed('')
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
              onKeyDown={(event) => {
                if (composing || event.nativeEvent.isComposing) return
                if (event.key === 'Escape' && showSuggestions) {
                  event.preventDefault()
                  setDismissed(before)
                  return
                }
                if (options && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  const next = (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + options) % options
                  setSelected(next)
                  suggestionsList.current?.querySelector('[cmdk-item][data-value="' + next + '"]')?.scrollIntoView({ block: 'nearest' })
                }
                const followUp = event.altKey || event.metaKey
                if (options && (event.key === 'Tab' && !event.shiftKey || event.key === 'Enter' && !event.shiftKey && !followUp)) {
                  event.preventDefault()
                  select(selectedIndex, event.key === 'Tab')
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (!running || streaming) onSend(undefined, followUp ? 'followUp' : 'steer')
                }
              }}
            />
          </div>
          <div className="composer-toolbar">
            <div className="composer-context" ref={suggestionButtons}>
              <button className="ghost-button ghost-icon" type="button" aria-label="Mention a file" title="Mention a file (@)" aria-expanded={showFiles}
                disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={mentionFile}><Plus size={15} /></button>
              <button className="ghost-button ghost-icon commands-trigger" type="button" aria-label="Browse commands" title="Browse commands (/)"
                aria-expanded={showCommands} disabled={disabled || !allowCommands || Boolean(draft.trim() && !slash)} onMouseDown={(event) => event.preventDefault()} onClick={browseCommands}>
                <span aria-hidden="true">/</span>
              </button>
            </div>
            <div className="composer-options">
              <Picker label={toolMode === 'code' ? 'Code' : 'Read-only'} title="Tool mode" triggerId="tool-mode-trigger"
                options={toolModeOptions} value={toolMode} open={menu === 'tool-mode'}
                triggerClassName="composer-mode-trigger"
                disabled={disabled || running} onToggle={() => onMenu('tool-mode')} onClose={() => onCloseMenu('tool-mode')}
                onSelect={(mode) => onToolMode(mode as ToolMode)} />
              <Picker label={model?.id ?? (models.length ? 'Choose model' : 'Set up model')} title="Model" variant="model"
                triggerClassName="composer-model-trigger"
                options={models.map((option) => ({
                  id: modelKey(option.provider, option.id), label: option.id, tooltip: option.name,
                  detail: option.reasoning ? option.provider + ' · Reasoning' : option.provider,
                }))}
                value={model ? modelKey(model.provider, model.id) : undefined} searchLabel="Search models"
                emptyText="No configured models." open={menu === 'model'}
                action={{ label: 'Configure models…', run: onConfigureModels }}
                disabled={disabled || running} onToggle={() => onMenu('model')} onClose={() => onCloseMenu('model')}
                onSelect={(id) => {
                  const [provider, modelId] = JSON.parse(id) as [string, string]
                  onModel(provider, modelId)
                }} />
              <Picker label={model && thinking ? thinkingNames[thinking] : 'Thinking'} title="Thinking" variant="thinking"
                options={thinkingLevels.map((level) => ({ id: level, label: thinkingNames[level] }))}
                emptyText={model ? 'This model offers no adjustable reasoning levels.' : 'Choose a model to see its thinking levels.'}
                value={thinking} open={menu === 'thinking'} disabled={disabled || running}
                onToggle={() => onMenu('thinking')} onClose={() => onCloseMenu('thinking')} onSelect={(id) => onThinking(id as ThinkingLevel)} />
              <button className="send-button" type="button" disabled={disabled || stopping || !running && !draft.trim()} data-running={running}
                aria-label={stopping ? 'Stopping response' : running ? 'Stop response' : 'Send message'}
                title={stopping ? 'Stopping response…' : running ? 'Stop response (Esc)' : 'Send message (Enter)'}
                onClick={running ? onStop : () => onSend()}>
                {running ? <Square size={12} fill="currentColor" /> : <ArrowUp size={15} strokeWidth={2.3} />}
              </button>
            </div>
          </div>
          {queued && (queued.steering > 0 || queued.followUp > 0) && <div className="composer-queue" role="status">
            {[queued.steering > 0 && queued.steering + ' steering', queued.followUp > 0 && queued.followUp + ' follow-up'].filter(Boolean).join(' · ')}
          </div>}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="menu-surface composer-suggestions"
          aria-label={suggestionLabel}
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            setDismissed(before)
          }}
          onInteractOutside={(event) => {
            const target = event.target
            if (target === input.current || target instanceof Node && suggestionButtons.current?.contains(target)) {
              event.preventDefault()
            }
          }}
        >
          <Command label={suggestionLabel} shouldFilter={false} value={selectedValue}
            onValueChange={(value) => { if (value !== '') setSelected(Number(value)) }}>
            <div className="menu-heading" aria-hidden="true">{suggestionLabel}</div>
            <Command.List ref={attachSuggestionsList} label={suggestionLabel} className="menu-list">
              {commandOptions.map((command, index) => (
                <Command.Item key={command.name} value={String(index)} className="menu-row"
                  onMouseDown={(event) => event.preventDefault()} onSelect={() => select(index)}>
                  <span className="menu-row-label"><strong>/{command.name}</strong>{command.description && <small>{command.description}</small>}</span>
                  <span className="menu-row-detail">{sourceNames[command.source]}</span>
                </Command.Item>
              ))}
              {fileOptions.map((path, index) => (
                <Command.Item key={path} value={String(index)} className="menu-row"
                  onMouseDown={(event) => event.preventDefault()} onSelect={() => select(index)} title={path}>
                  <File size={14} aria-hidden="true" />
                  <span className="menu-row-label">
                    <strong>{path.split('/').at(-1)}</strong>
                    {path.includes('/') && <small>{path.slice(0, path.lastIndexOf('/'))}</small>}
                  </span>
                </Command.Item>
              ))}
              {!options && <p className="menu-empty" role="status">{showCommands ? 'No matching commands.'
                : fileError || (files?.key === fileKey ? 'No matching files.' : 'Finding files…')}</p>}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
