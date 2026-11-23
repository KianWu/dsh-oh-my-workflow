#!/usr/bin/env node
/**
 * Mount check: lay the package out in the real installed shape inside a temp
 * profile and let the host's own loader resolve it. This catches the two
 * different path bases:
 *
 *   - insert[].name is anchored at the patch/package directory and rewritten
 *     to a file:// URL, so the guard is `./preset/uninstall-guard.mjs`;
 *   - cordis:include.path is resolved at runtime against the profile dir, so
 *     it is `./node_modules/dsh-oh-my-workflow/preset/agent.cordis.yml`.
 *
 * If no DSH checkout is available, print SKIP and exit 0: CI without DSH is
 * normal. Set DSH_ROOT to an extracted app.asar (`.../dsh`) to run it locally.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANDIDATES = [
  process.env.DSH_ROOT,
  join(ROOT, '..', '.tmp', 'dsh-asar', 'dsh'),
  'E:/Profession/DeepSeekHarness/resources/app.asar.unpacked/dsh',
].filter(candidate => typeof candidate === 'string' && candidate !== '')

const root = CANDIDATES.find(candidate => existsSync(join(candidate, 'node_modules', '@deepseek-ai')))
if (root === undefined) {
  console.log('SKIP 没找到可读的 DSH 安装；设置 DSH_ROOT=<app.asar 解包后的 dsh 目录> 后重跑')
  process.exit(0)
}

const appBoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
if (!existsSync(appBoot)) {
  console.log(`SKIP 宿主的 dsh-app-boot 不在预期位置：${appBoot}`)
  process.exit(0)
}

const { loadProfileDirectory } = await import(pathToFileURL(appBoot).href)

let passed = 0
const failures = []
const check = (label, fn) => {
  try {
    const ok = fn()
    if (ok === false) throw new Error('returned false')
    passed += 1
    console.log(`  ok  ${label}`)
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`  FAIL ${label} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const profileDir = realpathSync(mkdtempSync(join(tmpdir(), 'oh-my-workflow-mount-')))
const packageDir = join(profileDir, 'node_modules', ...pkg.name.split('/'))

try {
  mkdirSync(dirname(packageDir), { recursive: true })
  symlinkSync(ROOT, packageDir, process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'mount-check-profile',
    private: true,
    version: '0.0.0',
    dependencies: { [pkg.name]: `link:./node_modules/${pkg.name}` },
    dsh: { profile: { bundles: [pkg.name] } },
  }, null, 2)}\n`)

  const out = await loadProfileDirectory('dsh', profileDir, dirname(profileDir))

  const rows = []
  const walk = list => {
    for (const row of list ?? []) {
      rows.push(row)
      walk(row?.plugins)
      walk(Array.isArray(row?.config) ? row.config : row?.config?.plugins)
    }
  }
  for (const layer of out.layers ?? []) for (const patch of layer.patches ?? []) walk(patch.insert)

  const preset = rows.find(row => row.id === 'preset-workflow')
  const guard = rows.find(row => row.id === 'workflow-uninstall-guard')
  const include = rows.find(row => row.id === 'workflow-composition')

  const toPath = url => {
    try { return fileURLToPath(url) }
    catch { return String(url) }
  }

  check('预设声明行被合成出来', () => preset !== undefined)
  check('卸载守卫行被合成出来', () => guard !== undefined)
  check('guard 行解析成 file:// URL（说明走了 anchor 重写）', () => String(guard?.name ?? '').startsWith('file://'))
  check('guard 路径落在包目录下，没有多余的 node_modules 层', () => {
    const path = toPath(guard?.name).replace(/\\/g, '/')
    if (path.includes(`/node_modules/${pkg.name}/node_modules/`)) throw new Error(`多了一层 node_modules：${path}`)
    return path.endsWith(`/node_modules/${pkg.name}/preset/uninstall-guard.mjs`)
  })
  check('guard 模块文件真实存在', () => existsSync(toPath(guard?.name)))
  check('include 仍按 profile 目录解析（未被 anchor 改写）', () => include?.config?.path === `./node_modules/${pkg.name}/preset/agent.cordis.yml`)
  check('include 目标文件真实存在', () => existsSync(join(profileDir, include?.config?.path ?? '')))
  check('预设 id 三处一致', () => preset?.config?.id === 'workflow' && guard?.config?.presetId === 'workflow')
  check('fallback 指向内置 standard', () => guard?.config?.fallbackId === 'standard')
}
finally {
  rmSync(profileDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.log(`\n❌ 挂载校验失败 ${failures.length} 项：`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log(`\n✅ 挂载校验通过（${passed} 项）：两处相对路径各自解析正确，包能被宿主装载`)
