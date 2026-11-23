/**
 * Routing checks for the three-tier workflow route.
 *
 * The route is a skill contract, not a runtime service: prompt text is what
 * the model reads. These assertions pin the parts that must not silently
 * disappear — each tier, the long-task branch, the quick-route documentation
 * exemption — and that the persona points at the route skill.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = path => readFileSync(join(ROOT, path), 'utf8')
const route = read('preset/skills/wf-route/SKILL.md')
const engineering = read('preset/skills/wf-engineering/SKILL.md')
const persona = read('preset/agent.cordis.yml')

let passed = 0
const check = (label, fn) => {
  fn()
  console.log(`  ok  ${label}`)
  passed += 1
}

check('wf-route frontmatter and trigger description', () => {
  assert.match(route, /^---\nname: wf-route\n/m)
  assert.match(route, /description: "Workflow 三档路由/)
  assert.match(route, /Use when/)
})

check('quick tier names its trigger and direct-edit behavior', () => {
  assert.match(route, /快速档/)
  assert.match(route, /目标明确、改动小、风险低/)
  assert.match(route, /直接修改并验证/)
})

check('standard tier names multi-file / visible behavior change', () => {
  assert.match(route, /标准档/)
  assert.match(route, /多文件/)
  assert.match(route, /可见行为变化/)
  assert.match(route, /简短计划/)
})

check('deep tier requires clarification, modeling or spec and user approval', () => {
  assert.match(route, /深入档/)
  assert.match(route, /需求含糊/)
  assert.match(route, /高风险/)
  assert.match(route, /结构/)
  assert.match(route, /用户确认/)
})

check('long task is an orthogonal branch, not a fourth tier', () => {
  assert.match(route, /长任务是正交分支/)
  assert.match(route, /st-ledger/)
  assert.match(route, /st-context-reset/)
})

check('quick tier creates no process documents', () => {
  assert.match(route, /快速档不创建计划、规格、工单、进度或交接文档/)
  assert.match(route, /不创建计划、规格、工单、进度或交接文档/)
})

check('route announces one line and prefers standard when unsure', () => {
  assert.match(route, /路由：/)
  assert.match(route, /不确定时选\*\*标准档\*\*/)
})

check('engineering baseline carries evidence-before-claims and stop-loss', () => {
  assert.match(engineering, /强证据/)
  assert.match(engineering, /写入证据/)
  assert.match(engineering, /同一修法连续失败两次/)
  assert.match(engineering, /解根因/)
})

check('persona points at the route skill and the main skills', () => {
  assert.match(persona, /wf-route/)
  assert.match(persona, /快速档/)
  assert.match(persona, /标准档/)
  assert.match(persona, /深入档/)
  assert.match(persona, /st-unstick/)
  assert.match(persona, /code-review/)
})

console.log(`\n${passed} checks passed`)
