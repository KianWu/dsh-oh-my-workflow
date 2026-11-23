#!/usr/bin/env node
/**
 * Skill pack check: 22 named skills, frontmatter that will actually enter the
 * catalog, descriptions the catalog cap will not truncate, working relative
 * links, and source/licence records for every skill.
 *
 * These are the failures that install silently: a missing frontmatter field
 * hides one skill from the catalog, a wrong directory name breaks `/name`
 * gestures, and a missing side file breaks the instruction that links to it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'preset', 'skills')
const PRESET = join(ROOT, 'preset', 'agent.cordis.yml')
const SOURCES = join(ROOT, 'preset', 'skill-sources.json')

const EXPECTED = [
  'wf-route', 'wf-project-init', 'wf-engineering',
  'grilling', 'grill-with-docs', 'codebase-design', 'domain-modeling',
  'improve-codebase-architecture', 'to-spec', 'to-tickets', 'wayfinder',
  'implement', 'implement-spec', 'code-review', 'handoff',
  'st-plan-loop', 'st-verify-loop', 'st-unstick', 'st-review-loop',
  'st-ledger', 'st-context-reset', 'st-ready',
]

const failures = []
const notes = []
const fail = (message, hint) => failures.push(hint ? `${message}\n    → ${hint}` : message)

if (!existsSync(SKILLS)) {
  console.error('❌ preset/skills/ 不存在')
  process.exit(1)
}

const cap = Number((readFileSync(PRESET, 'utf8').match(/catalogDescriptionMaxLength:\s*(\d+)/) ?? [])[1] ?? 0)
if (!Number.isInteger(cap) || cap <= 0) fail('读不到 catalogDescriptionMaxLength')

function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) return null
  const raw = match[1].trim()
  try {
    // Frontmatter is YAML-ish; unquote simple JSON strings so escaped quotes count as one.
    if (raw.startsWith('"') && raw.endsWith('"')) return JSON.parse(raw)
  } catch { /* fall through to the plain unquote */ }
  return raw.replace(/^["'](.*)["']$/, '$1')
}

const dirs = readdirSync(SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const expectedSorted = [...EXPECTED].sort()

if (dirs.join(',') !== expectedSorted.join(',')) {
  const missing = expectedSorted.filter(name => !dirs.includes(name))
  const extra = dirs.filter(name => !expectedSorted.includes(name))
  if (missing.length > 0) fail(`缺少技能目录：${missing.join(', ')}`)
  if (extra.length > 0) fail(`多出未列入核心集的技能目录：${extra.join(', ')}`)
}

const byName = new Map()
let totalChars = 0
let longest = { length: 0, name: '' }

for (const dir of dirs) {
  const dirPath = join(SKILLS, dir)
  const skillFile = join(dirPath, 'SKILL.md')
  if (!existsSync(skillFile)) {
    fail(`preset/skills/${dir}/ 里没有 SKILL.md`)
    continue
  }
  const text = readFileSync(skillFile, 'utf8')
  if (!text.startsWith('---')) {
    fail(`preset/skills/${dir}/SKILL.md 没有 frontmatter`)
    continue
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) {
    fail(`preset/skills/${dir}/SKILL.md 的 frontmatter 没有闭合`)
    continue
  }
  const front = text.slice(0, end)
  const name = frontmatterValue(front, 'name')
  const description = frontmatterValue(front, 'description')

  if (!name) fail(`preset/skills/${dir}/SKILL.md 缺少 name`)
  else if (name !== dir) fail(`目录名与 frontmatter name 不一致：${dir} ≠ ${name}`)
  else {
    if (byName.has(name)) fail(`技能名重复：${name}`)
    byName.set(name, dir)
  }

  if (!description) fail(`preset/skills/${dir}/SKILL.md 缺少 description`, '没有描述就不会进 catalog')
  else {
    totalChars += description.length
    if (description.length > longest.length) longest = { length: description.length, name: dir }
    if (cap > 0 && description.length > cap) {
      fail(`preset/skills/${dir} 的描述 ${description.length} 字符，超过上限 ${cap}`, '超长会截断末尾的触发条件')
    }
  }

  // Relative links must resolve inside the copied skill directory.
  for (const match of text.matchAll(/\]\((\.\/[^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = join(dirPath, match[1])
    if (!existsSync(target)) fail(`preset/skills/${dir}/SKILL.md 链接不存在：${match[1]}`)
  }
}

// ---- cross references we own ----
const referenced = new Set()
for (const dir of dirs) {
  const file = join(SKILLS, dir, 'SKILL.md')
  if (!existsSync(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/[`\s(]\/((?:wf|st)-[a-z0-9][a-z0-9-]*)/g)) {
    referenced.add(match[1])
    if (!byName.has(match[1])) fail(`preset/skills/${dir}/SKILL.md 引用了不存在的技能 /${match[1]}`)
  }
  if (text.includes('/setup-matt-pocock-skills')) {
    fail(`preset/skills/${dir}/SKILL.md 仍引用未随包的 /setup-matt-pocock-skills`)
  }
  if (/Skill tool with [`"]tdd[`"]/.test(text)) {
    fail(`preset/skills/${dir}/SKILL.md 仍调用未随包的 tdd 技能`)
  }
}

// ---- sources manifest ----
if (!existsSync(SOURCES)) fail('preset/skill-sources.json 不存在')
else {
  let sources = null
  try {
    sources = JSON.parse(readFileSync(SOURCES, 'utf8'))
  } catch {
    fail('preset/skill-sources.json 不是合法 JSON')
  }
  if (sources !== null) {
    for (const name of EXPECTED) {
      const entry = sources.skills?.[name]
      if (!entry) {
        fail(`skill-sources.json 缺少 ${name}`)
        continue
      }
      if (!entry.source) fail(`skill-sources.json 的 ${name} 缺少 source`)
      if (!entry.license) fail(`skill-sources.json 的 ${name} 缺少 license`)
      if (entry.source !== 'original' && !entry.repository) fail(`skill-sources.json 的 ${name} 缺少 repository`)
    }
  }
}

// ---- no stray non-skill content ----
for (const dir of dirs) {
  if (!existsSync(join(SKILLS, dir, 'SKILL.md'))) notes.push(`  （${dir} 没有 SKILL.md，已按非技能目录跳过）`)
}

notes.unshift(`  技能数：${byName.size}/${EXPECTED.length}，描述合计 ${totalChars} 字符（≈${Math.round(totalChars / 4)} token），最长 ${longest.name} ${longest.length} 字符（上限 ${cap}）`)
notes.unshift(`  交叉引用：${referenced.size} 个自有 /wf-* /st-* 手势`)
for (const note of notes) console.log(note)

if (failures.length === 0) {
  console.log('✅ 技能目录校验通过：22 个技能、命名、描述长度、相对链接与来源记录一致')
  process.exit(0)
}
console.error(`\n❌ 技能目录校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
