#!/usr/bin/env node
/**
 * OPS integration check: prove that the row mounts the reviewed Native surface
 * and keeps the permission boundary.
 *
 * It loads the installed dsh-ops package, imports the real
 * `resolveIntegrationConfig`, reads the exact options our preset exports, and
 * asserts the resolved plan rather than guessing from source text. It also
 * checks that the bundle declares no permissions and never touches the
 * `dsh-ops` global row.
 *
 *   node scripts/verify-ops-integration.mjs
 *   DSH_OPS_DIR=<.../node_modules/dsh-ops> node scripts/verify-ops-integration.mjs
 *
 * No dsh-ops installation on CI prints SKIP and exits 0.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const candidates = [
  process.env.DSH_OPS_DIR,
  process.env.DSH_PROFILE_DIR ? join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-ops') : undefined,
  join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-ops'),
].filter(candidate => typeof candidate === 'string' && candidate !== '')

const opsDir = candidates.find(candidate => existsSync(join(candidate, 'package.json')))
if (opsDir === undefined) {
  console.log('SKIP 没找到已安装的 dsh-ops；设置 DSH_OPS_DIR 后重跑')
  process.exit(0)
}

const integrationEntry = join(opsDir, 'lib', 'integration', 'index.js')
const registryEntry = join(opsDir, 'lib', 'capabilities', 'registry.js')
const policyEntry = join(opsDir, 'lib', 'policy.js')
for (const path of [integrationEntry, registryEntry, policyEntry]) {
  if (!existsSync(path)) {
    console.log(`SKIP dsh-ops 结构不符合预期，缺少 ${path}`)
    process.exit(0)
  }
}

const { resolveIntegrationConfig } = await import(pathToFileURL(integrationEntry).href)
const { CAPABILITIES } = await import(pathToFileURL(registryEntry).href)
const { publicToolName } = await import(pathToFileURL(policyEntry).href)

// Import the preset module with the bare specifier rewritten to the installed
// package, so the test proves the module's real default export and options.
const sourcePath = join(ROOT, 'preset', 'ops-integration.mjs')
const source = readFileSync(sourcePath, 'utf8')
const integrationUrl = pathToFileURL(integrationEntry).href
const rewritten = source
  .replace(/from 'dsh-ops\/integration'/, `from '${integrationUrl}'`)
  .replace(/import\('dsh-ops\/integration'\)/, `import('${integrationUrl}')`)
const module = await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`)

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

const options = module.options
const resolved = resolveIntegrationConfig(options)
const residentPublic = resolved.residentNames.map(publicToolName)
const discoverable = new Set(resolved.native.allowedTools)
const fileMutationNames = new Set(CAPABILITIES.filter(c => c.component === 'file' && c.mutates).map(c => c.rawName))

check('默认导出是 dsh-ops integration 插件', () => typeof module.default?.apply === 'function')
check('插件名保留 dsh-ops-integration', () => module.default?.name === 'dsh-ops-integration')
check('preset 与声明 id 完全一致', () => resolved.preset === 'workflow')
check('Native presentation + resident file surface', () => resolved.presentation === 'native' && resolved.files === true && resolved.residentTools === true)
check('常驻面为 inspect_local_file / glob / grep', () => residentPublic.join(',') === 'ops_inspect_local_file,ops_glob,ops_grep')
check('shell 发布 ops_bash（是否可见仍由宿主授权）', () => resolved.shell === true)
check('保留宿主 PowerShell', () => resolved.hidePwsh === false)
check('去重官方 read/glob/grep，官方 write/edit 仍保留', () => resolved.replaceOfficial === true && resolved.files === true)
check('渐进发现开启，且不是空允许集', () => resolved.discovery === true && resolved.native.enabled === true && resolved.native.allowedTools.length > 0)
check('发现集覆盖编辑类与文档读取能力', () => ['replace', 'write_file', 'edit_file', 'read_files', 'read_pdf', 'read_docx', 'read_table'].every(name => discoverable.has(name)))
check('发现集包含全部有副作用的文件能力', () => [...fileMutationNames].every(name => discoverable.has(name)))
check('prompt policy 开启且只去重 reviewed 文件工具', () => resolved.core.promptPolicy === true && resolved.replaceOfficial === true)

const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
check('根补丁没有覆盖 dsh-ops 全局行', () => !/^\s*- id:\s*dsh-ops\s*$/m.test(patch))
check('本包没有 dsh-plugin.json / permissions 声明', () => !existsSync(join(ROOT, 'dsh-plugin.json')) && pkg.permissions === undefined)
check('产品代码只导入 dsh-ops/integration，不碰私有 lib/*', () => /from 'dsh-ops\/integration'|import\('dsh-ops\/integration'\)/.test(source) && !/dsh-ops\/lib\//.test(source))

if (failures.length === 0) {
  console.log(`\n✅ OPS 集成校验通过（${passed} 项）：Native 工具面与权限边界符合首版约定`)
  process.exit(0)
}
console.error(`\n❌ OPS 集成校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
