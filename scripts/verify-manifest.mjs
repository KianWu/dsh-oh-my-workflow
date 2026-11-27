#!/usr/bin/env node
/**
 * Manifest consistency check. This is the check that `prepublishOnly` relies on:
 * it makes sure a published tarball can actually be installed as a DSH bundle
 * and that the files the package promises (`files`) are present.
 *
 * It never touches the network and never installs anything.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const failures = []
const fail = (message, hint) => failures.push(hint ? `${message}\n    → ${hint}` : message)

let pkg
try {
  pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
} catch (error) {
  console.error(`❌ 无法读取或解析 package.json：${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const read = (relPath, label) => {
  const path = join(ROOT, relPath)
  if (!existsSync(path)) {
    fail(`${label} 不存在：${relPath}`, 'package.json 的 files 白名单列了它，就必须真实存在')
    return ''
  }
  return readFileSync(path, 'utf8')
}

// ---- 1. identity ----
if (typeof pkg.name !== 'string' || pkg.name.trim() === '') fail('package.json 缺少 name')
if (typeof pkg.version !== 'string' || pkg.version.trim() === '') fail('package.json 缺少 version')
if (typeof pkg.description !== 'string' || pkg.description.trim() === '') fail('package.json 缺少 description')
if (pkg.license !== 'MIT') fail(`license 应为 MIT，实际 ${pkg.license ?? '缺失'}`)
if (typeof pkg.repository?.url !== 'string' || !pkg.repository.url.includes('github.com')) {
  fail('repository.url 缺失或不是 GitHub 地址', 'npm 包要靠它关联回收录的仓库')
}

// ---- 2. dsh bundle manifest ----
const dsh = pkg.dsh
if (dsh === null || typeof dsh !== 'object') {
  fail('package.json 缺少 dsh 字段', '市面上绝大多数被拒投稿都只声明了 dsh.client，而没有 dsh.bundle')
} else {
  if (dsh.manifestVersion !== 1) fail(`dsh.manifestVersion 应为 1，实际 ${dsh.manifestVersion ?? '缺失'}`)
  const patchRel = dsh.bundle?.patch
  if (typeof patchRel !== 'string' || patchRel.trim() === '') {
    fail('dsh.bundle.patch 缺失', '这是 dsh plugin add 能否安装的关键；只有 dsh.client 不可安装')
  } else {
    const patch = read(patchRel, 'bundle patch')
    if (patch !== '') {
      const includeMatch = patch.match(/path:\s*"([^"]*agent\.cordis\.yml)"/)
      if (!includeMatch) {
        fail(`${patchRel} 里没有指向 agent.cordis.yml 的 include 路径`)
      } else {
        const expected = `./node_modules/${pkg.name}/preset/agent.cordis.yml`
        if (includeMatch[1] !== expected) {
          fail(`include 路径与包名不一致：声明 ${includeMatch[1]}，应为 ${expected}`, '改包名后必须同步 cordis.patch.yml')
        }
      }
      if (!/preset-[a-z0-9-]+/.test(patch)) fail(`${patchRel} 缺少预设插入行（- id: preset-...）`)
      if (!/workflow-uninstall-guard/.test(patch)) fail(`${patchRel} 缺少卸载守卫行（- id: workflow-uninstall-guard）`)
    }
  }
}

// ---- 3. preset body ----
read('preset/agent.cordis.yml', 'preset body')

// ---- 4. bin targets ----
if (pkg.bin === null || typeof pkg.bin !== 'object' || Object.keys(pkg.bin).length === 0) {
  fail('package.json 缺少 bin')
} else {
  for (const [name, rel] of Object.entries(pkg.bin)) {
    if (typeof rel !== 'string' || !existsSync(join(ROOT, rel))) fail(`bin "${name}" 指向的文件不存在：${rel}`)
  }
}

// ---- 5. files whitelist must be physically present ----
const requiredFiles = ['cordis.patch.yml', 'index.mjs', 'README.md', 'CHANGELOG.md', 'NOTICE.md', 'LICENSE']
const whitelist = Array.isArray(pkg.files) ? pkg.files : []
for (const file of requiredFiles) {
  if (!whitelist.includes(file)) fail(`files 白名单缺少 ${file}`)
  if (!existsSync(join(ROOT, file))) fail(`files 白名单里的 ${file} 不存在`)
}
for (const dir of ['preset', 'bin', 'scripts', 'test']) {
  if (!whitelist.includes(dir)) fail(`files 白名单缺少目录 ${dir}`)
  if (!existsSync(join(ROOT, dir))) fail(`文件清单里的目录 ${dir} 不存在`)
}

// ---- 5b. entry resolvability ----
// `main` must point at a real file that the files whitelist actually ships.
// The 0.1.0-era package had no entry at all: install succeeded, then
// `require.resolve('dsh-oh-my-workflow')` threw MODULE_NOT_FOUND — caught by a
// marketplace reviewer, not by us. Same lesson as the 0.4.0 backtick bug:
// shape checks pass, runtime import fails, so pin both here.
const main = pkg.main
if (typeof main !== 'string' || main === '') {
  fail('package.json 没有 main 字段', '无入口的包装完后 require.resolve 直接 MODULE_NOT_FOUND')
} else {
  const mainPath = main.replace(/^\.\//, '')
  if (!existsSync(join(ROOT, mainPath))) fail(`main 指向的 ${mainPath} 不存在`)
  if (!whitelist.includes(mainPath)) {
    fail(`main 指向的 ${mainPath} 不在 files 白名单里`, 'npm pack 不会带它，装完就没有入口')
  }
}

if (failures.length > 0) {
  console.log(`\n❌ 清单校验失败 ${failures.length} 项：`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}
console.log(`\n✅ 清单校验通过：dsh.bundle 可安装、include 路径与包名一致、files 白名单齐全（name=${pkg.name} v${pkg.version}）`)
