/**
 * Verification facts: did a real process finish successfully, and is its
 * command strong evidence for this turn's change?
 *
 * Rules fixed by the architecture:
 *   - only a real foreground process with `exitCode: 0` is a verification;
 *   - background acceptance and promotion are not completion;
 *   - a signal, a non-zero exit, or missing process facts never counts;
 *   - reading a file back is writing evidence, not behavioral evidence;
 *   - an unrelated command is not evidence.
 *
 * `ops_bash` process facts come from `event.data.meta.opsShell`; rendered text
 * is never used to upgrade an OPS call to success. Official `bash`/`pwsh`
 * results are read from structured metadata when present, with the host's
 * documented `[exit code: N]` marker as a bounded fallback.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { opsOutcomeOf, opsShellOf } from './events.mjs'

export const SHELL_TOOLS = Object.freeze(['bash', 'pwsh', 'ops_bash'])
const SHELLS = new Set(SHELL_TOOLS)

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = value => (typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined)

/** The command a shell call ran, if one is named. */
export function commandOf(outcome) {
  const args = outcome?.args
  if (!isRecord(args)) return undefined
  if (typeof args.command === 'string' && args.command.trim() !== '') return args.command
  if (typeof args.script_path === 'string' && args.script_path.trim() !== '') return args.script_path
  return undefined
}

/** Structured exit codes the host or OPS may attach to a shell result. */
function exitCodeOf(outcome) {
  const direct = [
    outcome?.meta?.exitCode,
    outcome?.meta?.shell?.exitCode,
    outcome?.meta?.bash?.exitCode,
    outcome?.meta?.pwsh?.exitCode,
    outcome?.meta?.process?.exitCode,
  ]
  for (const value of direct) {
    const code = integer(value)
    if (code !== undefined) return code
  }
  const shell = opsShellOf(outcome)
  if (shell !== null) {
    const code = integer(shell.exitCode)
    if (code !== undefined) return code
  }
  return undefined
}

/** The documented host marker, used only when no structured code exists. */
function exitCodeFromText(text) {
  if (typeof text !== 'string') return undefined
  const matches = [...text.matchAll(/\[exit code:\s*(-?\d+)\]/gi)]
  if (matches.length === 0) return undefined
  return Number(matches[matches.length - 1][1])
}

/**
 * Reduce one outcome to process facts.
 * Returns `null` for non-shell tools, otherwise `{ completed, exitCode, signal, command, reason }`.
 */
export function processFact(outcome, options = {}) {
  if (!SHELLS.has(outcome?.name)) return null
  const command = commandOf(outcome)
  const shell = opsShellOf(outcome)
  // Official `bash`/`pwsh` report `[exit code: N]` only for a non-zero exit, so
  // a non-error result with no marker and no signal is a successful run. OPS
  // results always carry explicit `opsShell` facts and are never assumed.
  const assumeSuccess = options.assumeOfficialShellSuccess !== false

  // OPS: a background/promoted result has no `opsShell` facts and is never a
  // completed foreground process. A signal also outranks any text rendering.
  if (outcome.name === 'ops_bash') {
    if (shell !== null) {
      if (typeof shell.signal === 'string' && shell.signal !== '') {
        return { completed: false, exitCode: undefined, signal: shell.signal, command, reason: 'signal' }
      }
      const code = integer(shell.exitCode)
      if (code !== undefined) {
        return { completed: code === 0, exitCode: code, signal: undefined, command, reason: code === 0 ? 'ok' : 'non-zero-exit' }
      }
    }
    return { completed: false, exitCode: undefined, signal: undefined, command, reason: 'missing-ops-shell-facts' }
  }

  const code = exitCodeOf(outcome) ?? exitCodeFromText(outcome.text)
  const signal = typeof outcome?.meta?.signal === 'string' ? outcome.meta.signal : undefined
  if (signal !== undefined && signal !== '') {
    return { completed: false, exitCode: code, signal, command, reason: 'signal' }
  }
  if (code === undefined) {
    if (assumeSuccess && outcome?.isError !== true) {
      return { completed: true, exitCode: 0, signal: undefined, command, reason: 'assumed-ok' }
    }
    return { completed: false, exitCode: undefined, signal: undefined, command, reason: 'missing-exit-code' }
  }
  return { completed: code === 0, exitCode: code, signal: undefined, command, reason: code === 0 ? 'ok' : 'non-zero-exit' }
}

/** Commands that prove a project build/test/typecheck rather than echo a value. */
const PROJECT_CHECK_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|typecheck|type-check|build|lint|check)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+exec\s+(?:tsc|vitest|jest|eslint|playwright)\b/i,
  /\b(?:npx|pnpx)\s+(?:tsc|vitest|jest|eslint|playwright)\b/i,
  /\b(?:tsc|vitest|jest|mocha|eslint|biome|pytest|mypy|ruff)\b/i,
  /\bpython(?:3)?\s+-m\s+(?:pytest|unittest|mypy|compileall)\b/i,
  /\bcargo\s+(?:test|check|build|clippy)\b/i,
  /\bgo\s+(?:test|build|vet)\b/i,
  /\bdotnet\s+(?:test|build)\b/i,
  /\b(?:mvn|mvnw)\s+(?:test|verify|package)\b/i,
  /\b(?:gradle|gradlew)\s+(?:test|check|build)\b/i,
  /\bmake\s+(?:test|check|build)\b/i,
  /\bcmake\s+--build\b/i,
  /\bnode\s+--test\b/i,
  /\b(?:bun|deno)\s+(?:test|check|lint)\b/i,
  /\b(?:uv|poetry|pdm|pipenv)\s+run\s+(?:pytest|mypy|ruff|tox|nox)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+run\s+[\w:-]*(?:test|check|verify|build|lint|type|spec|e2e)[\w:-]*/i,
]

/** Running a target script is evidence only when it names an edited file. */
const TARGET_RUN_PATTERNS = [
  /\bnode\s+(?:\.\/)?([^\s]+\.(?:mjs|cjs|js))\b/i,
  // Inline evaluation that imports/exercises an edited module is a target run
  // too. The edited-file relevance check below still decides whether it counts.
  /\bnode\b[^\n]*(?:\s|^)(?:-e|--eval|--input-type)\b/i,
  /\bpython(?:3)?\s+(?:\.\/)?([^\s]+\.py)\b/i,
  /\bpython(?:3)?\s+-c\b/i,
  /(?:^|\s)(?:\.\/)?([^\s]+\.(?:exe|cmd|bat|ps1|sh))\b/i,
  /\b(?:dotnet|go|gradle|gradlew|flutter|deno|bun)\s+run\b/i,
]

function mentionsAny(command, files) {
  if (!Array.isArray(files) || files.length === 0) return false
  const normalized = command.replace(/\\/g, '/')
  return files.some(file => {
    const base = String(file).replace(/\\/g, '/').split('/').pop()
    return base !== undefined && base !== '' && normalized.toLowerCase().includes(base.toLowerCase())
  })
}

/**
 * Classify a command's strength. `config.commands` are project-specific strong
 * commands from `.agent/workflow/verify.json`; they match by substring.
 */
export function classifyVerificationCommand(command, config = {}, mutatedFiles = []) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { strong: false, reason: 'no-command' }
  }
  const configured = Array.isArray(config.commands) ? config.commands : []
  if (configured.some(item => typeof item === 'string' && item.trim() !== '' && command.includes(item))) {
    return { strong: true, reason: 'configured-command' }
  }
  if (PROJECT_CHECK_PATTERNS.some(pattern => pattern.test(command))) {
    return { strong: true, reason: 'project-check' }
  }
  if (TARGET_RUN_PATTERNS.some(pattern => pattern.test(command))) {
    return mentionsAny(command, mutatedFiles)
      ? { strong: true, reason: 'target-run' }
      : { strong: false, reason: 'target-run-without-edited-file' }
  }
  return { strong: false, reason: 'not-a-strong-check' }
}

/** Full verification fact for one shell outcome. */
export function verificationFact(outcome, config = {}, mutatedFiles = []) {
  const process = processFact(outcome, config)
  if (process === null) return null
  const classification = process.completed
    ? classifyVerificationCommand(process.command, config, mutatedFiles)
    : { strong: false, reason: process.reason }
  return { ...process, ...classification }
}

const EMPTY_PROJECT_CONFIG = Object.freeze({ commands: [], documentationSuffixes: [], source: null })

/** Load project-specific strong verification commands; never throws. */
export async function loadProjectVerificationConfig(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return { ...EMPTY_PROJECT_CONFIG }
  for (const name of ['verify.json', 'guard.json']) {
    try {
      const raw = await readFile(join(cwd, '.agent', 'workflow', name), 'utf8')
      const parsed = JSON.parse(raw)
      if (!isRecord(parsed)) continue
      const commands = Array.isArray(parsed.commands)
        ? parsed.commands.filter(item => typeof item === 'string' && item.trim() !== '')
        : Array.isArray(parsed.verifyCommands)
          ? parsed.verifyCommands.filter(item => typeof item === 'string' && item.trim() !== '')
          : []
      const documentationSuffixes = Array.isArray(parsed.documentationSuffixes)
        ? parsed.documentationSuffixes.filter(item => typeof item === 'string' && item.trim() !== '')
        : []
      return { commands, documentationSuffixes, source: name }
    } catch {
      // Missing or malformed project config is not a turn failure; the next
      // candidate or the built-in patterns still apply.
    }
  }
  return { ...EMPTY_PROJECT_CONFIG }
}

/** Cache loader keyed by working directory; the turn path only awaits a cached promise. */
export function createProjectConfigCache(loader = loadProjectVerificationConfig) {
  const cache = new Map()
  return {
    get(cwd) {
      const key = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : ''
      if (!cache.has(key)) cache.set(key, loader(key))
      return cache.get(key)
    },
    clear() {
      cache.clear()
    },
  }
}

export { EMPTY_PROJECT_CONFIG }
