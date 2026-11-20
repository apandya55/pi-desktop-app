import { Check, ChevronRight, File, Files, FolderOpen, RefreshCw, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GitDiff, GitStatus } from '../shared/types'
import { DiffLines } from './Conversation'
import './panels.css'

interface Props {
  workspace?: string
  status: GitStatus
  revision: number
  onClose: () => void
  onRefresh: () => void
}

interface DiffResult {
  path: string
  diff?: GitDiff
  error?: string
}

const statusNames: Record<string, string> = {
  '?': 'Untracked', M: 'Modified', A: 'Added', D: 'Deleted',
  R: 'Renamed', C: 'Copied', U: 'Unmerged', T: 'Type changed',
}
const conflictStatuses = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export function Changes({ workspace, status, revision, onClose, onRefresh }: Props) {
  const panel = useRef<HTMLElement>(null)
  const [path, setPath] = useState<string>()
  const [result, setResult] = useState<DiffResult>()
  const selected = status.changes.find((change) => change.path === path) ?? status.changes[0]
  const selectedPath = selected?.path
  const current = result?.path === selectedPath ? result : undefined
  const count = status.changes.length

  useLayoutEffect(() => {
    const element = panel.current
    const previous = document.activeElement
    element?.focus()
    return () => {
      if (element?.contains(document.activeElement) && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (!workspace || !selectedPath) return
    let active = true
    void window.pi.gitDiff(workspace, selectedPath).then((diff) => {
      if (active) setResult({ path: selectedPath, diff })
    }).catch((cause: unknown) => {
      if (active) setResult({ path: selectedPath, error: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { active = false }
  }, [workspace, selectedPath, revision])

  const EmptyIcon = workspace && status.branch ? Check : FolderOpen

  return (
    <aside ref={panel} className="changes-drawer" aria-labelledby="changes-title" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}>
      <header className="changes-header">
        <Files size={16} aria-hidden="true" />
        <h2 id="changes-title">Changes</h2>
        {count > 0 && <span className="changes-total" role="img" aria-label={count + (count === 1 ? ' changed file' : ' changed files')}>{count}</span>}
        <div className="changes-actions">
          <button type="button" className="icon-button" disabled={!workspace} onClick={onRefresh} title="Refresh changes" aria-label="Refresh changes"><RefreshCw size={14} aria-hidden="true" /></button>
          <button type="button" className="icon-button" onClick={onClose} title="Close changes" aria-label="Close changes"><X size={16} aria-hidden="true" /></button>
        </div>
      </header>
      {selected ? <>
        <ul className="changes-files" aria-label="Changed files">
          {status.changes.map((change) => {
            const kind = conflictStatuses.has(change.status) ? 'U' : change.status.trim()[0]
            const name = statusNames[kind] ?? 'Changed'
            const separator = change.path.lastIndexOf('/')
            const directory = change.path.slice(0, separator + 1)
            const basename = change.path.slice(separator + 1)
            return (
              <li key={change.path}>
                <button type="button" aria-pressed={selectedPath === change.path} onClick={() => setPath(change.path)} title={change.path}
                  aria-label={change.path + ', ' + name}>
                  <File size={14} aria-hidden="true" />
                  <span className="changes-file-label">
                    <span className="changes-filename">{basename}</span>
                    {directory && <span className="changes-directory">{directory}</span>}
                  </span>
                  <span className="change-status" data-status={kind} title={name} aria-hidden="true">{kind}</span>
                  <ChevronRight className="changes-chevron" size={13} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
        <section className="changes-diff" aria-labelledby="changes-diff-title">
          <div className="changes-diff-header">
            <h3 id="changes-diff-title" title={selected.path}>{selected.path}</h3>
            {selected.previousPath && <p title={selected.previousPath}>From {selected.previousPath}</p>}
          </div>
          {current?.error ? <p className="changes-message" role="alert">{current.error}</p> : !current?.diff ? <p className="changes-message" role="status">Loading diff…</p>
            : <>
              {current.diff.text ? <div className="changes-diff-scroll" tabIndex={0} role="region" aria-label="File diff"><DiffLines text={current.diff.text} /></div>
                : <p className="changes-message">No text diff for this file.</p>}
              {current.diff.truncated && <p className="changes-truncated">Diff truncated.</p>}
            </>}
        </section>
      </> : <div className="changes-empty">
        <EmptyIcon size={18} aria-hidden="true" />
        <p>{!workspace ? 'Open a workspace to view changes.' : status.branch ? 'Working tree is clean.' : 'This workspace is outside a Git repository.'}</p>
      </div>}
    </aside>
  )
}
