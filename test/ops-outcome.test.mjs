/**
 * OPS outcome facts: the boundary between "the tool returned" and "the file
 * actually changed". These tests pin every status the architecture names, plus
 * the defensive cases that must never be upgraded to success.
 */
import assert from 'node:assert/strict'

import {
  mutationFact,
  onlyDocumentation,
} from '../preset/guard/mutations.mjs'
import { toolOutcomes } from '../preset/guard/events.mjs'
import { call, events, opsBash, opsOutcome, resetSeq, result } from './fixtures/events.mjs'

let passed = 0
const check = (label, fn) => {
  fn()
  console.log(`  ok  ${label}`)
  passed += 1
}

resetSeq()

check('official write success is a change', () => {
  const facts = toolOutcomes(events(call(1, 'c1', 'write', { file_path: 'a.ts' }), result(1, 'c1')))
  const fact = mutationFact(facts[0])
  assert.equal(fact.changed, true)
  assert.equal(fact.confirmed, true)
  assert.deepEqual(fact.paths, ['a.ts'])
})

check('official write error is not a change', () => {
  const facts = toolOutcomes(events(call(1, 'c1', 'edit', { file_path: 'a.ts' }), result(1, 'c1', { isError: true })))
  const fact = mutationFact(facts[0])
  assert.equal(fact.changed, false)
  assert.equal(fact.confirmed, false)
})

check('OPS completed non-dry-run is a confirmed change', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_write_file', { file_path: 'a.ts' }, { status: 'completed' })))
  const fact = mutationFact(list[0])
  assert.equal(fact.changed, true)
  assert.equal(fact.confirmed, true)
  assert.equal(fact.source, 'ops')
})

check('OPS dry-run is planned, not a change', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_replace', { path: 'a.ts' }, { status: 'completed', dryRun: true })))
  const fact = mutationFact(list[0])
  assert.equal(fact.changed, false)
  assert.equal(fact.status, 'planned')
  assert.equal(fact.dryRun, true)
})

check('OPS planned status is not a change', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_write_file', { path: 'a.ts' }, { status: 'planned' })))
  assert.equal(mutationFact(list[0]).changed, false)
})

check('OPS partial is changed but not confirmed', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_replace', { path: 'a.ts' }, { status: 'partial' })))
  const fact = mutationFact(list[0])
  assert.equal(fact.changed, true)
  assert.equal(fact.confirmed, false)
  assert.equal(fact.effectState, 'partial')
})

check('OPS business error with applied effects still needs verification', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_replace', { path: 'a.ts' }, {
    status: 'error',
    error: { code: 'REVISION_CONFLICT', effectState: 'applied' },
  })))
  const fact = mutationFact(list[0])
  assert.equal(fact.changed, true)
  assert.equal(fact.confirmed, false)
  assert.equal(fact.effectState, 'applied')
})

check('OPS business error with no effects is not a change', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_write_file', { path: 'a.ts' }, {
    status: 'rejected',
    error: { code: 'POLICY_DENIED', effectState: 'none' },
  })))
  assert.equal(mutationFact(list[0]).changed, false)
})

check('OPS unknown stays unconfirmed', () => {
  const list = toolOutcomes(events(...opsOutcome(1, 'c1', 'ops_remove', { path: 'a.ts' }, { status: 'unknown' })))
  const fact = mutationFact(list[0])
  assert.equal(fact.changed, false)
  assert.equal(fact.confirmed, false)
  assert.equal(fact.status, 'unknown')
})

check('missing opsOutcome is unknown, never success', () => {
  const list = toolOutcomes(events(call(1, 'c1', 'ops_write_file', { path: 'a.ts' }), result(1, 'c1')))
  const fact = mutationFact(list[0])
  assert.equal(fact.changed, false)
  assert.equal(fact.status, 'unknown')
  assert.equal(fact.reason, 'missing-ops-outcome')
})

check('transport success without OPS facts cannot be trusted', () => {
  const list = toolOutcomes(events(call(1, 'c1', 'ops_edit_file', { path: 'a.ts' }), result(1, 'c1', { isError: false })))
  assert.equal(mutationFact(list[0]).confirmed, false)
})

check('onlyDocumentation needs at least one path and all doc suffixes', () => {
  assert.equal(onlyDocumentation([], ['.md']), false)
  assert.equal(onlyDocumentation(['README.md', 'docs/a.mdx'], ['.md', '.mdx']), true)
  assert.equal(onlyDocumentation(['README.md', 'src/a.ts'], ['.md']), false)
  assert.equal(onlyDocumentation(['D:\\\\repo\\\\.agent\\\\workflow\\\\ledger.tsv'], ['.md']), true)
  assert.equal(onlyDocumentation(['.agent/workflow/tickets/T-1.md'], ['.md']), true)
})

check('real ops_bash event fact is not a mutation', () => {
  const list = toolOutcomes(events(...opsBash(1, 'c1', 'npm test', 0)))
  assert.equal(mutationFact(list[0]), null)
})

console.log(`\n${passed} checks passed`)
