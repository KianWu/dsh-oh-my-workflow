#!/usr/bin/env node
/**
 * Static composition check: the bundle patch and the preset body agree with
 * each other and with package.json. These failures never make a loud error at
 * install time — they show up as "the preset is not in the roster" or "the
 * skills catalog is empty", so they must be caught here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const patchPath = join(ROOT, 'cordis.patch.yml')
const presetPath = join(ROOT, 'preset', 'agent.cordis.yml')
const presetDir = join(ROOT, 'preset')

const failures = []
const fail = (message, hint) => failures.push(hint ? `${message}\n    → ${hint}` : message)
const read = (path, label) => {
  if (!existsSync(path)) {
    fail(`${label} 不存在：${path.slice(ROOT.length + 1)}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

const patch = read(patchPath, 'cordis.patch.yml')
const preset = read(presetPath, 'preset/agent.cordis.yml')
const ops = read(join(presetDir, 'ops-integration.mjs'), 'preset/ops-integration.mjs')

// ---- 1. include path and loader anchors ----
const includeMatch = patch.match(/path:\s*"([^"]*agent\.cordis\.yml)"/)
if (!includeMatch) {
  fail('cordis.patch.yml 里没有找到指向 agent.cordis.yml 的 include 路径')
} else {
  const declared = includeMatch[1]
  const expected = `./node_modules/${pkg.name}/preset/agent.cordis.yml`
  if (declared !== expected) {
    fail(`include 路径与实际不符：声明 ${declared}，应为 ${expected}`, '包名或 preset/ 目录改名后必须同步')
  }
  const suffix = declared.replace(/^\.\/node_modules\/(?:@[^/]+\/)?[^/]+\//, '')
  if (!existsSync(join(ROOT, suffix))) fail(`include 路径的仓库内部分不存在：${suffix}`)
}

const guardRow = /^\s+- id:\s*workflow-uninstall-guard\s*$/m.test(patch)
if (!guardRow) {
  fail('cordis.patch.yml 缺少卸载守卫行（- id: workflow-uninstall-guard）', '停用/卸载后默认指针会悬空')
} else {
  const guardName = patch.match(/- id:\s*workflow-uninstall-guard\s*\n\s+name:\s*"([^"]+)"/)
  if (!guardName || guardName[1] !== './preset/uninstall-guard.mjs') {
    fail(`卸载守卫的模块路径应为 ./preset/uninstall-guard.mjs，实际 ${guardName?.[1] ?? '缺失'}`)
  } else if (!existsSync(join(ROOT, 'preset', 'uninstall-guard.mjs'))) {
    fail('preset/uninstall-guard.mjs 不存在')
  }
  const presetRowId = patch.match(/^\s+- id:\s*preset-([a-z0-9-]+)\s*$/m)
  const guardPresetId = patch.match(/^\s+presetId:\s*([a-z0-9-]+)\s*$/m)
  if (presetRowId !== null && guardPresetId !== null && presetRowId[1] !== guardPresetId[1]) {
    fail(`卸载守卫的 presetId（${guardPresetId[1]}）与预设声明行 id（${presetRowId[1]}）不一致`)
  }
  if (!/^\s+fallbackId:\s*standard\s*$/m.test(patch)) fail('卸载守卫的 fallbackId 应为 standard')
}

// ---- 2. preset metadata ----
const metadata = [
  ['id: workflow', /^\s+id:\s*workflow\s*$/m],
  ['name: Workflow', /^\s+name:\s*Workflow\s*$/m],
  ['order: 7', /^\s+order:\s*7\s*$/m],
]
for (const [label, pattern] of metadata) {
  if (!pattern.test(patch)) fail(`cordis.patch.yml 缺少或改动了 ${label}`, '这些值决定用户看到的预设名册')
}

// ---- 3. required preset rows ----
const requiredRows = [
  ['persona', '常驻人格'],
  ['agent-instructions', '项目规则注入'],
  ['ops-integration', 'OPS Native integration'],
  ['turn-guard', '轮次守卫'],
  ['skill-filesystem', '技能根'],
  ['tool-skill', '技能目录工具'],
  ['tool-fs', '文件工具'],
  ['tool-bash', 'shell（unix）'],
  ['tool-pwsh', 'shell（windows）'],
]
for (const [id, label] of requiredRows) {
  if (!new RegExp(`^- id:\\s*${id}\\s*$`, 'm').test(preset)) {
    fail(`preset/agent.cordis.yml 缺少 ${label} 行（- id: ${id}）`)
  }
}

// ---- 4. OPS integration uses only the public entry and the exact preset id ----
if (!/from 'dsh-ops\/integration'|import\('dsh-ops\/integration'\)/.test(ops)) fail('ops-integration.mjs 必须从 dsh-ops/integration 导入')
if (/dsh-ops\/lib\//.test(ops)) fail('ops-integration.mjs 不得导入 dsh-ops 私有 lib/* 路径')
if (!/preset:\s*'workflow'/.test(ops)) fail('ops-integration.mjs 的 preset 必须是 workflow')
if (!/replaceOfficial:\s*true/.test(ops)) fail('首版应去重官方 read/glob/grep（replaceOfficial: true）')
if (/hidePwsh:\s*true/.test(ops)) fail('首版必须保留宿主 PowerShell（hidePwsh: false）')
if (/id:\s*dsh-ops\s*$/m.test(patch)) fail('根补丁不得覆盖 dsh-ops 配置行')

// ---- 5. skills root and catalog cap ----
if (!/fileURLToPath\(new URL\('\.\/skills',\s*ctx\.baseUrl\)\)/.test(preset)) {
  fail('技能根不是从 ctx.baseUrl 推导的', "应形如 fileURLToPath(new URL('./skills', ctx.baseUrl))")
}
if (!/customSkillDirs:/.test(preset)) fail('技能根必须使用 customSkillDirs（追加而非替换）')
if (!existsSync(join(presetDir, 'skills'))) fail('preset/skills/ 目录不存在，挂载时会直接抛错')

const capMatch = preset.match(/catalogDescriptionMaxLength:\s*(\d+)/)
if (!capMatch) {
  fail('tool-skill 没有配置 catalogDescriptionMaxLength')
} else if (existsSync(join(presetDir, 'skills'))) {
  const cap = Number(capMatch[1])
  let longest = { length: 0, name: '' }
  for (const entry of readdirSync(join(presetDir, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(presetDir, 'skills', entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const head = readFileSync(file, 'utf8').slice(0, 4000)
    const match = head.match(/^description:\s*(.+)$/m)
    if (!match) continue
    const value = match[1].trim().replace(/^["'](.*)["']$/, '$1')
    if (value.length > longest.length) longest = { length: value.length, name: entry.name }
  }
  if (longest.length > cap) fail(`catalogDescriptionMaxLength=${cap} 会截断 ${longest.name}（${longest.length} 字符）`)
}

// ---- 6. package manifest bits that make the preset disappear if wrong ----
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch 应为 ./cordis.patch.yml')
if (!pkg.files?.includes('preset')) fail('files 白名单里没有 preset')
if (!pkg.files?.includes('cordis.patch.yml')) fail('files 白名单里没有 cordis.patch.yml')
if (pkg.peerDependencies?.['dsh-ops'] === undefined) fail('缺少 dsh-ops peer dependency')

if (failures.length === 0) {
  console.log('✅ 装配校验通过：补丁、预设本体、OPS 入口、技能根、manifest 一致')
  process.exit(0)
}
console.error(`\n❌ 装配校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
