/**
 * workflow-turn-guard — the host-facing half of the workflow discipline.
 *
 * It listens on `agent/turn-stopping`, the serial hook that runs before an
 * otherwise finished turn closes, reads this turn's durable events, and when a
 * rule is violated it steers one short message back into the session. The
 * steering wakes the loop for one more step.
 *
 * Deliberate limits:
 *  - at most `maxSteersPerTurn` steers per turn, and the second is worded more
 *    explicitly; a repeated hook with no new activity never spends a second;
 *  - pure documentation edits are exempt from the behavioral evidence rule;
 *  - failures are compared by tool + command/target + OPS error code, so two
 *    different errors do not count as "the same fix twice";
 *  - every decision is derived from the session log, so resumed sessions behave
 *    the same way;
 *  - an exception inside the guard is logged once and never fails the turn.
 */
import { snapshotSessionEvents, toolOutcomes, turnEvents } from './guard/events.mjs'
import {
  MUTATION_TOOLS,
  mutationFact,
  onlyDocumentation,
} from './guard/mutations.mjs'
import {
  SHELL_TOOLS,
  createProjectConfigCache,
  verificationFact,
} from './guard/evidence.mjs'
import { failureSummary } from './guard/failures.mjs'

export const name = 'workflow-turn-guard'

const SOURCE_KIND = 'workflow-turn-guard'

const DEFAULT_DOCUMENTATION_SUFFIXES = ['.md', '.mdx', '.txt', '.rst', '.adoc']

const DEFAULTS = Object.freeze({
  enabled: true,
  evidence: true,
  unstick: true,
  failStreak: 2,
  maxSteersPerTurn: 2,
  includeSubagents: true,
  evidenceScope: 'balanced',
  assumeOfficialShellSuccess: true,
  mutationTools: MUTATION_TOOLS,
  checkTools: SHELL_TOOLS,
  documentationSuffixes: DEFAULT_DOCUMENTATION_SUFFIXES,
  verifyCommands: [],
})

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function booleanOption(config, key) {
  const value = config[key]
  if (value === undefined) return DEFAULTS[key]
  if (typeof value !== 'boolean') throw new TypeError(`${name}: ${key} must be a boolean`)
  return value
}

function positiveInteger(config, key) {
  const value = config[key]
  if (value === undefined) return DEFAULTS[key]
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name}: ${key} must be a positive integer`)
  return value
}

function enumOption(config, key, allowed, fallback) {
  const value = config[key]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new TypeError(`${name}: ${key} must be one of ${allowed.join(', ')}`)
  }
  return value
}

function stringList(config, key, fallback) {
  const value = config[key]
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${name}: ${key} must be an array of strings`)
  }
  return [...value]
}

/** Accept either a flat row config or `{ guard: {...} }` from the docs. */
export function normalizeOptions(raw = {}) {
  const config = isRecord(raw) ? (isRecord(raw.guard) ? { ...raw, ...raw.guard } : raw) : {}
  const mutationTools = stringList(config, 'mutationTools', MUTATION_TOOLS)
  const checkTools = stringList(config, 'checkTools', SHELL_TOOLS)
  const documentationSuffixes = stringList(config, 'documentationSuffixes', DEFAULT_DOCUMENTATION_SUFFIXES)
  if (mutationTools.length === 0) throw new TypeError(`${name}: mutationTools must not be empty`)
  if (checkTools.length === 0) throw new TypeError(`${name}: checkTools must not be empty`)
  if (documentationSuffixes.length === 0) throw new TypeError(`${name}: documentationSuffixes must not be empty`)
  return {
    enabled: booleanOption(config, 'enabled'),
    evidence: booleanOption(config, 'evidence'),
    unstick: booleanOption(config, 'unstick'),
    failStreak: positiveInteger(config, 'failStreak'),
    maxSteersPerTurn: positiveInteger(config, 'maxSteersPerTurn'),
    includeSubagents: booleanOption(config, 'includeSubagents'),
    evidenceScope: enumOption(config, 'evidenceScope', ['balanced', 'strict'], DEFAULTS.evidenceScope),
    assumeOfficialShellSuccess: booleanOption(config, 'assumeOfficialShellSuccess'),
    mutationTools,
    checkTools,
    documentationSuffixes,
    verifyCommands: stringList(config, 'verifyCommands', []),
  }
}

/**
 * Pure turn analysis. Returns a rule (`allow` | `evidence` | `unstick`) plus
 * the facts behind it, so the host adapter stays thin and tests need no host.
 */
export function evaluateTurn(outcomes, options = {}) {
  const threshold = options.failStreak ?? DEFAULTS.failStreak
  const documentationSuffixes = options.documentationSuffixes ?? DEFAULT_DOCUMENTATION_SUFFIXES
  const verification = isRecord(options.verification) ? options.verification : { commands: [] }
  const list = Array.isArray(outcomes) ? outcomes : []

  const mutations = []
  for (let index = 0; index < list.length; index += 1) {
    const fact = mutationFact(list[index])
    if (fact !== null && fact.changed) mutations.push({ ...fact, index })
  }

  const allMutatedFiles = [...new Set(mutations.flatMap(fact => fact.paths))]

  const verifications = []
  for (let index = 0; index < list.length; index += 1) {
    const fact = verificationFact(list[index], verification, allMutatedFiles)
    if (fact !== null && fact.completed) verifications.push({ ...fact, index })
  }

  const lastMutation = mutations.length === 0 ? -1 : mutations[mutations.length - 1].index
  const firstMutation = mutations.length === 0 ? -1 : mutations[0].index
  const strong = verifications.filter(fact => fact.strong)
  const lastStrong = strong.length === 0 ? -1 : strong[strong.length - 1].index

  const unproven = mutations.filter(fact => fact.index > lastStrong)
  const unprovenFiles = [...new Set(unproven.flatMap(fact => fact.paths))]
  const docOnly = unprovenFiles.length > 0 && onlyDocumentation(unprovenFiles, documentationSuffixes)

  const evidenceScope = options.evidenceScope === 'strict' ? 'strict' : 'balanced'
  // balanced: one strong verification after the *first* change of the turn is
  // enough; later small edits do not force another run. strict: the check must
  // come after the *last* change.
  const missingUnderScope = evidenceScope === 'strict'
    ? lastMutation >= 0 && lastStrong < lastMutation
    : lastMutation >= 0 && !(lastStrong > firstMutation)
  const evidenceMissing = missingUnderScope && !docOnly
  const failures = failureSummary(list, threshold)

  let rule = 'allow'
  if (options.unstick !== false && failures.reached) rule = 'unstick'
  else if (options.evidence !== false && evidenceMissing) rule = 'evidence'

  return {
    rule,
    mutationCount: mutations.length,
    lastMutation,
    firstMutation,
    lastStrong,
    evidenceScope,
    evidenceMissing,
    documentationOnly: docOnly,
    mutatedFiles: allMutatedFiles,
    unprovenFiles,
    failureStreak: failures.streak,
    trailingFailures: failures.trailingFailures,
    failureSignature: failures.signature,
  }
}

function evidenceText(files, attempt = 1) {
  const where = files.length === 0
    ? '本轮修改了文件'
    : `本轮修改了 ${files.slice(0, 3).map(file => `\`${file}\``).join('、')}`
  const base = [
    `workflow 检查点 — ${where}，但之后没有成功的验证命令。`,
    '运行能证明改动的最小命令（测试、构建、类型检查或目标程序本身），并在同一段汇报里给出结果。',
    '如果当前环境确实无法验证，用一行说明未验证的范围和原因。',
  ]
  if (attempt > 1) {
    base.splice(1, 0, '这是同一轮第二次提醒：你已经在没有证据的情况下准备结束。')
  }
  return base.join('')
}

function unstickText(streak, attempt = 1) {
  const base = [
    `workflow 检查点 — 最后 ${streak} 次同类调用连续失败。`,
    '不要尝试同一修法的第三个变体。先指出这些尝试共同的前提，直接验证它，再换路径（st-unstick）。',
  ]
  if (attempt > 1) base.push('这是同一轮第二次提醒。')
  return base.join('')
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

export function apply(ctx, rawConfig = {}) {
  const options = normalizeOptions(rawConfig)

  if (!options.enabled) return

  const projectConfigs = createProjectConfigCache()

  const claimed = new Map()
  const CLAIM_LIMIT = 200
  const claim = (key, seen) => {
    const entry = claimed.get(key)
    if (entry !== undefined && (entry.count >= options.maxSteersPerTurn || seen <= entry.seen)) return 0
    const count = (entry?.count ?? 0) + 1
    claimed.set(key, { count, seen })
    if (claimed.size > CLAIM_LIMIT) {
      const oldest = claimed.keys().next().value
      claimed.delete(oldest)
    }
    return count
  }

  let warned = false
  const warnOnce = message => {
    if (warned) return
    warned = true
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // The logger is optional; the guard exists to avoid noise, not make it.
    }
  }

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    try {
      if (typeof agent?.steer !== 'function') return
      const session = agent.session
      if (session === undefined || session === null) return
      const depth = Number.isInteger(session.header?.delegationDepth) ? session.header.delegationDepth : 0
      if (!options.includeSubagents && depth > 0) return

      const events = snapshotSessionEvents(session)
      const current = turnEvents(events, turn)
      if (current.length === 0) return

      const cwd = firstString(
        session.header?.cwd,
        session.header?.workingDirectory,
        session.header?.workspaceDir,
        session.cwd,
        agent.cwd,
      )
      const project = await projectConfigs.get(cwd)
      const verification = {
        commands: [...options.verifyCommands, ...(project.commands ?? [])],
        documentationSuffixes: project.documentationSuffixes?.length > 0
          ? project.documentationSuffixes
          : options.documentationSuffixes,
        assumeOfficialShellSuccess: options.assumeOfficialShellSuccess,
      }

      const analysis = evaluateTurn(toolOutcomes(current), { ...options, verification })
      if (analysis.rule === 'allow') return

      const key = `${session.id}:${turn}`
      const attempt = claim(key, current.length)
      if (attempt === 0) return

      const text = analysis.rule === 'unstick'
        ? unstickText(analysis.failureStreak, attempt)
        : evidenceText(analysis.unprovenFiles, attempt)

      agent.steer({
        id: `${SOURCE_KIND}-${session.id}-${turn}-${attempt}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: SOURCE_KIND },
      })
    } catch (error) {
      warnOnce(`${name}: turn check failed, leaving the turn to close: ${String((error && error.message) || error)}`)
    }
  })
}
