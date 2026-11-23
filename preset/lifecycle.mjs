/**
 * Installation lifecycle for the `workflow` preset.
 *
 * WHY THIS EXISTS
 * The host records "current default preset" as `selectedDefault` inside the
 * profile's `cordis.patch.yml` (`agent-preset-registry` row). Disabling or
 * uninstalling a bundle only removes the bundle row and its package; it never
 * clears that pointer. A pointer left on a missing preset makes every new
 * session fail with `agent-preset/not-found` before the model takes a step.
 *
 * The functions here do the smallest possible repair: locate the one YAML
 * scalar and rewrite its value in place. No full YAML parse, no reordering, no
 * comment loss. Usability is judged from DISK (package present, bundle listed,
 * preset row not disabled) because that is what the host has already written
 * when it disposes a plugin.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PRESET_ID = 'workflow'
export const FALLBACK_PRESET_ID = 'standard'
export const PACKAGE_NAME = 'dsh-oh-my-workflow'
export const GUARD_MEMO = '.oh-my-workflow-guard.json'

const REGISTRY_ID = 'agent-preset-registry'
const ENTRY_RE = /^(\s*)-\s/

/** DSH home: `DSH_HOME` when set, otherwise `~/.dsh`. */
export function resolveDshHome(env = process.env) {
  const override = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return override === '' ? join(homedir(), '.dsh') : override
}

export function readText(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** Atomic write so a killed process never leaves a half-written profile YAML. */
export function writeTextAtomic(path, text) {
  const tmp = `${path}.oh-my-workflow-${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

export function listProfiles(home) {
  const root = join(home, 'profiles')
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
    .map(entry => ({
      name: entry.name,
      dir: join(root, entry.name),
      patchPath: join(root, entry.name, 'cordis.patch.yml'),
      manifestPath: join(root, entry.name, 'package.json'),
      memoPath: join(root, entry.name, GUARD_MEMO),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function splitLines(text) {
  return { eol: text.includes('\r\n') ? '\r\n' : '\n', lines: text.split(/\r?\n/) }
}

function baseIndentOf(lines) {
  for (const line of lines) {
    const match = ENTRY_RE.exec(line)
    if (match !== null) return match[1].length
  }
  return 0
}

/** Locate one top-level entry block by `- id: <id>`, preserving comments inside it. */
export function blockRange(lines, id, baseIndent = 0) {
  const startRe = new RegExp(`^${' '.repeat(baseIndent)}-\\s`)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (!startRe.test(lines[index])) continue
    const rest = lines[index].slice(baseIndent + 2)
    if (new RegExp(`^\\s*id:\\s*["']?${id}["']?\\s*(?:#.*)?$`).test(rest)) {
      start = index
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (startRe.test(lines[index])) {
      end = index
      break
    }
  }
  return { start, end }
}

/** Current `selectedDefault` scalar, or null when absent. */
export function readSelectedDefault(text) {
  if (typeof text !== 'string') return null
  const { lines } = splitLines(text)
  const block = blockRange(lines, REGISTRY_ID, baseIndentOf(lines))
  if (block === null) return null
  for (let index = block.start; index < block.end; index += 1) {
    const match = /^\s*selectedDefault:\s*(.+?)\s*(?:#.*)?$/.exec(lines[index])
    if (match !== null) return match[1].replace(/^["']|["']$/g, '')
  }
  return null
}

/** Rewrite only the `selectedDefault` value when it currently equals `from`. */
export function rewriteSelectedDefault(text, from, to) {
  if (typeof text !== 'string') return { text, changed: false }
  const { eol, lines } = splitLines(text)
  const block = blockRange(lines, REGISTRY_ID, baseIndentOf(lines))
  if (block === null) return { text, changed: false }
  for (let index = block.start; index < block.end; index += 1) {
    const match = /^(\s*selectedDefault:\s*)(.+?)(\s*(?:#.*)?)$/.exec(lines[index])
    if (match === null) continue
    const value = match[2].replace(/^["']|["']$/g, '')
    if (value !== from) continue
    lines[index] = `${match[1]}${to}${match[3]}`
    return { text: lines.join(eol), changed: true }
  }
  return { text, changed: false }
}

/** True when the `preset-<id>` declaration row itself is disabled. */
export function patchDisablesPreset(text, presetId = PRESET_ID) {
  if (typeof text !== 'string') return false
  const { lines } = splitLines(text)
  const block = blockRange(lines, `preset-${presetId}`, baseIndentOf(lines))
  if (block === null) return false
  for (let index = block.start; index < block.end; index += 1) {
    if (/^\s*disabled:\s*true\s*(?:#.*)?$/.test(lines[index])) return true
  }
  return false
}

export function readProfileManifest(dir) {
  const raw = readText(join(dir, 'package.json'))
  if (raw === null) return { raw: null, bundles: [], dependencies: {} }
  try {
    const parsed = JSON.parse(raw)
    return {
      raw,
      bundles: Array.isArray(parsed?.dsh?.profile?.bundles) ? parsed.dsh.profile.bundles : [],
      dependencies: parsed?.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {},
    }
  } catch {
    return { raw, bundles: [], dependencies: {} }
  }
}

/** Disk-based usability judgement: package, bundle registration, enabled preset row. */
export function inspectProfile(profile, packageName = PACKAGE_NAME, presetId = PRESET_ID) {
  const manifest = readProfileManifest(profile.dir)
  const patchText = readText(profile.patchPath)
  const packagePresent = existsSync(join(profile.dir, 'node_modules', packageName, 'package.json'))
  const bundleListed = manifest.bundles.includes(packageName)
  const disabled = patchDisablesPreset(patchText, presetId)
  return {
    ...profile,
    patchText,
    manifest,
    packagePresent,
    bundleListed,
    disabled,
    usable: packagePresent && bundleListed && !disabled,
  }
}

export function readMemo(path) {
  const raw = readText(path)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeMemo(path, memo) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeTextAtomic(path, `${JSON.stringify(memo, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

export function clearMemo(path) {
  try {
    if (existsSync(path)) rmSync(path, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Clear a dangling pointer and leave a memo so a later re-enable can restore
 * the user's choice. Only writes when the pointer is exactly ours and the
 * bundle is not usable.
 */
export function repairProfile(profile, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const fallbackId = options.fallbackId ?? FALLBACK_PRESET_ID
  const packageName = options.packageName ?? PACKAGE_NAME
  const state = inspectProfile(profile, packageName, presetId)

  if (state.usable) return { changed: false, reason: 'still-installed', state }
  if (typeof state.patchText !== 'string') return { changed: false, reason: 'no-patch-file', state }

  const current = readSelectedDefault(state.patchText)
  if (current !== presetId) {
    return {
      changed: false,
      reason: current === null ? 'no-pointer' : `points-elsewhere:${current}`,
      state,
    }
  }

  const { text, changed } = rewriteSelectedDefault(state.patchText, presetId, fallbackId)
  if (!changed) return { changed: false, reason: 'rewrite-missed', state }

  writeTextAtomic(profile.patchPath, text)
  writeMemo(profile.memoPath, {
    presetId,
    fallbackId,
    clearedAt: new Date().toISOString(),
    note: '默认预设指针已回落到 fallbackId；重新启用本插件后会自动恢复。',
  })
  return { changed: true, reason: 'pointer-cleared', state, from: presetId, to: fallbackId }
}

/** Restore the user's pointer only when nobody else has chosen a preset since. */
export function restoreProfile(profile, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const packageName = options.packageName ?? PACKAGE_NAME
  const state = inspectProfile(profile, packageName, presetId)
  const memo = readMemo(profile.memoPath)
  if (memo === null) return { changed: false, reason: 'no-memo', state }
  if (!state.usable) return { changed: false, reason: 'still-unusable', state }
  if (typeof state.patchText !== 'string') return { changed: false, reason: 'no-patch-file', state }

  const fallbackId = typeof memo.fallbackId === 'string' ? memo.fallbackId : FALLBACK_PRESET_ID
  const current = readSelectedDefault(state.patchText)
  if (current !== fallbackId) {
    clearMemo(profile.memoPath)
    return { changed: false, reason: `user-chose:${current ?? 'none'}`, state }
  }

  const { text, changed } = rewriteSelectedDefault(state.patchText, fallbackId, presetId)
  if (!changed) {
    clearMemo(profile.memoPath)
    return { changed: false, reason: 'rewrite-missed', state }
  }
  writeTextAtomic(profile.patchPath, text)
  clearMemo(profile.memoPath)
  return { changed: true, reason: 'pointer-restored', state, from: fallbackId, to: presetId }
}

/** Uninstall-time forced clear: do this BEFORE deleting the package. */
export function forceClearPointer(profile, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const fallbackId = options.fallbackId ?? FALLBACK_PRESET_ID
  const text = readText(profile.patchPath)
  if (text === null) return { changed: false, reason: 'no-patch-file' }
  const current = readSelectedDefault(text)
  if (current !== presetId) {
    return { changed: false, reason: current === null ? 'no-pointer' : `points-elsewhere:${current}` }
  }
  const { text: next, changed } = rewriteSelectedDefault(text, presetId, fallbackId)
  if (!changed) return { changed: false, reason: 'rewrite-missed' }
  writeTextAtomic(profile.patchPath, next)
  return { changed: true, reason: 'pointer-cleared', from: presetId, to: fallbackId }
}

function detectIndent(text) {
  for (const line of text.split('\n')) {
    const match = /^( +)\S/.exec(line)
    if (match !== null) return match[1].length
  }
  return 2
}

/** Structured edit of profile package.json; writes only when mutate reports a change. */
export function editProfileManifest(profile, mutate) {
  const raw = readText(profile.manifestPath)
  if (raw === null) return { changed: false, reason: 'no-manifest' }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { changed: false, reason: 'manifest-not-json' }
  }
  let outcome
  try {
    outcome = mutate(parsed)
  } catch (error) {
    return { changed: false, reason: `mutate-failed:${(error && error.message) || error}` }
  }
  if (outcome?.changed !== true) return { changed: false, reason: outcome?.reason ?? 'no-change' }
  writeTextAtomic(profile.manifestPath, `${JSON.stringify(parsed, null, detectIndent(raw))}\n`)
  return { changed: true, reason: outcome.reason }
}

export function forEachProfile(home, action) {
  const results = []
  for (const profile of listProfiles(home)) {
    try {
      results.push({ profile: profile.name, ...action(profile) })
    } catch (error) {
      results.push({ profile: profile.name, changed: false, reason: `error:${(error && error.message) || error}` })
    }
  }
  return results
}

export function clearDanglingPointers(home, options = {}) {
  return forEachProfile(home, profile => repairProfile(profile, options))
}

export function restorePointers(home, options = {}) {
  return forEachProfile(home, profile => restoreProfile(profile, options))
}
