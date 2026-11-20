import { lazy, memo, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Check, ChevronRight, CircleAlert, FilePenLine, FileText, Loader2, SquareTerminal, Wrench } from 'lucide-react'
import type { ChatTurn, ToolCallItem } from '../shared/types'

const AssistantMarkdown = lazy(() => import('./AssistantMarkdown'))

export function DiffLines({ text }: { text: string }) {
  return (
    <pre className="diff-lines">
      {text.replace(/\n$/, '').split('\n').map((line, index) => {
        const type = /^(diff |index |--- |\+\+\+ |@@|Staged$|Unstaged$)/.test(line) ? 'meta'
          : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''
        return <span key={index} data-line={type}>{line || ' '}</span>
      })}
    </pre>
  )
}

const toolIcons: Record<string, typeof Wrench> = { read: FileText, edit: FilePenLine, write: FilePenLine, bash: SquareTerminal }

function ToolCall({ call }: { call: ToolCallItem }) {
  const Icon = toolIcons[call.name] ?? Wrench
  const running = call.status === 'running' || call.status === 'pending'
  const title = call.name === 'bash' ? 'Shell' : call.name.charAt(0).toUpperCase() + call.name.slice(1)
  const status = call.status === 'pending' ? 'Queued' : running ? 'Running' : call.status === 'done' ? 'Completed' : call.status === 'error' ? 'Failed' : 'Interrupted'
  return (
    <details className="tool-call" open={call.userInvoked || undefined}>
      <summary>
        <Icon className="tool-icon" size={14} />
        <span className="tool-name">{title}</span>
        {call.label && <span className={call.name === 'read' || call.name === 'edit' || call.name === 'write' ? 'tool-target file-path' : 'tool-target'} title={call.label}>{call.label}</span>}
        <span className="tool-status" data-status={call.status} title={status} aria-label={status}>
          {running ? <Loader2 className="animate-spin" size={12} aria-hidden="true" /> : call.status === 'done'
            ? <Check size={13} /> : <CircleAlert size={13} />}
        </span>
        <ChevronRight className="disclosure-chevron" size={13} />
      </summary>
      <div className="tool-body">
        {call.diff && <DiffLines text={call.diff} />}
        {call.output && <pre>{call.output}</pre>}
        {!call.diff && !call.output && <span>{running ? 'Waiting for output…' : 'No text output.'}</span>}
      </div>
    </details>
  )
}

const Turn = memo(function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return <div className="user-turn">{turn.parts.map((part) => part.type === 'text' ? part.text : '').join('\n')}</div>
  }
  if (!turn.parts.some((part) => part?.type === 'tool' || part?.text) && !turn.error) return null
  return (
    <article className="assistant-turn" aria-label="Pi">
      <div className="turn-content">
        {turn.parts.map((part, index) => {
          if (part.type === 'tool') return <ToolCall key={part.call.id} call={part.call} />
          if (!part.text) return null
          if (part.type === 'thinking') {
            return (
              <details key={index} className="thought">
                <summary>
                  {part.durationMs === undefined ? part.streaming ? 'Thinking' : 'Thought process' : `Thought for ${Math.max(1, Math.round(part.durationMs / 1000))}s`}
                  <ChevronRight className="disclosure-chevron" size={13} />
                </summary>
                <div>{part.text}</div>
              </details>
            )
          }
          return (
            <Suspense key={index} fallback={<p className="markdown">{part.text}</p>}>
              <AssistantMarkdown text={part.text} />
            </Suspense>
          )
        })}
        {turn.error && <div className="turn-error" role="alert"><CircleAlert size={15} aria-hidden="true" /><p>{turn.error}</p></div>}
      </div>
    </article>
  )
})

interface Props {
  sessionId?: string
  turns: ChatTurn[]
  running: boolean
}

export function Conversation({ sessionId, turns, running }: Props) {
  const feed = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [awayFromLatest, setAwayFromLatest] = useState(false)
  useLayoutEffect(() => {
    pinned.current = true
    setAwayFromLatest(false)
  }, [sessionId])
  useLayoutEffect(() => {
    const pane = feed.current
    const transcript = pane?.firstElementChild
    if (!pane || !transcript) return
    const observer = new ResizeObserver(() => {
      if (pinned.current) pane.scrollTop = pane.scrollHeight
    })
    observer.observe(transcript)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [sessionId, Boolean(turns.length || running)])
  useLayoutEffect(() => {
    if (feed.current && pinned.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [sessionId, turns, running])

  return (
    <div className="conversation-pane">
      <div className="feed" ref={feed} onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
        pinned.current = scrollHeight - scrollTop - clientHeight < 80
        setAwayFromLatest(!pinned.current)
      }}>
        {(turns.length > 0 || running) && (
          <div className="transcript mx-auto w-full max-w-[740px]">
            {turns.map((turn) => <Turn key={turn.id} turn={turn} />)}
            {running && <div className="run-indicator" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Working</div>}
          </div>
        )}
      </div>
      {awayFromLatest && <button type="button" className="latest-button" onClick={() => {
        if (feed.current) feed.current.scrollTop = feed.current.scrollHeight
      }}><ArrowDown size={13} aria-hidden="true" />Jump to latest</button>}
    </div>
  )
}
