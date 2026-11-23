/**
 * Turn-guard checks: the host adapter (`agent/turn-stopping` -> steer), the
 * pure turn decision, verification facts, failure stop-loss and the per-turn
 * budget. Fixtures use the real event shapes, including OPS metadata.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, evaluateTurn, normalizeOptions } from '../preset/turn-guard.mjs'
import { classifyVerificationCommand, processFact } from '../preset/guard/evidence.mjs'
import { failureSummary } from '../preset/guard/failures.mjs'
import { toolOutcomes } from '../preset/guard/events.mjs'
import {
  call,
  events,
  officialShell,
  opsBash,
  opsOutcome,
  opsShell,
  resetSeq,
  result,
} from './fixtures/events.mjs'

let passed = 0
const check = (label, fn) => {
  fn()
  console.log(`  ok  ${label}`)
  passed += 1
}
const checkAsync = async (label, fn) => {
  await fn()
  console.log(`  ok  ${label}`)
  passed += 1
}

function makeRun(config = {}) {
  const handlers = new Map()
  const steers = []
  const warnings = []
  const ctx = {
    on(name, handler) { handlers.set(name, handler) },
    logger: { warn: message => warnings.push(message) },
  }
  apply(ctx, config)
  const stop = async (list, turn, header = {}, id = `s-${Math.random().toString(36).slice(2)}`) => {
    const agent = {
      session: { id, header, snapshotEvents: () => list },
      steer(message) { steers.push(message) },
    }
    await handlers.get('agent/turn-stopping')({ agent, turn })
    return agent
  }
  return { stop, steers, warnings, handlers }
}

const textOf = steer => steer.content.map(block => block.text).join('\n')

resetSeq()

// ---- pure evidence facts ----
check('OPS foreground exit 0 completes; nonzero and missing facts do not', () => {
  const ok = toolOutcomes(events(...opsBash(1, 'c1', 'npm test', 0)))[0]
  assert.equal(processFact(ok).completed, true)
  const bad = toolOutcomes(events(...opsBash(1, 'c2', 'npm test', 2)))[0]
  assert.equal(processFact(bad).completed, false)
  const background = toolOutcomes(events(...opsShell(1, 'c3', { command: 'npm test' }, undefined)))[0]
  assert.equal(processFact(background).completed, false)
  assert.equal(processFact(background).reason, 'missing-ops-shell-facts')
})

check('official shell uses structured exitCode and text fallback', () => {
  const structured = toolOutcomes(events(...officialShell(1, 'c1', 'pwsh', 'npm test', 0)))[0]
  assert.equal(processFact(structured).completed, true)
  const fallback = toolOutcomes(events(
    call(1, 'c2', 'bash', { command: 'npm test' }),
    result(1, 'c2', { text: 'done\n[exit code: 0]' }),
  ))[0]
  assert.equal(processFact(fallback).completed, true)
})

check('command classification separates project checks, target runs and noise', () => {
  assert.equal(classifyVerificationCommand('npm test').strong, true)
  assert.equal(classifyVerificationCommand('pnpm run typecheck').strong, true)
  assert.equal(classifyVerificationCommand('cargo test').strong, true)
  assert.equal(classifyVerificationCommand('cat src/a.ts').strong, false)
  assert.equal(classifyVerificationCommand('git status').strong, false)
  assert.equal(classifyVerificationCommand('node a.js', {}, ['a.js']).strong, true)
  assert.equal(classifyVerificationCommand('node a.js', {}, ['b.js']).strong, false)
  assert.equal(classifyVerificationCommand('node --input-type=module -e "import(\'./src/math.js\').then(...)"', {}, ['src/math.js']).strong, true)
  assert.equal(classifyVerificationCommand('node -e "console.log(1)"', {}, ['src/math.js']).strong, false)
  assert.equal(classifyVerificationCommand('node custom-check.js', { commands: ['node custom-check.js'] }, []).strong, true)
})

check('failureSummary counts same-kind trailing failures only', () => {
  const same = toolOutcomes(events(
    ...officialShell(1, 'c1', 'pwsh', 'npm test', 1),
    ...officialShell(1, 'c2', 'pwsh', 'npm test', 1),
  ))
  assert.equal(failureSummary(same, 2).streak, 2)
  const different = toolOutcomes(events(
    ...officialShell(1, 'c1', 'pwsh', 'npm test', 1),
    ...officialShell(1, 'c2', 'pwsh', 'npm run build', 1),
  ))
  assert.equal(failureSummary(different, 2).streak, 1)
  assert.equal(failureSummary(different, 2).reached, false)
})

check('evaluateTurn distinguishes missing evidence from documentation-only edits', () => {
  const writeOnly = toolOutcomes(events(call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1')))
  const missing = evaluateTurn(writeOnly, { failStreak: 2, documentationSuffixes: ['.md'] })
  assert.equal(missing.rule, 'evidence')
  assert.equal(missing.evidenceMissing, true)

  const docs = toolOutcomes(events(call(1, 'c1', 'write', { file_path: 'README.md' }), result(1, 'c1')))
  const exempt = evaluateTurn(docs, { failStreak: 2, documentationSuffixes: ['.md'] })
  assert.equal(exempt.documentationOnly, true)
  assert.equal(exempt.rule, 'allow')
})

check('normalizeOptions accepts the documented nested guard object', () => {
  const options = normalizeOptions({ guard: { failStreak: 3, evidence: false } })
  assert.equal(options.failStreak, 3)
  assert.equal(options.evidence, false)
})

// ---- host adapter ----
await checkAsync('write then close -> one evidence steer with the path', async () => {
  const run = makeRun()
  await run.stop(events(call(1, 'c1', 'write', { file_path: 'C:\\repo\\a.ts' }), result(1, 'c1')), 1)
  assert.equal(run.steers.length, 1)
  assert.match(textOf(run.steers[0]), /没有成功的验证命令/)
  assert.match(textOf(run.steers[0]), /a\.ts/)
  assert.equal(run.steers[0].source.kind, 'workflow-turn-guard')
})

await checkAsync('write then successful check -> no steer', async () => {
  const run = makeRun()
  await run.stop(events(
    call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1'),
    ...officialShell(1, 'c2', 'pwsh', 'npm test', 0),
  ), 1)
  assert.equal(run.steers.length, 0)
})

await checkAsync('check before the edit still leaves the edit unproven', async () => {
  const run = makeRun()
  await run.stop(events(
    ...officialShell(1, 'c1', 'pwsh', 'npm test', 0),
    call(1, 'c2', 'write', { file_path: 'a.ts' }), result(1, 'c2'),
  ), 1)
  assert.equal(run.steers.length, 1)
})

await checkAsync('failed check does not count as verification', async () => {
  const run = makeRun()
  await run.stop(events(
    call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1'),
    ...officialShell(1, 'c2', 'pwsh', 'npm test', 1),
  ), 1)
  assert.equal(run.steers.length, 1)
  assert.match(textOf(run.steers[0]), /没有成功的验证命令/)
})

await checkAsync('two same failures -> unstick steer', async () => {
  const run = makeRun()
  await run.stop(events(
    ...officialShell(1, 'c1', 'pwsh', 'npm test', 1),
    ...officialShell(1, 'c2', 'pwsh', 'npm test', 1),
  ), 1)
  assert.equal(run.steers.length, 1)
  assert.match(textOf(run.steers[0]), /同类调用连续失败/)
  assert.match(textOf(run.steers[0]), /st-unstick/)
})

await checkAsync('two different failures -> no steer', async () => {
  const run = makeRun()
  await run.stop(events(
    ...officialShell(1, 'c1', 'pwsh', 'npm test', 1),
    ...officialShell(1, 'c2', 'pwsh', 'npm run build', 1),
  ), 1)
  assert.equal(run.steers.length, 0)
})

await checkAsync('read-back and unrelated commands are not evidence', async () => {
  const run = makeRun()
  await run.stop(events(
    call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1'),
    ...officialShell(1, 'c2', 'pwsh', 'cat a.ts', 0),
    ...officialShell(1, 'c3', 'pwsh', 'git status', 0),
  ), 1)
  assert.equal(run.steers.length, 1)
})

await checkAsync('documentation-only edit is exempt; mixed edit is not', async () => {
  const docs = makeRun()
  await docs.stop(events(call(1, 'c1', 'write', { file_path: 'README.md' }), result(1, 'c1')), 1)
  assert.equal(docs.steers.length, 0)

  const mixed = makeRun()
  await mixed.stop(events(
    call(1, 'c1', 'write', { file_path: 'README.md' }), result(1, 'c1'),
    call(1, 'c2', 'edit', { file_path: 'src/core.ts' }), result(1, 'c2'),
  ), 1)
  assert.equal(mixed.steers.length, 1)
  assert.match(textOf(mixed.steers[0]), /core\.ts/)
})

await checkAsync('nudge lists only edits after the last successful check', async () => {
  const run = makeRun()
  await run.stop(events(
    call(1, 'c1', 'write', { file_path: 'already-proven.ts' }), result(1, 'c1'),
    ...officialShell(1, 'c2', 'pwsh', 'npm test', 0),
    call(1, 'c3', 'edit', { file_path: 'still-unproven.ts' }), result(1, 'c3'),
  ), 1)
  assert.match(textOf(run.steers[0]), /still-unproven\.ts/)
  assert.doesNotMatch(textOf(run.steers[0]), /already-proven/)
})

await checkAsync('per-turn budget caps steers and rewords the second', async () => {
  const run = makeRun({ maxSteersPerTurn: 2 })
  const list = [
    call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1'),
  ]
  const agent = {
    session: { id: 'budget', header: {}, snapshotEvents: () => list },
    steer: message => run.steers.push(message),
  }
  const fire = () => run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  await fire()
  assert.equal(run.steers.length, 1)
  await fire()
  assert.equal(run.steers.length, 1)
  list.push(call(1, 'c2', 'write', { file_path: 'b.ts' }), result(1, 'c2'))
  await fire()
  assert.equal(run.steers.length, 2)
  assert.match(textOf(run.steers[1]), /第二次提醒/)
  await fire()
  assert.equal(run.steers.length, 2)
})

await checkAsync('includeSubagents:false skips depth>0', async () => {
  const run = makeRun({ includeSubagents: false })
  await run.stop(events(call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1')), 1, { delegationDepth: 1 })
  assert.equal(run.steers.length, 0)
})

await checkAsync('a broken session log is contained', async () => {
  const run = makeRun()
  const agent = {
    session: { id: 'bad', header: {}, snapshotEvents: () => { throw new Error('boom') } },
    steer: () => { throw new Error('unexpected') },
  }
  await assert.doesNotReject(run.handlers.get('agent/turn-stopping')({ agent, turn: 1 }))
  assert.equal(run.warnings.length, 1)
})

check('bad config throws at mount', () => {
  assert.throws(() => makeRun({ failStreak: 0 }), /positive integer/)
  assert.throws(() => makeRun({ evidence: 'yes' }), /must be a boolean/)
  assert.throws(() => makeRun({ mutationTools: [] }), /must not be empty/)
})

await checkAsync('OPS completed + ops_bash success closes without a nudge', async () => {
  const run = makeRun()
  await run.stop(events(
    ...opsOutcome(1, 'c1', 'ops_write_file', { file_path: 'a.ts' }, { status: 'completed' }),
    ...opsBash(1, 'c2', 'npm test', 0),
  ), 1)
  assert.equal(run.steers.length, 0)
})

await checkAsync('OPS background shell is not verification', async () => {
  const run = makeRun()
  await run.stop(events(
    ...opsOutcome(1, 'c1', 'ops_write_file', { file_path: 'a.ts' }, { status: 'completed' }),
    ...opsShell(1, 'c2', { command: 'npm test' }, undefined),
  ), 1)
  assert.equal(run.steers.length, 1)
})

await checkAsync('project verify.json can make a custom command strong', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-my-workflow-verify-'))
  try {
    mkdirSync(join(dir, '.agent', 'workflow'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'workflow', 'verify.json'), JSON.stringify({ commands: ['node custom-check.js'] }))
    const run = makeRun()
    await run.stop(events(
      call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1'),
      ...officialShell(1, 'c2', 'pwsh', 'node custom-check.js', 0),
    ), 1, { cwd: dir })
    assert.equal(run.steers.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('target run must mention the edited file', async () => {
  const wrong = makeRun()
  await wrong.stop(events(
    call(1, 'c1', 'write', { file_path: 'a.js' }), result(1, 'c1'),
    ...officialShell(1, 'c2', 'pwsh', 'node other.js', 0),
  ), 1)
  assert.equal(wrong.steers.length, 1)

  const right = makeRun()
  await right.stop(events(
    call(1, 'c1', 'write', { file_path: 'a.js' }), result(1, 'c1'),
    ...officialShell(1, 'c2', 'pwsh', 'node a.js', 0),
  ), 1)
  assert.equal(right.steers.length, 0)
})

await checkAsync('parent and child sessions keep independent counters', async () => {
  const run = makeRun()
  const failures = events(
    ...officialShell(1, 'c1', 'pwsh', 'npm test', 1),
    ...officialShell(1, 'c2', 'pwsh', 'npm test', 1),
  )
  await run.stop(failures, 1, {}, 'parent')
  await run.stop(failures, 1, { delegationDepth: 1 }, 'child')
  assert.equal(run.steers.length, 2)
})

console.log(`\n${passed} checks passed`)
