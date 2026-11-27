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
const behavior = read('preset/behavior.mjs')
const compaction = read('preset/compaction.mjs')

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

check('deep tier requires clarification, docs on disk, and a user-owned start', () => {
  assert.match(route, /深入档/)
  assert.match(route, /需求含糊/)
  assert.match(route, /高风险/)
  assert.match(route, /结构/)
  assert.match(route, /文档落盘后停在执行前/)
  assert.match(route, /由用户决定何时按文档执行/)
})

check('standard tier includes one light clarification round', () => {
  assert.match(route, /轻量澄清/)
  assert.match(route, /grilling/)
  assert.match(route, /不为问而问/)
  assert.match(route, /答案会改变做法/)
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

check('complex tasks route to multi-agent delegation', () => {
  assert.match(route, /多 agent 协作/)
  assert.match(route, /subagent_fork/)
  assert.match(route, /并行/)
  assert.match(route, /上下文/)
  assert.match(route, /执行阶段沿用多 agent 协作与验证纪律/)
  assert.match(persona, /多 agent 协作/)
  assert.match(persona, /subagent_fork/)
  assert.match(engineering, /委派/)
})

check('behavior contract keeps the act-dont-ask and finish-in-one-turn rules', () => {
  assert.match(behavior, /信息足够就动手/)
  assert.match(behavior, /最可能的读法/)
  assert.match(behavior, /一轮之内做完/)
  assert.match(behavior, /任务大不是先请示的理由/)
  assert.match(behavior, /只有部分环节被卡住时/)
})

check('behavior contract yields to plan mode and the host policy order', () => {
  assert.match(behavior, /plan:policy/)
  assert.match(behavior, /只探索不实现/)
  const order = behavior.match(/BEHAVIOR_ORDER = (-?\d+)/)
  assert.ok(order !== null, 'BEHAVIOR_ORDER missing')
  assert.ok(Number(order[1]) < 500, 'behavior must sort before plan:policy (order 500) so its yield clause reads as a boundary, not an afterthought')
})

check('behavior contract pins reporting honesty and code style', () => {
  assert.match(behavior, /只报告实际发生的事/)
  assert.match(behavior, /第一句说明/)
  assert.match(behavior, /默认不写注释/)
  assert.match(behavior, /三行重复好过过早抽象/)
  assert.match(behavior, /子代理简报/)
})

check('behavior contract ships verbatim and before tool sections', () => {
  assert.match(behavior, /interpolate: false/)
  const order = behavior.match(/BEHAVIOR_ORDER = (-?\d+)/)
  assert.ok(order !== null, 'BEHAVIOR_ORDER missing')
  assert.ok(Number(order[1]) < 1000, 'behavior must sort before tool:* sections')
  assert.match(behavior, /SECTION_NAME = 'workflow:behavior'/)
})

check('compaction swaps only the directive and keeps the host engine', () => {
  assert.match(compaction, /ctx\.get\('compaction'\)/)
  assert.match(compaction, /replaceTrailingCompactionInstruction/)
  assert.match(compaction, /tool result middle pruned/)
  assert.match(compaction, /所有用户消息/)
  assert.match(compaction, /extractSummaryBlocks/)
  assert.doesNotMatch(compaction, /import\('@deepseek-ai\/dsh-compaction-basic'\)/)
})

check('plan mode asks for one recommendation, not a survey', () => {
  assert.match(persona, /Include only your recommended approach/)
  assert.match(persona, /instead of a survey/)
  assert.match(persona, /describe the pattern once/)
})

console.log(`\n${passed} checks passed`)
