#!/usr/bin/env node
/**
 * Sync the 19 upstream skills into preset/skills/ and regenerate
 * preset/skill-sources.json.
 *
 * Sources are explicit local mirrors, never a network fetch: the workflow
 * bundle must build offline and must not silently change when an upstream repo
 * moves. `--check` compares without writing, so CI and release review can prove
 * the checked-in skills match their recorded sources.
 *
 * Local adaptations are declared here, not hand-edited, so they can be replayed:
 *   - remove references to `/setup-matt-pocock-skills` (not shipped);
 *   - point local tracker fallbacks at `.agent/workflow/`;
 *   - replace the missing `tdd` skill with an inline test-first instruction.
 *
 *   node scripts/sync-skills.mjs
 *   node scripts/sync-skills.mjs --check
 *   MATT_SKILLS_DIR=... STACK_SKILLS_DIR=... node scripts/sync-skills.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'preset', 'skills')
const SOURCES = join(ROOT, 'preset', 'skill-sources.json')
const CHECK = process.argv.includes('--check')

const MATT_DIR = process.env.MATT_SKILLS_DIR
  ?? join(homedir(), '.config', 'magpie', 'library', 'skills')
const STACK_DIR = process.env.STACK_SKILLS_DIR
  ?? join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-stack', 'preset', 'skills')

const MATT_COMMIT = '5863806dd4e15c63174bee4e7515a4256792ecfa'
const STACK_VERSION = '0.3.3'

const SETUP_LINE = 'The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.'
const SETUP_LINE_SHORT = 'The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.'
const TRACKER_LINE = '如果项目已配置 issue tracker，按项目约定使用它；如果没有，使用本地 markdown tracker：把内容写入 `.agent/workflow/`（specs、tickets、plans 三个目录按需创建），并在 `.agent/AGENTS.md` 的「文档与过程记录位置」中说明。'

/**
 * Catalog-only descriptions. Full upstream description text stays available in
 * the source mirror and in each skill body; the catalog gets one short trigger
 * line to keep the durable prefix small.
 */
const SHORT_DESCRIPTIONS = {
  'wf-route': 'Workflow 三档路由与长任务分支。Use when starting a task or when size/risk is unclear.',
  'wf-project-init': '初始化或补充 .agent/AGENTS.md 与 .agent/workflow 记录布局。Use when a code project lacks an entry document.',
  'wf-engineering': '通用开发基线：复用、根因、最小 diff、显式边界与验证证据。Use when implementing or closing a task.',
  grilling: '就一个计划/决定/想法连续追问直到共识。Use when the user asks to grill or stress-test thinking.',
  'grill-with-docs': '边追问边产出 ADR 与术语表。Use when grilling should also write design docs.',
  'codebase-design': '深模块设计词汇：模块、接口、深度、接缝、适配器。Use when designing or reviewing module boundaries.',
  'domain-modeling': '打磨领域模型、统一语言、CONTEXT.md 与 ADR。Use when defining terms or recording design decisions.',
  'improve-codebase-architecture': '扫描代码库找深模块机会并产出 HTML 报告。Use when the user wants architecture improvement candidates.',
  'to-spec': '把当前对话综合成规格并发布到 tracker 或 .agent/workflow/specs。Use when turning discussion into a spec.',
  'to-tickets': '把计划/规格拆成带阻塞边的 tracer-bullet 工单。Use when breaking work into tickets.',
  wayfinder: '把超大工作规划成决策地图并逐个消解。Use when work exceeds one agent session.',
  implement: '按规格或工单实现并验证。Use when a spec or tickets are ready to build.',
  'implement-spec': '实现 /to-spec 与 /to-tickets 的产物。Use when implementing published specs and tickets.',
  'code-review': '从 Standards 与 Spec 两轴并行评审 diff。Use when reviewing a branch, PR, or work-in-progress.',
  handoff: '把当前对话压缩成交接文档。Use when another agent or session will continue the work.',
  'st-plan-loop': '写带验收检查的编号计划，冷评审后执行。Use when a task needs a short plan loop.',
  'st-verify-loop': '改—跑真检查—读报错—修根因—再跑。Use when changes need verification until green.',
  'st-unstick': '重复失败时找出共同前提并换路径。Use when the same fix fails twice.',
  'st-review-loop': '作者视角 + 新上下文评审，最多四轮。Use when changes need review until aligned.',
  'st-ledger': '长跑决策日志，每步前读回。Use when a long task needs durable decisions.',
  'st-context-reset': '维护 PROGRESS.md 供新会话继续。Use when handing long work to a new session.',
  'st-ready': '做到可合由人点合并，检查交付前状态。Use when preparing work for human merge.',
}

function setDescription(text, description) {
  if (!description) return text
  if (!/^description:\s*.*$/m.test(text)) throw new Error('SKILL.md 缺少 description 行')
  return text.replace(/^description:\s*.*$/m, `description: ${JSON.stringify(description)}`)
}

const MATT_SKILLS = {
  grilling: { path: 'skills/productivity/grilling', adaptations: [] },
  'grill-with-docs': { path: 'skills/engineering/grill-with-docs', adaptations: [] },
  'codebase-design': { path: 'skills/engineering/codebase-design', adaptations: [] },
  'domain-modeling': {
    path: 'skills/engineering/domain-modeling',
    adaptations: [[
      '## File structure\n\nMost repos have a single context:',
      '## File structure\n\n使用 workflow 预设且项目没有既有布局时，把 `CONTEXT.md` 放在 `.agent/workflow/CONTEXT.md`，ADR 放在 `.agent/workflow/adr/`；项目已有 `CONTEXT.md` / `docs/adr/` 时遵循既有布局。\n\nMost repos have a single context:',
    ]],
  },
  'improve-codebase-architecture': { path: 'skills/engineering/improve-codebase-architecture', adaptations: [] },
  'to-spec': {
    path: 'skills/engineering/to-spec',
    adaptations: [
      [SETUP_LINE, TRACKER_LINE],
      [
        '3. Write the spec using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.',
        '3. Write the spec using the template below, then publish it to the configured tracker; if none is configured, write it to `.agent/workflow/specs/<feature-slug>.md` (create the directory). Apply the `ready-for-agent` triage label - no need for additional triage.',
      ],
    ],
  },
  'to-tickets': {
    path: 'skills/engineering/to-tickets',
    adaptations: [
      [SETUP_LINE, TRACKER_LINE],
      [
        'Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured; the tickets are the same either way, only the shape of the blocking edges changes:',
        'Publish the approved tickets. **How** depends on the configured tracker. 没有配置时使用本地 markdown tracker：一个 ticket 一个文件，放在 `.agent/workflow/tickets/<feature-slug>/`，从 `01` 开始按依赖顺序编号。两种方式下 ticket 内容相同，只是阻塞边的表达不同：',
      ],
      ['.scratch/<feature-slug>/issues/<NN>-<slug>.md', '.agent/workflow/tickets/<feature-slug>/<NN>-<slug>.md'],
    ],
  },
  implement: {
    path: 'skills/engineering/implement',
    adaptations: [[
      'Call the Skill tool with "tdd" where possible, at pre-agreed seams.',
      '在预先约定的接缝处先写一条能因正确原因失败的测试（如果项目有测试框架）；没有测试框架时直接做最小实现，并用真实命令验证。不要为了形式新建测试框架。',
    ]],
  },
  'implement-spec': {
    path: 'skills/engineering/implement-spec',
    adaptations: [
      [SETUP_LINE_SHORT, TRACKER_LINE],
      [
        '   - calls the Skill tool with `tdd` to build the ticket;',
        '   - 先写/更新能证明该工单的测试或最小复现，再做最小实现；没有测试框架时直接实现并用真实命令验证；',
      ],
    ],
  },
  'code-review': {
    path: 'skills/engineering/code-review',
    adaptations: [
      [SETUP_LINE_SHORT, TRACKER_LINE],
      ['A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.', 'A spec file under `docs/`, `specs/`, `.agent/workflow/specs/`, or `.scratch/` matching the branch name or feature.'],
    ],
  },
  wayfinder: {
    path: 'skills/engineering/wayfinder',
    adaptations: [[
      '**Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific.** The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if not. Consult the tracker doc\'s "Wayfinding operations" section for how _this_ repo expresses them. If no tracker has been provided, default to the local-markdown tracker.',
      '**Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific.** 如果项目没有配置 tracker，使用本地 markdown tracker：map 写入 `.agent/workflow/plans/<name>-map.md`，decision tickets 写入 `.agent/workflow/tickets/<name>/`，阻塞边用文件内的文本表达。如果项目已有 tracker，按其 "Wayfinding operations" 惯例执行。',
    ]],
  },
  handoff: { path: 'skills/productivity/handoff', adaptations: [] },
}

const STACK_SKILLS = [
  'st-plan-loop',
  'st-verify-loop',
  'st-unstick',
  'st-review-loop',
  'st-ledger',
  'st-context-reset',
  'st-ready',
]

const EXCLUDED_NAMES = new Set(['_user_meta.json', '.DS_Store'])

function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function applyAdaptations(text, adaptations, label = '') {
  let output = text.replace(/\r\n/g, '\n')
  for (const [find, replace] of adaptations) {
    if (!output.includes(find)) {
      throw new Error(`${label} 适配锚点不存在：${find.slice(0, 80)}...`)
    }
    output = output.split(find).join(replace)
  }
  return output
}

function copySkill(sourceDir, destDir, adaptations, label = '', shortDescription = null) {
  for (const sourceFile of listFiles(sourceDir)) {
    const rel = relative(sourceDir, sourceFile)
    const destFile = join(destDir, rel)
    mkdirSync(dirname(destFile), { recursive: true })
    if (rel === 'SKILL.md') {
      let text = readFileSync(sourceFile, 'utf8')
      if (adaptations.length > 0) text = applyAdaptations(text, adaptations, label)
      writeFileSync(destFile, setDescription(text, shortDescription))
    } else {
      cpSync(sourceFile, destFile)
    }
  }
}

function sameTree(a, b) {
  if (!existsSync(b)) return false
  const filesA = listFiles(a).map(file => relative(a, file)).sort()
  const filesB = listFiles(b).map(file => relative(b, file)).sort()
  if (filesA.join('\n') !== filesB.join('\n')) return false
  for (const rel of filesA) {
    if (!readFileSync(join(a, rel)).equals(readFileSync(join(b, rel)))) return false
  }
  return true
}

const skills = {}
const problems = []
let written = 0

for (const [name, spec] of Object.entries(MATT_SKILLS)) {
  const sourceDir = join(MATT_DIR, name)
  if (!existsSync(join(sourceDir, 'SKILL.md'))) {
    problems.push(`缺少 Matt 技能源：${sourceDir}`)
    continue
  }
  const destDir = join(SKILLS, name)
  if (CHECK) {
    const tempDir = join(ROOT, '.tmp', `skill-check-${name}`)
    rmSync(tempDir, { recursive: true, force: true })
    copySkill(sourceDir, tempDir, spec.adaptations, name, SHORT_DESCRIPTIONS[name])
    if (!sameTree(tempDir, destDir)) problems.push(`技能与源不一致：${name}`)
    rmSync(tempDir, { recursive: true, force: true })
  } else {
    rmSync(destDir, { recursive: true, force: true })
    copySkill(sourceDir, destDir, spec.adaptations, name, SHORT_DESCRIPTIONS[name])
    written += 1
  }
  skills[name] = {
    source: 'mattpocock/skills',
    repository: 'https://github.com/mattpocock/skills',
    commit: MATT_COMMIT,
    license: 'MIT',
    copyright: 'Copyright (c) 2026 Matt Pocock',
    upstreamPath: spec.path,
    catalogDescription: SHORT_DESCRIPTIONS[name],
    localAdaptations: [
      ...spec.adaptations.map(([find, replace]) => ({
        removed: find.length > 160 ? `${find.slice(0, 157)}...` : find,
        replacement: replace.length > 160 ? `${replace.slice(0, 157)}...` : replace,
      })),
      { note: 'catalog description shortened for token cost; skill body unchanged', catalogDescription: SHORT_DESCRIPTIONS[name] },
    ],
  }
}

for (const name of STACK_SKILLS) {
  const sourceDir = join(STACK_DIR, name)
  if (!existsSync(join(sourceDir, 'SKILL.md'))) {
    problems.push(`缺少 Stack 技能源：${sourceDir}`)
    continue
  }
  const destDir = join(SKILLS, name)
  if (CHECK) {
    const tempDir = join(ROOT, '.tmp', `skill-check-${name}`)
    rmSync(tempDir, { recursive: true, force: true })
    copySkill(sourceDir, tempDir, [], name, SHORT_DESCRIPTIONS[name])
    if (!sameTree(tempDir, destDir)) problems.push(`技能与源不一致：${name}`)
    rmSync(tempDir, { recursive: true, force: true })
  } else {
    rmSync(destDir, { recursive: true, force: true })
    copySkill(sourceDir, destDir, [], name, SHORT_DESCRIPTIONS[name])
    written += 1
  }
  skills[name] = {
    source: 'dsh-stack',
    repository: 'https://github.com/58fly/dsh-stack',
    version: STACK_VERSION,
    license: 'MIT',
    copyright: 'Copyright (c) 2026 AICodeKing; dsh-stack contributors',
    upstreamPath: `preset/skills/${name}`,
    upstreamRepository: 'https://github.com/aicodeking/deepseek-stack',
    catalogDescription: SHORT_DESCRIPTIONS[name],
    localAdaptations: [
      { note: 'catalog description shortened for token cost; skill body unchanged', catalogDescription: SHORT_DESCRIPTIONS[name] },
    ],
  }
}

for (const name of ['wf-route', 'wf-project-init', 'wf-engineering']) {
  skills[name] = {
    source: 'original',
    repository: null,
    license: 'MIT',
    copyright: 'Copyright (c) 2026 oh-my-workflow contributors',
    catalogDescription: SHORT_DESCRIPTIONS[name],
    localAdaptations: [
      { note: 'catalog description shortened for token cost; skill body unchanged', catalogDescription: SHORT_DESCRIPTIONS[name] },
    ],
  }
}

if (problems.length > 0) {
  console.error('❌ 技能同步失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

if (!CHECK) {
  const ordered = Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(SOURCES, `${JSON.stringify({
    version: 1,
    generatedBy: 'scripts/sync-skills.mjs',
    upstreams: {
      'mattpocock/skills': {
        repository: 'https://github.com/mattpocock/skills',
        commit: MATT_COMMIT,
        license: 'MIT',
        copyright: 'Copyright (c) 2026 Matt Pocock',
        note: '内容取自本机 magpie library 镜像；本地适配记录在每个技能条目中。',
      },
      'dsh-stack': {
        repository: 'https://github.com/58fly/dsh-stack',
        version: STACK_VERSION,
        license: 'MIT',
        copyright: 'Copyright (c) 2026 AICodeKing; dsh-stack contributors',
        upstreamRepository: 'https://github.com/aicodeking/deepseek-stack',
      },
    },
    skills: ordered,
  }, null, 2)}\n`)
}

const count = Object.keys(skills).length
if (CHECK) {
  console.log(`✅ 技能同步检查通过：${count} 个技能与记录的来源一致`)
} else {
  console.log(`✅ 技能同步完成：写入 ${written} 个上游技能，记录 ${count} 个技能来源`)
}
