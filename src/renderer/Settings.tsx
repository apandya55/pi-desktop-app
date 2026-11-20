import { FileJson, FolderOpen, Globe, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ConfigDocument, ConfigFile, Workspace } from '../shared/types'
import './panels.css'

const sections = [
  { id: 'global', label: 'Global', icon: Globe, title: 'Global settings', details: 'Set the default provider, model, and thinking level for new sessions.' },
  { id: 'project', label: 'Workspace', icon: FolderOpen, title: 'Workspace settings', details: 'Override global settings for this workspace in its .pi folder.' },
  { id: 'models', label: 'Models', icon: FileJson, title: 'Custom providers and models', details: 'Configure custom providers, endpoints, and models.' },
] as const

interface Draft {
  document: ConfigDocument
  text: string
}

interface Props {
  workspace?: Workspace
  initialSection: ConfigFile
  canReload: boolean
  formatError: (cause: unknown) => string
  onClose: () => void
  onReload: () => Promise<void>
}

export function Settings({ workspace, initialSection, canReload, formatError, onClose, onReload }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const keepEditingButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [active, setActive] = useState<ConfigFile>(initialSection)
  const [drafts, setDrafts] = useState<Partial<Record<ConfigFile, Draft>>>({})
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const section = sections.find(({ id }) => id === active)!
  const draft = drafts[active]
  const workspacePath = workspace?.path
  const dirty = Boolean(draft && draft.text !== draft.document.text)
  const anyDirty = Object.values(drafts).some((entry) => entry && entry.text !== entry.document.text)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    if (confirmClose) keepEditingButton.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current.focus()
      returnFocus.current = null
    }
  }, [confirmClose])

  useEffect(() => {
    if (draft) return
    let cancelled = false
    void window.pi.readConfig(active, workspacePath).then((document) => {
      if (!cancelled) setDrafts((previous) => ({ ...previous, [active]: { document, text: document.text } }))
    }).catch((cause: unknown) => {
      if (!cancelled) setLoadError(formatError(cause))
    })
    return () => { cancelled = true }
  }, [active, workspacePath, draft, formatError, loadAttempt])

  function close() {
    if (saving) return
    if (confirmClose) setConfirmClose(false)
    else if (anyDirty) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : closeButton.current
      setConfirmClose(true)
    } else onClose()
  }

  async function save() {
    if (!draft || !dirty || saving || confirmClose) return
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const document = await window.pi.writeConfig(active, draft.text, draft.document.version, workspacePath)
      setDrafts((previous) => ({ ...previous, [active]: { document, text: document.text } }))
      setStatus(canReload ? 'Settings saved. Reload the session to apply them.' : 'Settings saved.')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function reload() {
    setSaving(true)
    setError('')
    setStatus('')
    try {
      await onReload()
      setStatus('Session configuration reloaded.')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function revert() {
    setError('')
    setStatus('')
    if (!draft) {
      setLoadError('')
      setLoadAttempt((attempt) => attempt + 1)
      return
    }
    setSaving(true)
    try {
      const document = await window.pi.readConfig(active, workspacePath)
      setDrafts((previous) => ({ ...previous, [active]: { document, text: document.text } }))
      setStatus('Edits reverted.')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); close() }}
      onKeyDown={(event) => {
        if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }}>
      <header className="settings-header">
        <h2 id="settings-title">Settings</h2>
        <button ref={closeButton} className="icon-button" type="button" aria-label="Close settings" disabled={saving || confirmClose} onClick={close}><X size={18} /></button>
      </header>
      <nav className="settings-tabs" aria-label="Configuration files" inert={confirmClose}>
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
            disabled={saving || id === 'project' && !workspace}
            title={id === 'project' && !workspace ? 'Open a workspace to edit its settings' : undefined}
            onClick={() => {
              setActive(id)
              setLoadError('')
              setError('')
              setStatus('')
              setLoadAttempt((attempt) => attempt + 1)
            }}>
            <Icon size={15} aria-hidden="true" />{label}
            {drafts[id] && drafts[id].text !== drafts[id].document.text && <span className="settings-unsaved" role="img" aria-label="Unsaved changes" />}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        <div className="settings-description">
          <h3>{section.title}</h3>
          <p>{section.details}</p>
        </div>
        <div className="settings-editor" inert={confirmClose}>
          {draft && <div className="settings-editor-header">
            <FileJson size={14} aria-hidden="true" />
            <span className="settings-path" title={draft.document.path}>{draft.document.path}</span>
            {dirty && <span className="settings-editor-status">Unsaved changes</span>}
          </div>}
          {draft ? (
            <textarea className="config-editor" aria-label={section.title + ' JSON'} spellCheck={false}
              autoCapitalize="off" autoCorrect="off" wrap="off" readOnly={saving} value={draft.text}
              onChange={(event) => {
                const text = event.target.value
                setDrafts((previous) => ({ ...previous, [active]: { ...draft, text } }))
                setError('')
                setStatus('')
              }} />
          ) : <p className="settings-loading" role="status">{loadError ? 'Unable to open this file.' : 'Loading configuration…'}</p>}
        </div>
        {confirmClose ? (
          <div className="settings-confirm">
            <span id="settings-confirm-message" role="alert">Discard unsaved changes?</span>
            <button className="pill" type="button" onClick={onClose}>Discard changes</button>
            <button ref={keepEditingButton} className="pill" type="button" aria-describedby="settings-confirm-message" onClick={() => setConfirmClose(false)}>Keep editing</button>
          </div>
        ) : (error || loadError || status) && <p className="settings-feedback" role={error || loadError ? 'alert' : 'status'} data-error={Boolean(error || loadError)}>{error || loadError || status}</p>}
      </div>
      <footer className="settings-footer" inert={confirmClose}>
        <button className="pill" type="button" disabled={saving} onClick={() => { void window.pi.revealConfigDirectory().catch((cause: unknown) => setError(formatError(cause))) }}>
          <FolderOpen size={14} aria-hidden="true" /> Open global config folder
        </button>
        <button className="pill" type="button" disabled={!canReload || saving || anyDirty} onClick={() => { void reload() }}>
          <RotateCw size={13} aria-hidden="true" /> Reload session
        </button>
        <div className="settings-save">
          <button className="pill" type="button" disabled={saving || !(draft ? dirty : loadError)}
            onClick={() => { void revert() }}>{draft || !loadError ? 'Revert edits' : 'Retry'}</button>
          <button className="settings-save-button" type="button" disabled={!dirty || saving} onClick={() => { void save() }}>Save changes</button>
        </div>
      </footer>
    </dialog>
  )
}
