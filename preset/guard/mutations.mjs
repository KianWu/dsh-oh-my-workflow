/**
 * Mutation facts: did this turn actually change files?
 *
 * Official `write`/`edit` are trusted only when the tool result is not an
 * error. OPS mutations are trusted only through the bounded
 * `event.data.meta.opsOutcome` facts — never by parsing their rendered text.
 * A transport success is not a business success, and an error with
 * `effectState: applied|partial` may still have changed something.
 */
import { opsOutcomeOf, pathsFromArguments } from './events.mjs'

/** Official file-mutation tools registered by `dsh-tool-fs`. */
export const OFFICIAL_MUTATION_TOOLS = Object.freeze(['write', 'edit'])

/** OPS Native mutation tools published by `dsh-ops/integration`. */
export const OPS_MUTATION_TOOLS = Object.freeze([
  'ops_replace',
  'ops_write_file',
  'ops_edit_file',
  'ops_copy',
  'ops_move',
  'ops_remove',
])

export const MUTATION_TOOLS = Object.freeze([...OFFICIAL_MUTATION_TOOLS, ...OPS_MUTATION_TOOLS])

const OFFICIAL = new Set(OFFICIAL_MUTATION_TOOLS)
const OPS = new Set(OPS_MUTATION_TOOLS)
const APPLIED_EFFECTS = new Set(['applied', 'partial'])
const FAILURE_STATUSES = new Set(['rejected', 'conflict', 'error', 'unknown'])

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** True when `name` is a mutation tool the guard understands. */
export function isMutationTool(name) {
  return OFFICIAL.has(name) || OPS.has(name)
}

/**
 * Reduce one tool outcome to a mutation fact.
 *
 * Returns `null` for non-mutation tools. For mutations:
 *   changed   — may have modified the filesystem (worth verifying)
 *   confirmed — the tool explicitly confirmed completion
 *   status    — completed | partial | planned | rejected | conflict | error | unknown
 *   dryRun    — preview only, never a change
 *   effectState / reason — diagnostic facts, never user-facing claims
 */
export function mutationFact(outcome) {
  const name = outcome?.name
  if (!isMutationTool(name)) return null
  const paths = pathsFromArguments(outcome.args)

  if (OFFICIAL.has(name)) {
    const changed = outcome.isError !== true
    return {
      tool: name,
      source: 'official',
      changed,
      confirmed: changed,
      status: changed ? 'completed' : 'error',
      dryRun: false,
      effectState: changed ? 'applied' : 'none',
      paths,
      reason: changed ? 'official-success' : 'tool-error',
    }
  }

  const ops = opsOutcomeOf(outcome)
  if (ops === null) {
    return {
      tool: name,
      source: 'ops',
      changed: false,
      confirmed: false,
      status: 'unknown',
      dryRun: false,
      effectState: 'unknown',
      paths,
      reason: 'missing-ops-outcome',
    }
  }

  const status = typeof ops.status === 'string' ? ops.status : 'unknown'
  const dryRun = ops.dryRun === true
  const effectState = typeof ops.error?.effectState === 'string' ? ops.error.effectState : undefined

  if (dryRun) {
    return {
      tool: name, source: 'ops', changed: false, confirmed: false,
      status: 'planned', dryRun: true, effectState: 'none', paths, reason: 'dry-run',
    }
  }

  if (status === 'completed') {
    return {
      tool: name, source: 'ops', changed: true, confirmed: true,
      status, dryRun: false, effectState: 'applied', paths, reason: 'completed',
    }
  }

  if (status === 'partial') {
    return {
      tool: name, source: 'ops', changed: true, confirmed: false,
      status, dryRun: false, effectState: 'partial', paths, reason: 'partial',
    }
  }

  if (status === 'planned') {
    return {
      tool: name, source: 'ops', changed: false, confirmed: false,
      status, dryRun: false, effectState: 'none', paths, reason: 'planned',
    }
  }

  if (FAILURE_STATUSES.has(status)) {
    const changed = effectState !== undefined && APPLIED_EFFECTS.has(effectState)
    return {
      tool: name, source: 'ops', changed, confirmed: false,
      status, dryRun: false, effectState: effectState ?? 'unknown', paths,
      reason: changed ? `failed-with-effects:${effectState}` : `failed:${status}`,
    }
  }

  return {
    tool: name, source: 'ops', changed: false, confirmed: false,
    status, dryRun: false, effectState: 'unknown', paths, reason: 'unrecognized-status',
  }
}

/** True when every path is a document or a process record under `.agent/`. */
export function onlyDocumentation(paths, suffixes = []) {
  if (!Array.isArray(paths) || paths.length === 0) return false
  const lowered = suffixes.map(suffix => String(suffix).toLowerCase())
  return paths.every(candidate => {
    const normalized = String(candidate).replace(/\\/g, '/').toLowerCase()
    // Work records (PROGRESS, tickets, ledger, handoff) are documentation even
    // when their extension is .tsv or has no suffix.
    if (normalized === '.agent' || normalized.startsWith('.agent/') || normalized.includes('/.agent/')) return true
    return lowered.some(suffix => normalized.endsWith(suffix))
  })
}

/** True when the outcome's OPS business status is a failure. */
export function opsFailure(outcome) {
  const ops = opsOutcomeOf(outcome)
  if (ops === null) return false
  return FAILURE_STATUSES.has(ops.status)
}

/** True when the OPS error explicitly says earlier effects may exist. */
export function opsFailedWithEffects(outcome) {
  const ops = opsOutcomeOf(outcome)
  if (ops === null) return false
  return APPLIED_EFFECTS.has(ops.error?.effectState)
}

export { isRecord }
