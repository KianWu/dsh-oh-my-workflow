/**
 * workflow-uninstall-guard — makes the workflow bundle safe to disable or
 * uninstall.
 *
 * The host records the default preset as `selectedDefault` in the profile's
 * `cordis.patch.yml`, and disabling/uninstalling a bundle never clears it. A
 * dangling pointer breaks every new session. This guard is mounted at the
 * profile root (not inside the preset) because the break happens before a
 * session can be created.
 *
 * It does two things, both decided from DISK, never from the host's current
 * memory:
 *   1. on load, restore a pointer we previously cleared, but only if the user
 *      has not chosen another preset in the meantime;
 *   2. when this bundle is no longer usable, clear a pointer that names
 *      `workflow` back to `standard`.
 *
 * It only rewrites one YAML scalar. It never reflows YAML, touches session
 * content, or throws: a lifecycle helper must not make the profile worse.
 */
import {
  FALLBACK_PRESET_ID,
  PACKAGE_NAME,
  PRESET_ID,
  clearDanglingPointers,
  resolveDshHome,
  restorePointers,
} from './lifecycle.mjs'

export const name = 'workflow-uninstall-guard'

function textOption(config, key, fallback) {
  const value = config?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

export function apply(ctx, config = {}) {
  const presetId = textOption(config, 'presetId', PRESET_ID)
  const fallbackId = textOption(config, 'fallbackId', FALLBACK_PRESET_ID)
  const packageName = textOption(config, 'packageName', PACKAGE_NAME)
  const home = textOption(config, 'dshHome', resolveDshHome())
  const options = { presetId, fallbackId, packageName }

  let warned = false
  const warnOnce = message => {
    if (warned) return
    warned = true
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // Logger unavailable — the guard's only job is to avoid breakage.
    }
  }

  const describe = results => {
    const changed = results.filter(result => result.changed)
    if (changed.length === 0) return null
    return changed
      .map(result => `${result.profile}: ${result.from} → ${result.to}（${result.reason}）`)
      .join('；')
  }

  const reconcile = () => {
    try {
      const restored = describe(restorePointers(home, options))
      if (restored !== null) {
        try {
          ctx.logger?.info?.(`${name}: 已恢复默认预设指针 ${restored}`)
        } catch { /* optional logger */ }
      }
      const repaired = describe(clearDanglingPointers(home, options))
      if (repaired !== null) {
        warnOnce(
          `${name}: 检测到指向 ${presetId} 的默认预设指针已悬空，已回落到 ${fallbackId} —— ${repaired}。` +
          '重新启用本插件后会自动恢复。'
        )
      }
    } catch (error) {
      warnOnce(`${name}: 启动对账失败，跳过（不影响宿主）：${String((error && error.message) || error)}`)
    }
  }

  const cleanup = () => {
    try {
      const results = clearDanglingPointers(home, options)
      const repaired = describe(results)
      if (repaired !== null) warnOnce(`${name}: 已收走悬空指针 ${repaired}`)
    } catch {
      // The disposer may run after the logger is gone; stay silent.
    }
  }

  reconcile()

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => cleanup, `${name}: clear dangling preset pointer`)
    return
  }
  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => cleanup())
    return
  }
  warnOnce(`${name}: 宿主没有提供 effect/dispose 钩子，卸载时需要手动执行 dsh-oh-my-workflow doctor --fix`)
}
