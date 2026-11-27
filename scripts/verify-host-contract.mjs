#!/usr/bin/env node
/**
 * Host-contract check for the turn guard and lifecycle guard.
 *
 * These are private host contracts, not public APIs. When one changes, the
 * guard does not throw — it silently stops matching, which is worse. Each
 * assertion below names the exact source fragment the implementation relies on.
 *
 *   node scripts/verify-host-contract.mjs
 *   DSH_ROOT=<extracted app.asar>/dsh node scripts/verify-host-contract.mjs
 *
 * No readable DSH checkout prints SKIP and exits 0 (CI without DSH is normal).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CANDIDATES = [
  process.env.DSH_ROOT,
  join(ROOT, '..', '.tmp', 'dsh-asar', 'dsh'),
  'E:/Profession/DeepSeekHarness/resources/app.asar.unpacked/dsh',
].filter(candidate => typeof candidate === 'string' && candidate !== '')

const hostRoot = CANDIDATES.find(candidate => existsSync(join(candidate, 'node_modules', '@deepseek-ai')))
if (hostRoot === undefined) {
  console.log('SKIP 没找到可读的 DSH 安装；设置 DSH_ROOT=<app.asar 解包后的 dsh 目录> 后重跑')
  process.exit(0)
}

const PKG = join(hostRoot, 'node_modules', '@deepseek-ai')
let passed = 0
const failures = []
const check = (label, fn) => {
  try {
    const detail = fn()
    passed += 1
    console.log(`  ok  ${label}${detail ? `  ${detail}` : ''}`)
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`  FAIL ${label} — ${error instanceof Error ? error.message : String(error)}`)
  }
}
const source = (pkg, file) => {
  const path = join(PKG, pkg, file)
  if (!existsSync(path)) throw new Error(`读不到 ${pkg}/${file}（宿主包结构变了）`)
  return readFileSync(path, 'utf8')
}
const must = (haystack, needle, what) => {
  if (!haystack.includes(needle)) throw new Error(`没有找到 ${what}：\`${needle}\``)
}

const preset = readFileSync(join(ROOT, 'preset', 'agent.cordis.yml'), 'utf8')
const listOf = key => {
  const match = preset.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`))
  if (match === null) throw new Error(`preset/agent.cordis.yml 里没有 ${key}`)
  return match[1].split(',').map(item => item.trim()).filter(Boolean)
}

check('agent/turn-stopping is dispatched serially at turn close', () => {
  const text = source('dsh-agent-loop', 'lib/index.js')
  must(text, '"agent/turn-stopping"', '事件名')
  must(text, 'dispatch.serial("agent/turn-stopping"', 'serial dispatch')
  return 'dsh-agent-loop/lib/index.js'
})

check('the hook payload injects `agent`', () => {
  const text = source('dsh-agent', 'lib/types/dispatch.js')
  must(text, '...payload, agent', 'agent 注入表达式')
  return 'dsh-agent/lib/types/dispatch.js'
})

check('agent.steer exists and wakes next-step', () => {
  const text = source('dsh-agent-loop', 'lib/index.js')
  must(text, 'steer(input)', 'steer 方法')
  const at = text.indexOf('steer(input)')
  const body = text.slice(at, at + 260)
  if (!/send\(input,\s*"next-step",\s*true\)/.test(body)) {
    throw new Error('steer 的实现不再是 send(input, "next-step", true)，唤醒语义可能变了')
  }
  return 'steer -> next-step, wake=true'
})

check('session.snapshotEvents exists', () => {
  const text = source('dsh-session', 'lib/index.js')
  must(text, 'snapshotEvents(', '方法定义')
  return 'dsh-session/lib/index.js'
})

check('official mutation tools are registered by dsh-tool-fs', () => {
  const text = source('dsh-tool-fs', 'lib/index.js')
  const registered = new Set()
  for (const match of text.matchAll(/^\s+name: "([a-z_]+)",$/gm)) registered.add(match[1])
  const official = listOf('mutationTools').filter(name => !name.startsWith('ops_'))
  const unknown = official.filter(name => !registered.has(name))
  if (unknown.length > 0) throw new Error(`${unknown.join(', ')} 不在 dsh-tool-fs 的注册工具里（现有：${[...registered].join(', ')}）`)
  return official.join(', ')
})

check('shell check tools are registered by the host', () => {
  const registered = new Set()
  for (const pkg of ['dsh-tool-bash', 'dsh-tool-pwsh']) {
    const text = source(pkg, 'lib/index.js')
    for (const match of text.matchAll(/^\s+name: "(bash|pwsh)",$/gm)) registered.add(match[1])
  }
  const declared = listOf('checkTools').filter(name => !name.startsWith('ops_'))
  const unknown = declared.filter(name => !registered.has(name))
  if (unknown.length > 0) throw new Error(`${unknown.join(', ')} 不在宿主的 shell 工具里（现有：${[...registered].join(', ')}）`)
  return declared.join(', ')
})

// OPS names are optional here: the host contract file must pass on a machine
// without dsh-ops, while the OPS integration check covers the dsh-ops side.
const opsDir = [
  process.env.DSH_OPS_DIR,
  process.env.DSH_PROFILE_DIR ? join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-ops') : undefined,
  join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-ops'),
].filter(Boolean).find(candidate => existsSync(join(candidate, 'package.json')))

if (opsDir !== undefined) {
  const registryEntry = join(opsDir, 'lib', 'capabilities', 'registry.js')
  if (existsSync(registryEntry)) {
    const { FILE_MUTATIONS, IN_PROCESS_TOOLS } = await import(pathToFileURL(registryEntry).href)
    check('OPS mutation names match dsh-ops capabilities', () => {
      const declared = listOf('mutationTools').filter(name => name.startsWith('ops_')).map(name => name.slice(4))
      const unknown = declared.filter(name => !FILE_MUTATIONS.includes(name))
      if (unknown.length > 0) throw new Error(`${unknown.join(', ')} 不在 dsh-ops 的文件变更能力里（现有：${FILE_MUTATIONS.join(', ')}）`)
      return declared.join(', ')
    })
    check('ops_bash maps to the dsh-ops shell capability', () => {
      if (!IN_PROCESS_TOOLS.includes('bash')) throw new Error('dsh-ops 的 shell 能力里没有 bash')
      if (!listOf('checkTools').includes('ops_bash')) throw new Error('preset 的 checkTools 里没有 ops_bash')
      return 'ops_bash'
    })
  }
} else {
  console.log('  ·  跳过 OPS 名称校验（未找到 dsh-ops）')
}

check('every {{variable}} used by the preset is registered', () => {
  const loopText = source('dsh-agent-loop', 'lib/index.js')
  const registered = new Set()
  for (const match of loopText.matchAll(/systemPrompt\.variable\("([^"]+)"/g)) registered.add(match[1])
  if (registered.size === 0) throw new Error('抓不到任何 prompt variable，抓取方式可能已失效')
  const live = preset.split('\n').filter(line => !/^\s*#/.test(line)).join('\n')
  const used = [...live.matchAll(/\{\{([^}]*)\}\}/g)].map(match => match[1].trim())
  const unknown = used.filter(name => !registered.has(name))
  if (unknown.length > 0) throw new Error(`预设引用了未注册变量：${unknown.join(', ')}（宿主只有：${[...registered].join(', ')}）`)
  return used.length === 0 ? '未使用模板变量' : [...new Set(used)].join(', ')
})

check('cordis effect runs disposers at fiber dispose', () => {
  const text = source('cordis', 'lib/index.js')
  must(text, 'effect(execute, label = "anonymous")', 'effect 方法')
  must(text, 'runDisposable(disposable)', 'dispose 执行入口')
  return '@deepseek-ai/cordis/lib/index.js'
})

check('plugin-manager selectBundle does not clear selectedDefault', () => {
  const text = source('dsh-plugin-manager', 'lib/index.js')
  const at = text.indexOf('async selectBundle(')
  if (at === -1) throw new Error('找不到 selectBundle，宿主插件管理器结构变了')
  const body = text.slice(at, at + 2000)
  if (body.includes('selectedDefault')) throw new Error('selectBundle 现在会写 selectedDefault —— lifecycle 说明需要更新')
  return 'selectBundle 只改 dsh.profile.bundles'
})

check('compaction engine is mounted before the directive override runs', () => {
  // `workflow-compaction` reads `ctx.get('compaction')`, so the row that
  // provides the engine must come first in the same group. Reversing the two
  // rows would leave the group with no backend and no warning at install time.
  const group = preset.slice(preset.indexOf('- id: compaction\n'))
  const engineAt = group.indexOf("name: '@deepseek-ai/dsh-compaction-basic'")
  const patchAt = group.indexOf('name: ./compaction.mjs')
  if (engineAt === -1) throw new Error('compaction 组里没有宿主引擎行')
  if (patchAt === -1) throw new Error('compaction 组里没有 ./compaction.mjs 行')
  if (patchAt < engineAt) throw new Error('./compaction.mjs 必须排在宿主引擎之后，否则取不到引擎实例')
  return 'engine -> directive override'
})

check('compaction service name is `compaction`', () => {
  const text = source('dsh-compaction', 'lib/index.js')
  must(text, 'super(ctx, "compaction")', 'CompactionEngine 的 service 名')
  return 'ctx.compaction'
})

if (failures.length === 0) {
  console.log(`\n✅ 宿主契约校验通过（${passed} 项）：守卫依赖的事件、steer、事件日志与生命周期缺口仍在`)
  process.exit(0)
}
console.error(`\n❌ 宿主契约校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
