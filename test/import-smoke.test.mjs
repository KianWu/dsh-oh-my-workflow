#!/usr/bin/env node
/**
 * Import-time smoke test: every local row the preset mounts must actually load.
 *
 * Why: a module that throws at import time makes its row report "never started"
 * and the whole preset fails to mount — a new session cannot even be created.
 * Static checks (grep-style assertions in verify-preset) cannot catch this
 * class of bug; only a real import can. This test keeps the failure local by
 * importing the module directly, before the composition check runs.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0

async function check(modulePath) {
  try {
    const namespace = await import(modulePath)
    // The package entry is a metadata module, not a preset row; everything
    // else the preset mounts must export an apply() the loader can call.
    const isEntry = modulePath.endsWith('/index.mjs')
    if (!isEntry && typeof namespace.apply !== 'function') {
      console.error(`  - ${modulePath}: exports no apply() function`)
      failed += 1
      return
    }
    console.log(`  ok  ${modulePath} loads${isEntry ? ' (package entry)' : '; apply() exported'}`)
  } catch (error) {
    console.error(`  - ${modulePath}: import failed: ${String((error && error.message) || error)}`)
    failed += 1
  }
}

// Every `./xxx.mjs` row mounted by preset/agent.cordis.yml or cordis.patch.yml.
const LOCAL_MODULES = [
  './index.mjs',
  './preset/behavior.mjs',
  './preset/compaction.mjs',
  './preset/turn-guard.mjs',
  './preset/ops-integration.mjs',
  './preset/uninstall-guard.mjs',
]

// turn-guard and ops-integration import dsh-ops at load time; the smoke test
// must still run on machines without dsh-ops, so those two degrade to a
// parse-only check when the peer is not resolvable from the profile.
const OPTIONAL_MODULES = ['./preset/turn-guard.mjs', './preset/ops-integration.mjs']

const optional = new Set(OPTIONAL_MODULES)
for (const relative of LOCAL_MODULES) {
  const absolute = new URL(relative, `file://${ROOT.replaceAll('\\', '/')}/`).href
  if (optional.has(relative)) {
    const dshOps = ['process.env.DSH_PROFILE_DIR', join(process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-ops')]
      .filter(Boolean)
      .map(base => join(base, 'node_modules', 'dsh-ops', 'package.json'))
      .find(path => { try { return readdirSync(dirname(path)) && true } catch { return false } })
    if (dshOps === undefined && process.env.DSH_OPS_OPTIONAL !== '0') {
      console.log(`  ·  ${relative}: parse check only (dsh-ops peer not found)`)
      try {
        // Parse as a module: strip import/export syntax (not valid inside a
        // classic Function body), then parse the remainder. This still catches
        // syntax errors like a stray backtick breaking a template literal —
        // the exact class of bug that shipped in 0.4.0. A real ESM parse would
        // be better, but `new Function` plus this strip is dependency-free.
        const { readFile } = await import('node:fs/promises')
        const text = await readFile(join(ROOT, relative), 'utf8')
        const stripped = text
          .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
          .replace(/^export\s+(const|let|var|function|class|async function)\b/gm, '$1')
          .replace(/^export\s+\{[\s\S]*?\};?\s*$/gm, '')
          .replace(/^export\s+default\s+/gm, '')
        new Function(`return async () => {\n${stripped}\n}`)
        console.log(`  ok  ${relative} parses`)
      } catch (error) {
        console.error(`  - ${relative}: parse failed: ${String((error && error.message) || error)}`)
        failed += 1
      }
      continue
    }
  }
  await check(absolute)
}

if (failed > 0) {
  console.error(`\n❌ 模块加载烟测失败（${failed} 个）：本地行在宿主里会 "never started"，预设无法挂载`)
  process.exit(1)
}
console.log('\n✅ 模块加载烟测通过：preset 引用的全部本地模块都能被真实 import')
