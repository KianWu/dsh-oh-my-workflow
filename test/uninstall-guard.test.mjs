/**
 * Lifecycle checks: the pointer repair/restore rules and the CLI that wraps
 * them. The important property is inverse safety — normal exit changes nothing,
 * disable/uninstall clears only our own pointer, and a later re-enable restores
 * it only when the user has not chosen something else.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  PRESET_ID,
  PACKAGE_NAME,
  GUARD_MEMO,
  forceClearPointer,
  inspectProfile,
  listProfiles,
  readSelectedDefault,
  repairProfile,
  restoreProfile,
  rewriteSelectedDefault,
} from '../preset/lifecycle.mjs'
import { apply as applyGuard } from '../preset/uninstall-guard.mjs'
import { commandDoctor, commandStatus, commandUninstall } from '../bin/oh-my-workflow.mjs'

let passed = 0
const check = (label, fn) => {
  fn()
  console.log(`  ok  ${label}`)
  passed += 1
}

function quiet(fn) {
  const messages = []
  const original = console.log
  console.log = (...args) => messages.push(args.join(' '))
  try {
    return { value: fn(), messages }
  } finally {
    console.log = original
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function setupHome(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'oh-my-workflow-home-'))
  const profileDir = join(home, 'profiles', 'desktop')
  const packageDir = join(profileDir, 'node_modules', ...PACKAGE_NAME.split('/'))
  writeJson(join(packageDir, 'package.json'), { name: PACKAGE_NAME, version: '0.1.0' })
  const manifest = {
    name: 'profile-check',
    private: true,
    dependencies: options.dependency === false ? {} : { [PACKAGE_NAME]: 'link:.' },
    dsh: { profile: { bundles: options.bundle === false ? [] : [PACKAGE_NAME] } },
  }
  writeJson(join(profileDir, 'package.json'), manifest)
  const pointer = options.pointer ?? 'workflow'
  const disabledRow = options.disabled === true
    ? `- id: preset-workflow\n  name: "@deepseek-ai/dsh-agent-preset"\n  disabled: true\n`
    : ''
  writeFileSync(join(profileDir, 'cordis.patch.yml'), `# keep formatting\n- id: agent-preset-registry\n  config:\n    default: standard\n    selectedDefault: ${pointer}\n${disabledRow}- id: ui-theme\n  config:\n    fontSize: 14\n`)
  return { home, profileDir, packageDir }
}

function cleanup(home) {
  rmSync(home, { recursive: true, force: true })
}

check('readSelectedDefault reads only the registry row value', () => {
  const { home, profileDir } = setupHome()
  try {
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'workflow')
  } finally { cleanup(home) }
})

check('rewriteSelectedDefault preserves comments, indentation and neighbours', () => {
  const text = '# keep formatting\n- id: agent-preset-registry\n  config:\n    default: standard\n    selectedDefault: workflow\n- id: ui-theme\n  config:\n    fontSize: 14\n'
  const result = rewriteSelectedDefault(text, 'workflow', 'standard')
  assert.equal(result.changed, true)
  assert.match(result.text, /^# keep formatting/)
  assert.match(result.text, /selectedDefault: standard/)
  assert.match(result.text, /fontSize: 14/)
})

check('inspectProfile: usable only when package, bundle and enabled row all agree', () => {
  const { home, profileDir } = setupHome()
  const other = setupHome({ bundle: false })
  try {
    const usable = inspectProfile({ name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), manifestPath: join(profileDir, 'package.json'), memoPath: join(profileDir, GUARD_MEMO) })
    assert.equal(usable.usable, true)
    const not = inspectProfile({ name: 'other', dir: other.profileDir, patchPath: join(other.profileDir, 'cordis.patch.yml'), manifestPath: join(other.profileDir, 'package.json'), memoPath: join(other.profileDir, GUARD_MEMO) })
    assert.equal(not.usable, false)
  } finally { cleanup(home); cleanup(other.home) }
})

check('repair does nothing while the bundle is usable', () => {
  const { home, profileDir } = setupHome()
  try {
    const profile = { name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), manifestPath: join(profileDir, 'package.json'), memoPath: join(profileDir, GUARD_MEMO) }
    const result = repairProfile(profile)
    assert.equal(result.changed, false)
    assert.equal(result.reason, 'still-installed')
    assert.equal(readSelectedDefault(readFileSync(profile.patchPath, 'utf8')), 'workflow')
  } finally { cleanup(home) }
})

check('repair clears a dangling pointer and leaves a memo; second repair is idempotent', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    rmSync(packageDir, { recursive: true, force: true })
    const profile = { name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), manifestPath: join(profileDir, 'package.json'), memoPath: join(profileDir, GUARD_MEMO) }
    const first = repairProfile(profile)
    assert.equal(first.changed, true)
    assert.equal(readSelectedDefault(readFileSync(profile.patchPath, 'utf8')), 'standard')
    assert.ok(existsSync(profile.memoPath))
    const second = repairProfile(profile)
    assert.equal(second.changed, false)
    assert.equal(second.reason, 'points-elsewhere:standard')
    const text = readFileSync(profile.patchPath, 'utf8')
    assert.match(text, /^# keep formatting/)
    assert.match(text, /fontSize: 14/)
  } finally { cleanup(home) }
})

check('restore brings the pointer back after re-enable and clears the memo', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    rmSync(packageDir, { recursive: true, force: true })
    const profile = { name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), manifestPath: join(profileDir, 'package.json'), memoPath: join(profileDir, GUARD_MEMO) }
    repairProfile(profile)
    writeJson(join(packageDir, 'package.json'), { name: PACKAGE_NAME, version: '0.1.0' })
    const restored = restoreProfile(profile)
    assert.equal(restored.changed, true)
    assert.equal(readSelectedDefault(readFileSync(profile.patchPath, 'utf8')), 'workflow')
    assert.equal(existsSync(profile.memoPath), false)
  } finally { cleanup(home) }
})

check('restore does not overwrite a preset the user chose while away', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    rmSync(packageDir, { recursive: true, force: true })
    const profile = { name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), manifestPath: join(profileDir, 'package.json'), memoPath: join(profileDir, GUARD_MEMO) }
    repairProfile(profile)
    const text = readFileSync(profile.patchPath, 'utf8')
    writeFileSync(profile.patchPath, text.replace('selectedDefault: standard', 'selectedDefault: ops-ptc'))
    writeJson(join(packageDir, 'package.json'), { name: PACKAGE_NAME, version: '0.1.0' })
    const restored = restoreProfile(profile)
    assert.equal(restored.changed, false)
    assert.match(restored.reason, /user-chose:ops-ptc/)
    assert.equal(readSelectedDefault(readFileSync(profile.patchPath, 'utf8')), 'ops-ptc')
    assert.equal(existsSync(profile.memoPath), false)
  } finally { cleanup(home) }
})

check('forceClearPointer clears even when the bundle is usable', () => {
  const { home, profileDir } = setupHome()
  try {
    const profile = { name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml') }
    const result = forceClearPointer(profile)
    assert.equal(result.changed, true)
    assert.equal(readSelectedDefault(readFileSync(profile.patchPath, 'utf8')), 'standard')
  } finally { cleanup(home) }
})

check('uninstall guard reconciles on load when the package is gone', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    rmSync(packageDir, { recursive: true, force: true })
    const warnings = []
    const ctx = { logger: { warn: m => warnings.push(m), info: () => {} }, effect: () => {} }
    applyGuard(ctx, { dshHome: home, presetId: PRESET_ID, fallbackId: 'standard', packageName: PACKAGE_NAME })
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'standard')
    assert.equal(warnings.length, 1)
  } finally { cleanup(home) }
})

check('uninstall guard changes nothing on a normal load', () => {
  const { home, profileDir } = setupHome()
  try {
    const disposers = []
    const ctx = { logger: { warn: () => {}, info: () => {} }, effect: fn => disposers.push(fn) }
    applyGuard(ctx, { dshHome: home, presetId: PRESET_ID, fallbackId: 'standard', packageName: PACKAGE_NAME })
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'workflow')
    for (const disposer of disposers) disposer()
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'workflow')
  } finally { cleanup(home) }
})

check('CLI status --json reports the selected pointer', () => {
  const { home } = setupHome()
  try {
    const { value: code, messages } = quiet(() => commandStatus(home, listProfiles(home), { json: true }))
    assert.equal(code, 0)
    const parsed = JSON.parse(messages.join('\n'))
    assert.equal(parsed.profiles[0].selectedDefault, 'workflow')
    assert.equal(parsed.profiles[0].usable, true)
  } finally { cleanup(home) }
})

check('CLI doctor --fix --dry-run reports but does not write', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    rmSync(packageDir, { recursive: true, force: true })
    const { value: code } = quiet(() => commandDoctor(home, listProfiles(home), { fix: true, dryRun: true, json: false }))
    assert.equal(code, 1)
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'workflow')
  } finally { cleanup(home) }
})

check('CLI doctor --fix repairs a dangling pointer', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    rmSync(packageDir, { recursive: true, force: true })
    const { value: code } = quiet(() => commandDoctor(home, listProfiles(home), { fix: true, dryRun: false, json: false }))
    assert.equal(code, 0)
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'standard')
  } finally { cleanup(home) }
})

check('CLI uninstall --dry-run writes nothing', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    const { value: code } = quiet(() => commandUninstall(home, listProfiles(home), { dryRun: true, json: false }))
    assert.equal(code, 0)
    assert.ok(existsSync(join(packageDir, 'package.json')))
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'workflow')
  } finally { cleanup(home) }
})

check('CLI uninstall clears pointer, manifest rows and package directory', () => {
  const { home, profileDir, packageDir } = setupHome()
  try {
    const { value: code } = quiet(() => commandUninstall(home, listProfiles(home), { dryRun: false, json: false }))
    assert.equal(code, 0)
    assert.equal(readSelectedDefault(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')), 'standard')
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, [])
    assert.equal(manifest.dependencies[PACKAGE_NAME], undefined)
    assert.equal(existsSync(packageDir), false)
  } finally { cleanup(home) }
})

console.log(`\n${passed} checks passed`)
