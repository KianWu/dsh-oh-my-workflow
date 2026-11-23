/**
 * Event fixtures: the exact shapes the guard consumes from a session log.
 * They mirror `tool/call` and `tool/result` events, including the bounded
 * `event.data.meta.opsOutcome` / `meta.opsShell` facts.
 */
let seq = 0

export function resetSeq() {
  seq = 0
}

export function call(turn, callId, name, args = {}) {
  return {
    type: 'tool/call',
    seq: seq++,
    data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) },
  }
}

export function result(turn, callId, options = {}) {
  const { isError = false, meta, text = '' } = options
  return {
    type: 'tool/result',
    seq: seq++,
    data: {
      turn,
      step: 1,
      message: {
        role: 'tool',
        toolCallId: callId,
        isError,
        content: text === '' ? [] : [{ type: 'text', text }],
      },
      ...(meta === undefined ? {} : { meta }),
    },
  }
}

/** A mutation result carrying OPS business facts. */
export function opsOutcome(turn, callId, name, args, facts) {
  return [
    call(turn, callId, name, args),
    result(turn, callId, { meta: { opsOutcome: facts } }),
  ]
}

/** A shell result carrying OPS process facts. */
export function opsShell(turn, callId, args, facts) {
  return [
    call(turn, callId, 'ops_bash', args),
    result(turn, callId, { meta: facts === undefined ? {} : { opsShell: facts } }),
  ]
}

/** A foreground OPS shell with a numeric exit code. */
export function opsBash(turn, callId, command, exitCode = 0) {
  return opsShell(turn, callId, { command, description: 'test' }, { exitCode })
}

/** An official `pwsh` result with structured process facts. */
export function officialShell(turn, callId, name, command, exitCode = 0) {
  return [
    call(turn, callId, name, { command, description: 'test' }),
    result(turn, callId, { meta: { exitCode } }),
  ]
}

/** Flatten a list of event groups in order. */
export function events(...groups) {
  return groups.flat()
}
