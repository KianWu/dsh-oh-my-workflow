#!/usr/bin/env node
/**
 * Deterministic project-entry initializer.
 *
 * The `wf-project-init` skill tells the model what to do; this helper does the
 * part that must never drift: scan only observable facts, render the ten fixed
 * sections, refuse to overwrite an existing `.agent/AGENTS.md`, and mark every
 * unknown as "待确认" instead of inventing it.
 *
 * It never creates `.agent/workflow/` unless asked: that layout belongs to deep
 * or long tasks, not to every quick edit.
 *
 *   node scripts/init-project.mjs --target . --dry-run
 *   node scripts/init-project.mjs --target . --with-work-records
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ENTRY_PATH = join('.agent', 'AGENTS.md')

const UNKNOWN = '（待确认）'

function readText(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function readJson(path) {
  const raw = readText(path)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function firstHeading(text) {
  if (typeof text !== 'string') return null
  const match = text.match(/^#\s+(.+)$/m)
  return match === null ? null : match[1].trim()
}

function existingPaths(dir, candidates) {
  return candidates.filter(candidate => existsSync(join(dir, candidate)))
}

/**
 * Scan only facts that are on disk. `languages` and `commands` are additions,
 * never guesses: a missing script stays unknown.
 */
export function scanProject(dir) {
  const facts = {
    name: null,
    summary: null,
    languages: [],
    runtime: [],
    packageManager: null,
    commands: {},
    normative: [],
    ci: [],
    hasReadme: false,
    externalDependencies: [],
  }

  const pkg = readJson(join(dir, 'package.json'))
  if (pkg !== null) {
    if (typeof pkg.name === 'string' && pkg.name.trim() !== '') facts.name = pkg.name.trim()
    facts.languages.push('JavaScript / TypeScript')
    if (pkg.engines?.node) facts.runtime.push(`Node.js ${pkg.engines.node}`)
    const lock = existingPaths(dir, ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'package-lock.json'])
    if (typeof pkg.packageManager === 'string') facts.packageManager = pkg.packageManager
    else if (lock.includes('pnpm-lock.yaml')) facts.packageManager = 'pnpm'
    else if (lock.includes('yarn.lock')) facts.packageManager = 'yarn'
    else if (lock.includes('bun.lockb')) facts.packageManager = 'bun'
    else if (lock.includes('package-lock.json')) facts.packageManager = 'npm'

    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    const command = name => (typeof scripts[name] === 'string' ? `${facts.packageManager ?? 'npm'} run ${name}` : null)
    if (facts.packageManager === 'pnpm') facts.commands.install = 'pnpm install'
    else if (facts.packageManager === 'yarn') facts.commands.install = 'yarn install'
    else if (facts.packageManager === 'bun') facts.commands.install = 'bun install'
    else if (facts.packageManager === 'npm') facts.commands.install = 'npm install'
    for (const [key, script] of [['build', 'build'], ['test', 'test'], ['typecheck', 'typecheck'], ['lint', 'lint'], ['format', 'format'], ['dev', 'dev'], ['start', 'start']]) {
      const rendered = command(script)
      if (rendered !== null) facts.commands[key] = rendered
    }
    if (facts.commands.test === undefined && facts.packageManager !== null) {
      // `npm test` is a convention only when the script exists; keep unknown otherwise.
    }
    if (pkg.dependencies && typeof pkg.dependencies === 'object') {
      facts.externalDependencies.push(...Object.keys(pkg.dependencies).slice(0, 20))
    }
  }

  if (existsSync(join(dir, 'Cargo.toml'))) {
    facts.languages.push('Rust')
    const text = readText(join(dir, 'Cargo.toml')) ?? ''
    const name = text.match(/^\s*name\s*=\s*"([^"]+)"/m)
    if (facts.name === null && name !== null) facts.name = name[1]
    facts.commands.build ??= 'cargo build'
    facts.commands.test ??= 'cargo test'
    facts.commands.run ??= 'cargo run'
    facts.commands.format ??= 'cargo fmt'
  }
  if (existsSync(join(dir, 'go.mod'))) {
    facts.languages.push('Go')
    const text = readText(join(dir, 'go.mod')) ?? ''
    const module = text.match(/^module\s+(\S+)/m)
    if (facts.name === null && module !== null) facts.name = module[1]
    facts.commands.build ??= 'go build ./...'
    facts.commands.test ??= 'go test ./...'
  }
  if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'setup.py'))) {
    facts.languages.push('Python')
    if (existsSync(join(dir, 'tests'))) facts.commands.test ??= 'pytest'
  }

  const readme = readText(join(dir, 'README.md'))
  if (readme !== null) {
    facts.hasReadme = true
    facts.summary = firstHeading(readme)
  }

  facts.normative = existingPaths(dir, [
    'CONTRIBUTING.md', 'docs', '.editorconfig', 'tsconfig.json',
    'eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json',
    '.prettierrc', '.prettierrc.json', 'rustfmt.toml', 'pyproject.toml',
  ])
  facts.ci = existingPaths(dir, ['.github/workflows', '.gitlab-ci.yml', 'azure-pipelines.yml', 'Jenkinsfile'])
  facts.languages = [...new Set(facts.languages)]
  return facts
}

/** Render the ten fixed sections from observed facts. */
export function renderEntryDocument(facts) {
  const command = key => facts.commands[key] ?? UNKNOWN
  const summary = facts.summary ?? (facts.name === null ? UNKNOWN : `\`${facts.name}\``)
  const languages = facts.languages.length > 0 ? facts.languages.join('、') : UNKNOWN
  const runtime = facts.runtime.length > 0 ? facts.runtime.join('、') : UNKNOWN
  const normative = facts.normative.length > 0
    ? facts.normative.map(path => `- [${path}](${path})`).join('\n')
    : `${UNKNOWN}（把项目已有的规范真源链接到这里，不要复制全文）`
  const external = facts.externalDependencies.length > 0
    ? facts.externalDependencies.map(name => `- ${name}`).join('\n')
    : UNKNOWN

  return `# 项目入口

> 由 dsh-oh-my-workflow 初始化。只记录扫描到的事实；标为「${UNKNOWN}」的内容需要人工补充。

## 项目概述

${summary}

## 技术与运行环境

${languages}
${facts.packageManager === null ? '' : `\n包管理器：${facts.packageManager}`}
${runtime === UNKNOWN ? '' : `\n运行时：${runtime}`}

## 常用命令

| 用途 | 命令 |
|---|---|
| 安装 | ${facts.commands.install ?? UNKNOWN} |
| 构建 | ${command('build')} |
| 测试 | ${command('test')} |
| 类型检查 | ${command('typecheck')} |
| 运行 | ${command('dev') !== UNKNOWN ? command('dev') : command('start')} |
| 格式化 | ${command('format')} |

## 架构概览

${UNKNOWN}（核心入口、模块职责、数据流、关键接口与扩展点）

## 项目规范真源

${normative}

## 不变量与红线

${UNKNOWN}

## 文档与过程记录位置

默认使用 \`.agent/workflow/\`；项目已有布局时遵循项目约定：

\`\`\`text
.agent/
├─ AGENTS.md
└─ workflow/
   ├─ CONTEXT.md
   ├─ plans/
   ├─ specs/
   ├─ tickets/
   ├─ adr/
   ├─ PROGRESS.md
   └─ handoff/
\`\`\`

快速档不创建上述过程文档；深入档与长任务按需创建。

## 外部依赖

${external}

## 分支与交付策略

${UNKNOWN}

## 已知限制与环境注意事项

${UNKNOWN}
`
}

/**
 * Initialize `.agent/AGENTS.md` only when it is absent.
 * Returns `{ status: 'exists' | 'created' | 'would-create', path, written, facts? }`.
 */
export function initProject(dir, options = {}) {
  const target = resolve(dir)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`init-project: target is not a directory: ${target}`)
  }
  const entryPath = join(target, ENTRY_PATH)
  if (existsSync(entryPath)) {
    return { status: 'exists', path: entryPath, written: false }
  }

  const facts = scanProject(target)
  if (options.dryRun === true) {
    return { status: 'would-create', path: entryPath, written: false, facts }
  }

  mkdirSync(dirname(entryPath), { recursive: true })
  writeFileSync(entryPath, renderEntryDocument(facts), 'utf8')

  if (options.withWorkRecords === true) {
    for (const sub of ['plans', 'specs', 'tickets', 'adr', 'handoff']) {
      mkdirSync(join(target, '.agent', 'workflow', sub), { recursive: true })
    }
    const progress = join(target, '.agent', 'workflow', 'PROGRESS.md')
    if (!existsSync(progress)) {
      writeFileSync(progress, `# PROGRESS\n\n## 当前目标\n\n${UNKNOWN}\n\n## 已完成\n\n- \n\n## 下一步\n\n- \n\n## 待决定\n\n- \n`, 'utf8')
    }
  }

  return { status: 'created', path: entryPath, written: true, facts }
}

function parseArgs(argv) {
  const options = { target: '.', dryRun: false, withWorkRecords: false, json: false, help: false }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--with-work-records') options.withWorkRecords = true
    else if (arg === '--json') options.json = true
    else if (arg === '--target') options.target = rest.shift() ?? '.'
    else {
      console.error(`未知选项：${arg}`)
      process.exit(1)
    }
  }
  return options
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法：node scripts/init-project.mjs [--target <目录>] [--dry-run] [--with-work-records] [--json]')
    process.exit(0)
  }
  try {
    const result = initProject(options.target, options)
    if (options.json) console.log(JSON.stringify(result, null, 2))
    else if (result.status === 'exists') console.log(`已存在，未覆盖：${result.path}`)
    else if (result.status === 'would-create') console.log(`将创建（dry-run）：${result.path}`)
    else console.log(`已创建：${result.path}`)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
