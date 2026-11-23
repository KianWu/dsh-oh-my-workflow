/**
 * Project-initialization checks.
 *
 * Covers the three acceptance facts that matter for `.agent/AGENTS.md`:
 * created when missing, never overwritten when present, and unknown facts are
 * marked "待确认" instead of invented. Also checks the skill carries the fixed
 * ten-section template and the quick-route exemption.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENTRY_PATH, initProject, renderEntryDocument, scanProject } from '../scripts/init-project.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEMP = mkdtempSync(join(tmpdir(), 'oh-my-workflow-project-init-'))
let seq = 0
const freshDir = () => {
  const dir = join(TEMP, `case-${seq++}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

let passed = 0
const check = (label, fn) => {
  fn()
  console.log(`  ok  ${label}`)
  passed += 1
}

try {
  check('缺失时创建，并写入观察到的 package.json 事实', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'demo-app',
      scripts: { build: 'tsc', test: 'vitest', typecheck: 'tsc --noEmit' },
      engines: { node: '>=22' },
    }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(dir, 'README.md'), '# Demo App\n\nA demo.\n')
    const result = initProject(dir)
    assert.equal(result.status, 'created')
    assert.equal(result.written, true)
    const text = readFileSync(join(dir, ENTRY_PATH), 'utf8')
    assert.match(text, /# 项目入口/)
    assert.match(text, /Demo App/)
    assert.match(text, /pnpm run build/)
    assert.match(text, /pnpm run test/)
    assert.match(text, /Node\.js >=22/)
  })

  check('十个固定章节齐全', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    initProject(dir)
    const text = readFileSync(join(dir, ENTRY_PATH), 'utf8')
    const headings = [
      '## 项目概述', '## 技术与运行环境', '## 常用命令', '## 架构概览',
      '## 项目规范真源', '## 不变量与红线', '## 文档与过程记录位置',
      '## 外部依赖', '## 分支与交付策略', '## 已知限制与环境注意事项',
    ]
    for (const heading of headings) assert.ok(text.includes(heading), `缺少 ${heading}`)
  })

  check('已存在时不覆盖', () => {
    const dir = freshDir()
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, ENTRY_PATH), '# existing\n\nKEEP ME\n')
    const result = initProject(dir)
    assert.equal(result.status, 'exists')
    assert.equal(result.written, false)
    assert.equal(readFileSync(join(dir, ENTRY_PATH), 'utf8'), '# existing\n\nKEEP ME\n')
  })

  check('未知事实标注待确认，不臆造项目名或命令', () => {
    const dir = freshDir()
    const result = initProject(dir)
    assert.equal(result.status, 'created')
    const text = readFileSync(join(dir, ENTRY_PATH), 'utf8')
    assert.match(text, /（待确认）/)
    assert.doesNotMatch(text, /demo-app|pnpm|npm run/)
    const facts = scanProject(dir)
    assert.equal(facts.name, null)
    assert.deepEqual(facts.commands, {})
  })

  check('默认不创建 work-record 目录', () => {
    const dir = freshDir()
    initProject(dir)
    assert.equal(existsSync(join(dir, '.agent', 'workflow')), false)
  })

  check('--with-work-records 才创建过程目录与 PROGRESS', () => {
    const dir = freshDir()
    initProject(dir, { withWorkRecords: true })
    for (const sub of ['plans', 'specs', 'tickets', 'adr', 'handoff']) {
      assert.ok(existsSync(join(dir, '.agent', 'workflow', sub)), `缺少 ${sub}`)
    }
    const progress = readFileSync(join(dir, '.agent', 'workflow', 'PROGRESS.md'), 'utf8')
    assert.match(progress, /# PROGRESS/)
  })

  check('--dry-run 不写盘', () => {
    const dir = freshDir()
    const result = initProject(dir, { dryRun: true })
    assert.equal(result.status, 'would-create')
    assert.equal(existsSync(join(dir, ENTRY_PATH)), false)
  })

  check('render 只渲染十个章节，不带额外的过程文档承诺', () => {
    const text = renderEntryDocument({
      name: null, summary: null, languages: [], runtime: [], packageManager: null,
      commands: {}, normative: [], ci: [], hasReadme: false, externalDependencies: [],
    })
    assert.equal((text.match(/^## /gm) ?? []).length, 10)
    assert.match(text, /快速档不创建上述过程文档/)
  })

  check('wf-project-init 技能包含模板与三条关键规则', () => {
    const skill = readFileSync(join(ROOT, 'preset', 'skills', 'wf-project-init', 'SKILL.md'), 'utf8')
    assert.match(skill, /## `.agent\/AGENTS.md` 模板/)
    assert.match(skill, /已存在.*不覆盖/)
    assert.match(skill, /未知.*待确认/)
    assert.match(skill, /快速档不创建/)
    assert.match(skill, /\.agent\/workflow\/verify\.json/)
  })

  check('wf-engineering 技能包含十项通用工程基线', () => {
    const skill = readFileSync(join(ROOT, 'preset', 'skills', 'wf-engineering', 'SKILL.md'), 'utf8')
    for (const phrase of ['复用优先', '解根因', '最小 diff', '明确边界', '清理孤儿', '同步文档', '证据汇报']) {
      assert.ok(skill.includes(phrase), `缺少 ${phrase}`)
    }
  })
} finally {
  rmSync(TEMP, { recursive: true, force: true })
}

console.log(`\n${passed} checks passed`)
