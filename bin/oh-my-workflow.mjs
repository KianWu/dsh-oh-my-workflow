#!/usr/bin/env node
/**
 * dsh-oh-my-workflow — installation lifecycle commands.
 *
 *   status     show whether the bundle is usable in each profile and where the
 *              default preset pointer points.
 *   doctor     diagnose dangling pointers / stale bundle or dependency rows;
 *              `--fix` repairs what can be repaired, `--dry-run` previews.
 *   uninstall  clear the pointer FIRST, then remove bundle registration,
 *              dependency entry and the installed package directory.
 *
 * The command is intentionally dependency-free and never runs a package
 * manager: deleting the manifest rows and directory is enough, and a stale
 * lockfile entry converges on the next normal install.
 */
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  FALLBACK_PRESET_ID,
  PACKAGE_NAME,
  PRESET_ID,
  editProfileManifest,
  forceClearPointer,
  inspectProfile,
  listProfiles,
  readSelectedDefault,
  repairProfile,
  resolveDshHome,
} from '../preset/lifecycle.mjs'

const USAGE = `dsh-oh-my-workflow — 安装生命周期命令

用法：
  dsh-oh-my-workflow status                    查看每个 profile 的安装状态与默认预设指针
  dsh-oh-my-workflow doctor [--fix] [--dry-run]  体检；--fix 修复可修项
  dsh-oh-my-workflow uninstall [--dry-run] [--yes]
                                         优雅卸载：先收指针，再删 bundle/依赖/目录

选项：
  --home <路径>       DSH home（默认 $DSH_HOME 或 ~/.dsh）
  --profile <名字>    只处理指定 profile（默认全部）
  --dry-run           只报告，不写盘
  --json              输出 JSON
  -h, --help          显示本说明

退出码：0 无问题或已修好，1 仍有需要人工处理的问题。`

function parseArgs(argv) {
  const options = {
    command: 'status',
    fix: false,
    dryRun: false,
    json: false,
    yes: false,
    home: null,
    profile: null,
    help: false,
  }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--fix') options.fix = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--home') options.home = rest.shift() ?? null
    else if (arg === '--profile') options.profile = rest.shift() ?? null
    else if (!arg.startsWith('-')) options.command = arg
    else {
      console.error(`未知选项：${arg}`)
      console.error(USAGE)
      process.exit(1)
    }
  }
  return options
}

function selectProfiles(home, name) {
  const all = listProfiles(home)
  if (name === null) return all
  const picked = all.filter(profile => profile.name === name)
  if (picked.length === 0) {
    console.error(`找不到 profile：${name}（可用：${all.map(profile => profile.name).join('、') || '无'}）`)
    process.exit(1)
  }
  return picked
}

const ICON = { ok: '✓', info: '·', warn: '!', error: '✖', fixed: '✔', skipped: '-' }

function diagnose(state) {
  const items = []
  const selected = readSelectedDefault(state.patchText)

  if (selected === PRESET_ID && !state.usable) {
    const why = []
    if (!state.packagePresent) why.push('包不在 node_modules')
    if (!state.bundleListed) why.push('bundles 里没有它')
    if (state.disabled) why.push('预设行被 disabled')
    items.push({
      id: 'pointer-dangling',
      severity: 'error',
      message: `默认预设指向 ${PRESET_ID}，但插件已不可用（${why.join('、')}）—— 新建会话会抛 agent-preset/not-found`,
      fix: () => repairProfile(state, { presetId: PRESET_ID, fallbackId: FALLBACK_PRESET_ID, packageName: PACKAGE_NAME }),
    })
  } else if (selected === PRESET_ID) {
    items.push({ id: 'pointer-ok', severity: 'ok', message: `默认预设为 ${PRESET_ID}（插件可用，正常）` })
  } else if (selected === null) {
    items.push({ id: 'pointer-unset', severity: 'ok', message: '默认预设未指定' })
  } else {
    items.push({ id: 'pointer-other', severity: 'ok', message: `默认预设为 ${selected}` })
  }

  if (state.bundleListed && !state.packagePresent) {
    items.push({
      id: 'bundle-stale',
      severity: 'warn',
      message: `bundles 里还留着 ${PACKAGE_NAME}，但目录不存在`,
      fix: () => editProfileManifest(state, parsed => {
        const bundles = parsed?.dsh?.profile?.bundles
        if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) return { changed: false, reason: 'not-listed' }
        parsed.dsh.profile.bundles = bundles.filter(entry => entry !== PACKAGE_NAME)
        return { changed: true, reason: 'bundle-removed' }
      }),
    })
  }

  if (state.manifest.dependencies[PACKAGE_NAME] !== undefined && !state.packagePresent) {
    items.push({
      id: 'dependency-stale',
      severity: 'warn',
      message: `package.json 的 dependencies 里还留着 ${PACKAGE_NAME}`,
      fix: () => editProfileManifest(state, parsed => {
        if (parsed?.dependencies?.[PACKAGE_NAME] === undefined) return { changed: false, reason: 'not-listed' }
        delete parsed.dependencies[PACKAGE_NAME]
        return { changed: true, reason: 'dependency-removed' }
      }),
    })
  }

  if (state.packagePresent && state.manifest.dependencies[PACKAGE_NAME] === undefined && !state.bundleListed) {
    items.push({
      id: 'orphan-install',
      severity: 'info',
      message: `node_modules/${PACKAGE_NAME} 还在，但依赖与 bundles 都不引用它（孤立安装）`,
      fix: () => {
        rmSync(join(state.dir, 'node_modules', PACKAGE_NAME), { recursive: true, force: true })
        return { changed: true, reason: 'orphan-removed' }
      },
    })
  }

  return items
}

function commandStatus(home, profiles, options) {
  const report = profiles.map(profile => {
    const state = inspectProfile(profile)
    return {
      profile: profile.name,
      dir: profile.dir,
      packagePresent: state.packagePresent,
      bundleListed: state.bundleListed,
      disabled: state.disabled,
      usable: state.usable,
      selectedDefault: readSelectedDefault(state.patchText),
      dependency: state.manifest.dependencies[PACKAGE_NAME] ?? null,
    }
  })
  if (options.json) {
    console.log(JSON.stringify({ home, presetId: PRESET_ID, profiles: report }, null, 2))
    return 0
  }
  console.log(`dsh-oh-my-workflow status — home: ${home}`)
  if (report.length === 0) {
    console.log('  （没有任何 profile）')
    return 0
  }
  for (const entry of report) {
    console.log(`\n  profile ${entry.profile}  ${entry.usable ? '可用' : '不可用'}`)
    console.log(`    包目录      ${entry.packagePresent ? '在' : '不在'}`)
    console.log(`    bundles     ${entry.bundleListed ? '已登记' : '未登记'}`)
    console.log(`    依赖声明    ${entry.dependency === null ? '无' : entry.dependency}`)
    console.log(`    预设行禁用  ${entry.disabled ? '是' : '否'}`)
    console.log(`    默认预设    ${entry.selectedDefault ?? '（未设置）'}`)
  }
  return 0
}

function commandDoctor(home, profiles, options) {
  const report = []
  let failures = 0
  for (const profile of profiles) {
    const state = inspectProfile(profile)
    const items = diagnose(state)
    const results = []
    for (const item of items) {
      let outcome = null
      if (options.fix && typeof item.fix === 'function') {
        if (options.dryRun) outcome = { changed: false, reason: 'dry-run' }
        else {
          try {
            outcome = item.fix()
          } catch (error) {
            outcome = { changed: false, reason: `error:${(error && error.message) || error}` }
          }
        }
      }
      if (outcome?.changed === true) item.status = 'fixed'
      else if (outcome !== null) item.status = 'skipped'
      if (item.severity === 'error' && item.status !== 'fixed') failures += 1
      results.push({ ...item, outcome })
    }
    report.push({ profile: profile.name, dir: profile.dir, usable: state.usable, items: results })
  }

  if (options.json) {
    console.log(JSON.stringify({ home, fix: options.fix, dryRun: options.dryRun, profiles: report }, null, 2))
    return failures > 0 ? 1 : 0
  }

  console.log(`dsh-oh-my-workflow doctor — home: ${home}${options.fix ? '（--fix）' : ''}${options.dryRun ? '（--dry-run）' : ''}`)
  if (report.length === 0) console.log('  （没有任何 profile）')
  for (const entry of report) {
    console.log(`\n  profile ${entry.profile}`)
    for (const item of entry.items) {
      const icon = ICON[item.status ?? item.severity] ?? ICON.info
      console.log(`    ${icon} ${item.message}`)
      if (item.status === 'fixed') console.log(`      → 已修复：${item.outcome.reason}`)
      if (item.status === 'skipped' && item.outcome && item.severity === 'error') {
        console.log(`      → 未修复：${item.outcome.reason}`)
      }
    }
  }
  if (failures > 0) {
    console.log('\n仍有会导致宿主异常的问题。修复方式：npx dsh-oh-my-workflow doctor --fix')
    return 1
  }
  console.log('\n没有会导致宿主异常的问题。')
  return 0
}

function commandUninstall(home, profiles, options) {
  const steps = []
  const record = (label, outcome) => steps.push({ label, ...outcome })

  for (const profile of profiles) {
    // Order matters: clear the pointer before the package disappears, or the
    // host can observe a dangling default for a moment.
    if (options.dryRun) {
      record(`${profile.name}: 收默认预设指针`, { changed: false, reason: 'dry-run' })
    } else {
      record(`${profile.name}: 收默认预设指针`, forceClearPointer(profile, {
        presetId: PRESET_ID,
        fallbackId: FALLBACK_PRESET_ID,
      }))
    }

    const mutate = (label, fn) => {
      if (options.dryRun) {
        record(`${profile.name}: ${label}`, { changed: false, reason: 'dry-run' })
        return
      }
      record(`${profile.name}: ${label}`, editProfileManifest(profile, fn))
    }

    mutate('移除 bundles 登记', parsed => {
      const bundles = parsed?.dsh?.profile?.bundles
      if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) return { changed: false, reason: 'not-listed' }
      parsed.dsh.profile.bundles = bundles.filter(entry => entry !== PACKAGE_NAME)
      return { changed: true, reason: 'bundle-removed' }
    })
    mutate('移除 dependencies 声明', parsed => {
      if (parsed?.dependencies?.[PACKAGE_NAME] === undefined) return { changed: false, reason: 'not-listed' }
      delete parsed.dependencies[PACKAGE_NAME]
      return { changed: true, reason: 'dependency-removed' }
    })

    const installed = join(profile.dir, 'node_modules', PACKAGE_NAME)
    if (options.dryRun) {
      record(`${profile.name}: 删除 node_modules/${PACKAGE_NAME}`, { changed: false, reason: 'dry-run' })
    } else if (existsSync(installed)) {
      rmSync(installed, { recursive: true, force: true })
      record(`${profile.name}: 删除 node_modules/${PACKAGE_NAME}`, { changed: true, reason: 'removed' })
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ home, dryRun: options.dryRun, steps }, null, 2))
    return 0
  }
  console.log(`dsh-oh-my-workflow uninstall — home: ${home}${options.dryRun ? '（--dry-run）' : ''}`)
  for (const step of steps) {
    const icon = options.dryRun ? ICON.info : step.changed ? ICON.fixed : ICON.skipped
    console.log(`  ${icon} ${step.label}${step.changed ? `（${step.reason}）` : ''}`)
  }
  if (options.dryRun) console.log('\n--dry-run：没有写盘。')
  else console.log('\n完成。DSH 重启后生效。')
  return 0
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const home = options.home ?? resolveDshHome()
  const profiles = selectProfiles(home, options.profile)

  if (options.command === 'status') process.exit(commandStatus(home, profiles, options))
  else if (options.command === 'doctor') process.exit(commandDoctor(home, profiles, options))
  else if (options.command === 'uninstall') process.exit(commandUninstall(home, profiles, options))
  else {
    console.error(`未知命令：${options.command}`)
    console.error(USAGE)
    process.exit(1)
  }
}

export { commandStatus, commandDoctor, commandUninstall, parseArgs, selectProfiles }
