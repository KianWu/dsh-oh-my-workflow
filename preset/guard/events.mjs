/**
 * Durable-event reading and normalization.
 *
 * Everything the guard knows comes from the session's own event log, so the
 * analysis is replayable and behaves the same in a resumed session. This
 * module is intentionally free of host imports: tests feed it plain fixtures.
 */

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Read a session's durable events, tolerating the two shapes the host has
 * exposed across versions: `snapshotEvents()` and a plain `events` array.
 */
export function snapshotSessionEvents(session) {
  const events = typeof session?.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : session?.events
  if (!Array.isArray(events)) {
    throw new TypeError('workflow-turn-guard: session event history must be an array')
  }
  return events
}

/** Keep only the events belonging to one turn. */
export function turnEvents(events, turn) {
  return events.filter(event => event?.data?.turn === turn)
}

/** Join the text blocks of a message; other block types are ignored. */
export function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Parse a tool call's raw JSON arguments without ever throwing. */
export function parseToolArguments(raw) {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Correlate `tool/call` events with their `tool/result` events and return one
 * ordered outcome per result. Fields the host might rename are read
 * defensively; missing values stay missing rather than being guessed.
 */
export function toolOutcomes(events) {
  const calls = new Map()
  const outcomes = []

  for (const event of events) {
    if (event?.type === 'tool/call') {
      const callId = event.data?.callId
      if (typeof callId === 'string') {
        calls.set(callId, {
          name: typeof event.data?.name === 'string' ? event.data.name : 'unknown',
          arguments: event.data?.arguments,
        })
      }
      continue
    }
    if (event?.type !== 'tool/result') continue

    const message = isRecord(event.data?.message) ? event.data.message : {}
    const callId = typeof message.toolCallId === 'string'
      ? message.toolCallId
      : typeof message.source?.callId === 'string'
        ? message.source.callId
        : undefined
    const call = callId === undefined ? undefined : calls.get(callId)
    const text = contentText(message.content)

    outcomes.push({
      callId,
      name: call?.name ?? 'unknown',
      arguments: call?.arguments,
      args: parseToolArguments(call?.arguments),
      isError: message.isError === true,
      message,
      meta: isRecord(event.data?.meta) ? event.data.meta : undefined,
      text,
      turn: event.data?.turn,
      step: event.data?.step,
    })
  }

  return outcomes
}

/** The bounded OPS outcome facts persisted as `event.data.meta.opsOutcome`. */
export function opsOutcomeOf(outcome) {
  const candidates = [
    outcome?.meta?.opsOutcome,
    outcome?.meta?.presentationMeta?.opsOutcome,
    outcome?.message?.meta?.opsOutcome,
  ]
  return candidates.find(isRecord) ?? null
}

/** The process facts OPS persists for `ops_bash` as `meta.opsShell`. */
export function opsShellOf(outcome) {
  return isRecord(outcome?.meta?.opsShell) ? outcome.meta.opsShell : null
}

/** Every path-like value a tool call named, deduplicated and in call order. */
export function pathsFromArguments(args) {
  if (!isRecord(args)) return []
  const found = []
  const push = value => {
    if (typeof value === 'string' && value.trim() !== '') found.push(value)
  }
  for (const key of ['file_path', 'filePath', 'path', 'file', 'target', 'destination', 'source']) {
    push(args[key])
  }
  for (const key of ['paths', 'file_paths', 'files']) {
    if (Array.isArray(args[key])) for (const value of args[key]) push(value)
  }
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (isRecord(edit)) push(edit.path ?? edit.file_path ?? edit.filePath)
    }
  }
  return [...new Set(found)]
}
