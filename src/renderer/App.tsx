import { Check, ChevronRight, CircleAlert, Files, Folder, FolderOpen, GitBranch, Loader2, PanelLeft, Plus, Settings as SettingsIcon, X } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { thinkingNames } from '../shared/commands'
import type { ConfigFile, GitStatus, MenuAction, MessageDelivery, SessionSnapshot, SessionSummary, ThinkingLevel, Workspace } from '../shared/types'
import { applySessionEvent } from '../shared/transcript'
import { Changes } from './Changes'
import { Composer } from './Composer'
import type { Menu } from './Composer'
import { Conversation } from './Conversation'
import { Picker } from './Picker'
import { Settings } from './Settings'

const xmlTags = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z_](?:[^<>"']|"[^"]*"|'[^']*')*(?:>|$)/g
const skillName = /^\s*<skill\s+name=(?:"([^"]+)"|'([^']+)')/

function displayTitle(title: string, firstUserText?: string) {
  const skill = skillName.exec(title) ??
    (firstUserText && title === firstUserText.replace(/<[^>]*>/g, '').trim().slice(0, 100) ? skillName.exec(firstUserText) : null)
  return (skill ? skill[1] ?? skill[2] : title)
    .replace(xmlTags, '').replace(/<\/?[A-Za-z_][^<>]*$/, '').replace(/\s+/g, ' ').trim() || 'New session'
}

const emptyGit: GitStatus = { branch: null, changes: [] }
const errorMessage = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
const displayPath = (path: string) => path.replace(/^\/Users\/(?!Shared(?:\/|$)|\.)[^/]+(?=\/|$)/, '~')

function groupByWorkspace(sessions: SessionSummary[]) {
  const groups = new Map<string, { label: string; sessions: SessionSummary[] }>()
  for (const session of sessions) {
    const { path, name } = session.workspace
    const group = groups.get(path)
    if (group) group.sessions.push(session)
    else groups.set(path, { label: name, sessions: [session] })
  }
  return groups
}

export function App() {
  const [recent, setRecent] = useState<Workspace[]>([])
  const [sidebar, setSidebar] = useState(true)
  const [changesOpen, setChangesOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<ConfigFile>()
  const [menu, setMenu] = useState<Menu | 'project' | null>(null)
  const [id, setId] = useState<string>()
  const [stored, setStored] = useState<SessionSummary[]>([])
  const [sessions, setSessions] = useState<Record<string, SessionSnapshot>>({})
  const [clearedThrough, setClearedThrough] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [stopping, setStopping] = useState<string>()
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [git, setGit] = useState<{ path: string; status: GitStatus; revision: number }>()
  const input = useRef<HTMLTextAreaElement>(null)
  const openingLock = useRef(false)
  const updatingLock = useRef(false)
  const gitRequest = useRef(0)
  const sendingLock = useRef(new Set<string>())
  const queueingLock = useRef(new Set<string>())
  const session = id ? sessions[id] : undefined
  const workspace = session?.summary.workspace
  const draft = id ? drafts[id] ?? '' : ''
  const running = Boolean(session?.summary.running || id && sending.has(id))
  const cleared = id && clearedThrough[id]
  const turns = session?.turns ?? []
  const visibleTurns = cleared ? turns.slice(turns.findIndex((turn) => turn.id === cleared) + 1) : turns
  const empty = !visibleTurns.length && !running
  const gitStatus = git?.path === workspace?.path ? git?.status ?? emptyGit : emptyGit

  const report = useCallback((cause: unknown) => setError(errorMessage(cause)), [])
  const save = useCallback((snapshot: SessionSnapshot) => {
    setSessions((previous) => {
      const id = snapshot.summary.id
      if ((previous[id]?.revision ?? -1) > snapshot.revision) return previous
      return { ...previous, [id]: snapshot }
    })
  }, [])
  const open = useCallback(async (getSession: () => Promise<SessionSnapshot | null>) => {
    if (openingLock.current) return
    openingLock.current = true
    setOpening(true)
    setMenu(null)
    setError('')
    setNotice('')
    try {
      const result = await getSession()
      if (!result) return
      save(result)
      setId(result.summary.id)
    } catch (cause) {
      report(cause)
    } finally {
      setOpening(false)
      openingLock.current = false
    }
  }, [report, save])

  useEffect(() => {
    const unsubscribe = window.pi.subscribe((event) => {
      if (event.type === 'agent_settled' && event.unsubmitted.length) {
        setDrafts((previous) => ({
          ...previous, [event.id]: [...event.unsubmitted, previous[event.id]].filter(Boolean).join('\n\n'),
        }))
      }
      setSessions((previous) => {
        const current = previous[event.id]
        if (event.type === 'agent_settled') {
          if ((current?.revision ?? -1) > event.revision) return previous
          return { ...previous, [event.id]: event.snapshot }
        }
        if (!current) return previous
        return { ...previous, [event.id]: applySessionEvent(current, event) }
      })
    })
    void open(() => window.pi.createSession())
    void window.pi.listSessions().then(setStored).catch(report)
    return unsubscribe
  }, [open, report])

  const refreshGit = useCallback(async () => {
    const request = ++gitRequest.current
    if (!workspace?.path) return
    try {
      const status = await window.pi.gitStatus(workspace.path)
      if (request === gitRequest.current) setGit({ path: workspace.path, status, revision: request })
    } catch (cause) {
      if (request === gitRequest.current) report(cause)
    }
  }, [workspace?.path, report])

  useEffect(() => {
    void refreshGit()
    const focus = () => { void refreshGit() }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [refreshGit, session?.summary.updatedAt, changesOpen])

  const focusComposer = () => requestAnimationFrame(() => input.current?.focus())
  const showSettings = useCallback(() => {
    setMenu(null)
    setSettingsSection('global')
  }, [])
  const configureModels = () => {
    setMenu(null)
    setSettingsSection('models')
  }
  const newSession = useCallback(() => {
    void open(() => window.pi.createSession(workspace?.path))
  }, [open, workspace?.path])
  const switchProject = (path?: string) => {
    setMenu(null)
    void open(async () => {
      const selected = path ?? (await window.pi.chooseWorkspace())?.path
      return selected && selected !== workspace?.path ? window.pi.createSession(selected) : null
    })
  }
  const stop = useCallback(() => {
    if (!id || !running || stopping === id) return
    setStopping(id)
    setMenu(null)
    void window.pi.abort(id).catch(report).finally(() => setStopping((current) => current === id ? undefined : current))
  }, [id, report, running, stopping])

  function setDraft(text: string) {
    if (id) setDrafts((previous) => ({ ...previous, [id]: text }))
  }
  const insertPrompt = (prefix: string) => {
    setDraft(prefix)
    focusComposer()
  }
  function send(value = draft, delivery: MessageDelivery = 'steer') {
    if (!id || !value.trim() || opening || updatingLock.current || stopping === id) return
    const busy = running || sendingLock.current.has(id)
    if (busy && (!session?.streaming || queueingLock.current.has(id))) return
    const text = value.trim()
    setError('')
    setNotice('')
    setMenu(null)
    const slash = /^\/([\w:.-]+)(?:\s([\s\S]*))?$/.exec(text)
    const invocation = slash?.[1].toLowerCase() === 'clear' ? 'new' : slash?.[1]
    const commands = session?.commands ?? []
    const command = commands.find(({ name }) => name === invocation) ??
      commands.find(({ name, source }) => source === 'desktop' && name === invocation?.toLowerCase())
    if (slash && !command) {
      report('Unknown command /' + slash[1] + '. Type / to browse available commands.')
      return
    }
    if (text === '/') {
      focusComposer()
      return
    }
    if (busy && (command?.source === 'desktop' || command?.source === 'extension' || text.startsWith('!'))) {
      report('Wait for the current response to finish before running this command.')
      return
    }
    if (command?.source === 'desktop') {
      if (command.name === 'compact') compact(slash?.[2] ?? '', text)
      else runCommand(command.name, slash?.[2]?.trim() ?? '')
      return
    }
    const prompt = slash && command ? '/' + command.name + (slash[2] ? ' ' + slash[2] : '') : text
    setDraft('')
    if (busy) {
      queueingLock.current.add(id)
      void window.pi.prompt(id, prompt, delivery).catch((cause: unknown) => {
        report(cause)
        restoreDraft(id, text)
      }).finally(() => { queueingLock.current.delete(id) })
    } else {
      startRun(id, () => window.pi.prompt(id, prompt, delivery), text)
    }
  }

  function restoreDraft(id: string, text: string) {
    setDrafts((previous) => ({ ...previous, [id]: [text, previous[id]].filter(Boolean).join('\n\n') }))
  }

  function startRun(id: string, action: () => Promise<void>, restore?: string) {
    sendingLock.current.add(id)
    setSending(new Set(sendingLock.current))
    void action().catch((cause: unknown) => {
      report(cause)
      if (restore) restoreDraft(id, restore)
    }).finally(() => {
      sendingLock.current.delete(id)
      setSending(new Set(sendingLock.current))
    })
  }

  function compact(instructions = '', command?: string) {
    if (!id || running || opening || updatingLock.current || sendingLock.current.has(id)) return
    if (command) setDraft('')
    setError('')
    setMenu(null)
    setNotice('')
    startRun(id, () => window.pi.compactSession(id, instructions).then(() => setNotice('Session context compacted.')),
      command)
  }

  const closeMenu = useCallback((value?: Menu | 'project') => {
    setMenu((current) => !value || current === value ? null : current)
  }, [])
  function openMenu(value: Menu | 'project') {
    if (value === 'project') void window.pi.listWorkspaces().then(setRecent).catch(report)
    setMenu(value)
  }

  function runCommand(command: string, args: string) {
    setDraft('')
    switch (command) {
      case 'new': newSession(); break
      case 'mode':
        if (args === 'code' || args === 'read-only') changeOptions((id) => window.pi.setToolMode(id, args))
        else if (args) report('Use /mode code or /mode read-only.')
        else setMenu('tool-mode')
        break
      case 'model':
      case 'thinking': {
        if (!args) {
          setMenu(command)
          break
        }
        if (command === 'thinking') {
          const level = (Object.keys(thinkingNames) as ThinkingLevel[]).find((level) =>
            level === args.toLowerCase() || thinkingNames[level].toLowerCase() === args.toLowerCase() || level === 'xhigh' && args.toLowerCase() === 'x high')
          if (level) changeOptions((id) => window.pi.setThinkingLevel(id, level))
          else report('Unknown thinking level. Use /thinking to see the available options.')
        } else {
          const models = session?.models ?? []
          const exact = models.find(({ id, provider }) => provider + '/' + id === args)
          const matches = models.filter(({ id }) => id === args)
          const model = exact ?? (matches.length === 1 ? matches[0] : undefined)
          if (model) changeOptions((id) => window.pi.setModel(id, model.provider, model.id))
          else report('Use /model to choose a model, or enter its exact provider/model ID.')
        }
        break
      }
      case 'settings': showSettings(); break
      case 'reload': changeOptions(window.pi.reloadSession, 'Session configuration reloaded.'); break
      case 'name':
        if (args) changeOptions((id) => window.pi.renameSession(id, args))
        else {
          setDraft('/name ')
          focusComposer()
        }
        break
      case 'copy': {
        const response = session?.turns.findLast((turn) => turn.role === 'assistant' && turn.parts.some(({ type }) => type === 'text'))
        const text = response?.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n')
        if (!text) report('No assistant response to copy.')
        else void navigator.clipboard.writeText(text).then(() => setNotice('Response copied to clipboard.')).catch(report)
        break
      }
      case 'help':
        setDraft('/')
        focusComposer()
        break
    }
  }

  async function updateSession(update: (id: string) => Promise<SessionSnapshot>) {
    if (!id || running || opening || updatingLock.current || sendingLock.current.has(id)) throw new Error('Wait for the current response to finish.')
    updatingLock.current = true
    setUpdating(true)
    try {
      save(await update(id))
    } finally {
      setUpdating(false)
      updatingLock.current = false
    }
  }

  function changeOptions(update: (id: string) => Promise<SessionSnapshot>, message = '') {
    setMenu(null)
    setError('')
    setNotice('')
    void updateSession(update).then(() => setNotice(message)).catch(report).finally(() => {
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active === document.body || active?.closest('.composer-area')) input.current?.focus()
      })
    })
  }

  const handleMenuAction = useEffectEvent((action: MenuAction) => {
    if (settingsSection) return
    switch (action) {
      case 'reload': if (!running) changeOptions(window.pi.reloadSession, 'Skills and extensions reloaded.'); break
      case 'newSession': newSession(); break
      case 'openWorkspace': switchProject(); break
      case 'openSettings': showSettings(); break
      case 'toggleSidebar': setSidebar((value) => !value); break
      case 'toggleChanges': setChangesOpen((value) => !value); break
      case 'compact': compact(); break
      case 'clearView': {
        const lastTurn = turns.at(-1)
        if (id && lastTurn) setClearedThrough((previous) => ({ ...previous, [id]: lastTurn.id }))
        setMenu(null)
        focusComposer()
        break
      }
      case 'cycleThinking':
        if (!running && session?.thinkingLevels.some((level) => level !== 'off')) changeOptions(window.pi.cycleThinkingLevel)
        break
      case 'stop': stop(); break
    }
  })
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat || settingsSection) return
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === ',') {
      event.preventDefault()
      showSettings()
    } else if (event.key === 'Escape' && running) {
      event.preventDefault()
      handleMenuAction('stop')
    } else if (event.key === 'Tab' && event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey &&
        (event.target === input.current || event.target === document.body) &&
        !menu && !running && session?.thinkingLevels.some((level) => level !== 'off')) {
      event.preventDefault()
      handleMenuAction('cycleThinking')
    }
  })
  useEffect(() => {
    const unsubscribe = window.pi.onMenuAction((action) => handleMenuAction(action))
    const shortcut = (event: KeyboardEvent) => handleShortcut(event)
    window.addEventListener('keydown', shortcut)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', shortcut)
    }
  }, [])

  const allSessions = new Map(stored.map((item) => [item.id, { ...item, title: displayTitle(item.title) }]))
  for (const live of Object.values(sessions)) {
    const { summary } = live
    if (live.turns.length || summary.running || drafts[summary.id] || summary.title !== 'New session' || allSessions.has(summary.id)) {
      const firstUserPart = live.turns.find((turn) => turn.role === 'user')?.parts[0]
      const title = displayTitle(summary.title, firstUserPart?.type === 'text' ? firstUserPart.text : undefined)
      allSessions.set(summary.id, { ...summary, title })
    }
  }
  const sessionGroups = groupByWorkspace([...allSessions.values()].sort((a, b) => b.updatedAt - a.updatedAt))
  const visibleError = error || session?.error

  return (
    <div className="app-shell">
      <header className="titlebar" data-sidebar={sidebar}>
        <span className="traffic-space" aria-hidden="true" />
        <button className="icon-button sidebar-toggle" aria-label="Toggle sidebar" aria-expanded={sidebar} aria-controls={sidebar ? 'sessions-sidebar' : undefined} title="Toggle sidebar (⌘B)"
          onClick={() => setSidebar((value) => !value)}><PanelLeft size={16} /></button>
        {sidebar && <span className="sidebar-titlebar-space" aria-hidden="true" />}
        <div className="titlebar-workspace">
          <Picker title="Working folder" label={workspace?.name ?? 'Folder'} icon={<Folder size={14} aria-hidden="true" />}
            open={menu === 'project'} disabled={opening} value={workspace?.path}
            align="left" side="bottom" variant="folder" searchLabel="Search folders" heading="Recent folders" emptyText="No recent folders."
            options={recent.map(({ path, name }) => ({
              id: path, label: name, detail: displayPath(path), tooltip: path, icon: <Folder size={14} aria-hidden="true" />,
            }))}
            action={{ label: 'Open folder…', icon: <FolderOpen size={14} aria-hidden="true" />, run: () => switchProject() }}
            onToggle={() => openMenu('project')} onClose={() => closeMenu('project')} onSelect={switchProject} />
        </div>
        {gitStatus.branch && <ChevronRight className="titlebar-separator" size={12} aria-hidden="true" />}
        {gitStatus.branch && <div className="branch-badge" title={gitStatus.branch}><GitBranch size={13} /><span>{gitStatus.branch}</span></div>}
        <div className="titlebar-actions">
          <button className="ghost-button ghost-icon" aria-label="Open settings" title="Settings (⌘,)" onClick={showSettings}><SettingsIcon size={16} /></button>
          <button className="ghost-button changes-toggle" aria-pressed={changesOpen} title="Workspace changes"
            onClick={() => setChangesOpen((value) => !value)}>
            <Files size={14} /><span>Changes</span>{gitStatus.changes.length > 0 && <span className="changes-count">{gitStatus.changes.length}</span>}
          </button>
        </div>
      </header>
      <div className="app-body">
        {sidebar && <aside className="sidebar" id="sessions-sidebar" aria-label="Sessions">
          <div className="sidebar-top">
            <button className="new-session" onClick={newSession} disabled={opening} title="New session (⌘N)">
              <Plus size={15} /><span>New session</span><kbd aria-hidden="true">⌘N</kbd>
            </button>
          </div>
          <div className="history-label">Recents</div>
          <nav className="session-list" aria-label="Recent sessions">
            {[...sessionGroups].map(([path, group]) => (
              <section key={path}>
                <h2 title={path}>{group.label}</h2>
                <ul>
                  {group.sessions.map((item) => (
                    <li key={item.id}>
                      <button aria-current={item.id === id ? 'page' : undefined} disabled={opening}
                        title={`${item.title} · ${item.workspace.name}`}
                        onClick={() => {
                          if (item.id !== id) void open(() => window.pi.openSession(item.id))
                        }}>
                        <span>{item.title}</span>
                        {item.running && <Loader2 size={12} className="animate-spin session-spinner" role="img" aria-label="Running" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {!allSessions.size && !opening && <p className="session-empty">No saved sessions.</p>}
          </nav>
          <div className="sidebar-footer">
            <button className="open-workspace" onClick={() => switchProject()} disabled={opening}>
              <FolderOpen size={15} aria-hidden="true" /><span>Open folder</span>
            </button>
          </div>
        </aside>}
        <main className="main-pane" data-empty={empty}>
          <Conversation sessionId={id} turns={visibleTurns} running={running} />
          <div className="composer-wrap">
            {empty && (
              <div className="empty-hero">
                <div className="empty-logo" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 4 4" shapeRendering="crispEdges">
                    <rect x="0" y="0" width="3" height="1" fill="#e48a7a" />
                    <rect x="2" y="1" width="1" height="1" fill="#e48a7a" />
                    <rect x="0" y="1" width="1" height="3" fill="#4f8eb3" />
                    <rect x="1" y="2" width="1" height="1" fill="#4f8eb3" />
                    <rect x="3" y="2" width="1" height="2" fill="#eab65d" />
                  </svg>
                </div>
                <div className="empty-heading">
                  <h1 className="empty-title">{workspace?.name ?? 'Pi'}</h1>
                  {workspace && <p className="empty-subtitle" title={workspace.path}>{displayPath(workspace.path)}</p>}
                </div>
                <div className="empty-hints">
                  <button type="button" className="empty-hint-chip" onClick={() => insertPrompt('@')} title="Mention files in your workspace">
                    <kbd>@</kbd><span>Mention file</span>
                  </button>
                  <button type="button" className="empty-hint-chip" onClick={() => insertPrompt('/')} title="Browse commands, prompts, and skills">
                    <kbd>/</kbd><span>Commands & skills</span>
                  </button>
                  <button type="button" className="empty-hint-chip" onClick={() => insertPrompt('!')} title="Run shell command in workspace">
                    <kbd>!</kbd><span>Shell command</span>
                  </button>
                  <button type="button" className="empty-hint-chip" onClick={() => setSidebar((value) => !value)} title="Toggle session history (⌘B)">
                    <kbd>⌘B</kbd><span>History</span>
                  </button>
                  <button type="button" className="empty-hint-chip" onClick={showSettings} title="Open settings (⌘,)">
                    <kbd>⌘,</kbd><span>Settings</span>
                  </button>
                </div>
              </div>
            )}
            {visibleError && <div className="app-error" role="alert">
              <CircleAlert size={16} /><span>{visibleError}</span>
              {error && <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button>}
            </div>}
            {!visibleError && notice && <div className="app-notice" role="status">
              <Check size={15} /><span>{notice}</span>
              <button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button>
            </div>}
            <Composer key={id} input={input} draft={draft} session={session} disabled={opening || updating || !session}
              running={running} stopping={id !== undefined && stopping === id} menu={menu === 'project' ? null : menu}
              onConfigureModels={configureModels}
              onToolMode={(mode) => changeOptions((id) => window.pi.setToolMode(id, mode))}
              onDraft={setDraft} onSend={send} onStop={stop} onMenu={openMenu}
              onCloseMenu={closeMenu} onModel={(provider, model) => changeOptions((id) => window.pi.setModel(id, provider, model))}
              onThinking={(level: ThinkingLevel) => changeOptions((id) => window.pi.setThinkingLevel(id, level))} onError={report} />
          </div>
        </main>
        {changesOpen && <Changes key={workspace?.path} workspace={workspace?.path} status={gitStatus} revision={git?.revision ?? 0}
          onClose={() => setChangesOpen(false)} onRefresh={() => { void refreshGit() }} />}
      </div>
      {settingsSection && <Settings workspace={workspace} initialSection={settingsSection} canReload={Boolean(id) && !running && !opening && !updating}
        formatError={errorMessage} onClose={() => setSettingsSection(undefined)}
        onReload={() => updateSession(window.pi.reloadSession)} />}
    </div>
  )
}
