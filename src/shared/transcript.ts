import type { ChatPart, ChatTurn, SessionEvent, SessionSnapshot, ToolCallItem } from './types'

export function updateTool(parts: ChatPart[], call: ToolCallItem): ChatPart[] {
  const index = parts.findIndex((part) => part?.type === 'tool' && part.call.id === call.id)
  if (index === -1) return [...parts, { type: 'tool', call }]
  const next = parts.slice()
  const existing = parts[index]
  if (existing.type === 'tool') next[index] = { type: 'tool', call: { ...existing.call, ...call } }
  return next
}

export function applySessionEvent(session: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  if (event.revision <= session.revision) return session
  if (event.type === 'agent_settled' || event.type === 'session_updated') return event.snapshot
  const next = { ...session, revision: event.revision }
  if (event.type === 'queue_changed') return { ...next, queued: event.queued }
  if (event.type === 'streaming_changed') {
    return { ...next, streaming: event.streaming, summary: { ...session.summary, running: event.running } }
  }
  if (event.type === 'run_start') return { ...next, error: undefined, summary: { ...session.summary, running: true } }

  const turns = session.turns.slice()
  const id = event.type === 'message_end' ? event.turn.id : event.turnId
  const index = turns.findLastIndex((turn) => turn.id === id)
  if (event.type === 'message_end') {
    if (index === -1) turns.push(event.turn)
    else turns[index] = event.turn
  } else if (event.type === 'message_update') {
    const turn: ChatTurn = turns[index] ?? { id, role: 'assistant', timestamp: event.timestamp, parts: [] }
    const parts = turn.parts.slice()
    const existing = parts[event.index]
    const previous = existing?.type === event.kind ? existing.text : ''
    parts[event.index] = { type: event.kind, text: previous + event.delta, streaming: true }
    if (index === -1) turns.push({ ...turn, parts })
    else turns[index] = { ...turn, parts }
  } else if (index >= 0) {
    const turn = turns[index]
    turns[index] = { ...turn, parts: updateTool(turn.parts, event.call) }
  }
  return { ...next, turns }
}
