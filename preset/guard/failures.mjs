/**
 * Failure sequences and stop-loss.
 *
 * A "same-kind" failure is the same tool with the same command/target and the
 * same OPS error code. Two different failing ideas in a row are not a repeat,
 * so they must not trigger the st-unstick nudge; two attempts of the same idea
 * are. Counts are per session, and each mounted guard instance watches exactly
 * one agent's sessions, so parent and child never share a counter.
 */
import { opsOutcomeOf, opsShellOf } from './events.mjs'
import { opsFailure } from './mutations.mjs'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

const FAILURE_STATUSES = new Set(['rejected', 'conflict', 'error', 'unknown'])

/** True when one tool outcome represents a failed action. */
export function isFailureOutcome(outcome) {
  if (!isRecord(outcome)) return false
  if (outcome.isError === true) return true
  const ops = opsOutcomeOf(outcome)
  if (ops !== null && FAILURE_STATUSES.has(ops.status)) return true
  const shell = opsShellOf(outcome)
  if (shell !== null && typeof shell.exitCode === 'number' && shell.exitCode !== 0) return true
  const direct = outcome?.meta?.exitCode
  if (typeof direct === 'number' && direct !== 0) return true
  return false
}

/** A stable identity for "the same fix attempt" across one turn. */
export function failureSignature(outcome) {
  if (!isRecord(outcome)) return 'unknown'
  const args = isRecord(outcome.args) ? outcome.args : {}
  const target = typeof args.command === 'string'
    ? args.command
    : typeof args.script_path === 'string'
      ? args.script_path
      : typeof args.file_path === 'string'
        ? args.file_path
        : typeof args.path === 'string'
          ? args.path
          : ''
  const normalized = target.replace(/\s+/g, ' ').trim().toLowerCase()
  const ops = opsOutcomeOf(outcome)
  const code = isRecord(ops?.error) && typeof ops.error.code === 'string' ? ops.error.code : ''
  return `${outcome.name ?? 'unknown'}|${normalized}|${code}`
}

/**
 * Analyse the tail of a turn's outcomes.
 * `streak` counts only trailing failures that share the last failure's
 * signature; `trailingFailures` counts every trailing failure.
 */
export function failureSummary(outcomes, threshold = 2) {
  const list = Array.isArray(outcomes) ? outcomes : []
  let trailingFailures = 0
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (!isFailureOutcome(list[index])) break
    trailingFailures += 1
  }
  if (trailingFailures === 0) {
    return { streak: 0, trailingFailures: 0, signature: null, reached: false }
  }

  const last = list[list.length - 1]
  const signature = failureSignature(last)
  let streak = 0
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const outcome = list[index]
    if (!isFailureOutcome(outcome) || failureSignature(outcome) !== signature) break
    streak += 1
  }

  return {
    streak,
    trailingFailures,
    signature,
    reached: Number.isInteger(threshold) && threshold > 0 && streak >= threshold,
  }
}

export { opsFailure }
