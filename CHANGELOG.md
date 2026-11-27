# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-11-27

### Fixed

- **补齐包入口**（awesome-dsh-plugin 收录评审指出）：0.1.0–0.4.1 的 `package.json` 一直没有 `main` 字段，包里也没有任何可被 Node 解析的入口——安装成功后 `require.resolve('dsh-oh-my-workflow')` / `import 'dsh-oh-my-workflow'` 直接 `MODULE_NOT_FOUND`。新增 `index.mjs`（纯元数据导出：name/version/description/bundlePatch/peerDependencies，不挂载任何东西——本包是 bundle 行 + CLI，不是单个 Cordis 插件，本来就没有 `apply()` 可导），声明 `main` 与 `exports`，并列入 `files` 白名单。
- 防再犯：`verify-manifest.mjs` 新增 5b 断言——`main` 必须指向真实存在且在 `files` 白名单里的文件；`import-smoke.test.mjs` 把 `./index.mjs` 纳入真实加载清单。
- 说明：DSH 宿主不受此缺陷影响——bundle 组合走 `dsh.bundle.patch` → `cordis.patch.yml` → 包内文件路径，从不 import 包根；这是按「装上就该能解析」的收录标准补的完整性。

## [0.4.1] - 2026-11-27

### Fixed

- **修复 0.4.0 致命缺陷：`behavior.mjs` 模板字符串里的裸反引号**。第 74 行「落到 \`.agent/workflow/\`」两侧的反引号未转义，直接终止了模板字面量，模块加载即抛 `ReferenceError: workflow is not defined`，`workflow-behavior` 行报 `never started`，**整个 Workflow 预设无法挂载，新会话无法创建**。根因是上轮「文档禁令冲突」修复的编辑引入；verify-mount 的静态检查抓不到这类语法错误。
- 新增 `test/import-smoke.test.mjs` 并接入 `npm test` 与 `prepublishOnly`：**真实 import** preset 挂载的全部本地行模块（dsh-ops 依赖的两个降级为解析检查）。已做反向验证——把该 bug 重新注入时烟测确实失败。0.4.0 的教训：静态断言不能替代真实加载。

## [0.4.0] - 2026-11-27

### Added

- **行为规范段**（`preset/behavior.mjs`，新增 `workflow-behavior` 行）：把减少空转轮次的规则写成常驻提示词段，独立注册 `workflow:behavior`（order 1，`interpolate: false`）。内容覆盖：信息足够就动手、只按最可能的读法推进并说明取了哪种、一轮之内做完、不重新论证已定事实、只报告实际发生的事（失败第一句说）、结论先行、代码风格（默认不写注释、不过早抽象、不为不可能的情况兜底）、子代理简报纪律。约 2.3 KB，中文蒸馏，不引入第三方提示词原文。
  - 之所以独立成行而不是扩写 `persona.prefix`：persona 严格插值，正文里一个 `{{` 就会让会话首次渲染直接失败；独立段落可单独关闭且不影响身份槽。
- **结构化压缩**（`preset/compaction.mjs`，新增 `workflow-compaction` 行）：在 `compaction-basic` 之后包装宿主已挂载的引擎实例，只替换最后一条总结指令并剥离 `<analysis>` 草稿。相对宿主默认指令新增：`<analysis>` 草稿段、九段式检查点、**明确说明被裁剪工具结果**（`[... tool result middle pruned ...]`）的处置方式、单独的「所有用户消息」段、安全约束原文保留。仅替换最后一条 user 消息，前面消息按引用保留，KV 缓存前缀不失效。
- 计划模式引导改写「Make the plan decision-complete」一段：改为 Claude 结构——先给 **Context**（为什么做、预期产出）、只给推荐方案（要权衡就给推荐+主要代价，不做方案罗列）、跨多文件重复同一模式时描述一次并给代表性路径、明确 API/边界/失败模式、复用已有工具需带路径、必含 **Verification** 验证段。该段是宿主 `plan:policy`（order 500，条件渲染）的部署侧内容，仅计划模式激活时注入，不影响普通轮次。
- 校验加固：`verify-preset.mjs` 新增行为段与压缩段的装配断言（含「不得 import 宿主压缩包」）；`verify-host-contract.mjs` 新增「引擎行必须在补丁行之前」与 `compaction` service 名检查；`routing.test.mjs` 从 10 项增至 15 项。

### Changed

- **标准档加入轻量澄清**：路由表标准档行为改为「轻量澄清（grilling 一轮：缺口问题一次问完，给推荐答案）→ 简短计划 → 实现 → 验证 → 自查」，并明确「只问答案会改变做法的问题；目标真正明确就跳过，不为问而问」。快速档维持不追问。
- **深入档改为文档优先、执行解耦**：澄清/建模/追问完成后不直接实现——规格/计划/ADR 落盘到 `.agent/workflow/`，汇报文档位置后**停在执行前**；是否执行、何时执行、按什么顺序（implement / implement-spec / code-review）由用户决定。用户明说「澄清完直接做」时例外连续推进。persona 与反模式同步。
- `turn-guard` 的 steer 文案改为指向提示词中已有的规则（「把结果放进同一段汇报」「然后正常收尾」），从「新要求」变成「提醒」，减少守卫与提示词互相矛盾的情况。

### Notes

- **计划模式与既有机制的衔接**：`plan:policy`（order 500）仅在计划模式激活时条件渲染，晚于 behavior（order 1）。为此 behavior 的边界段显式让位——计划模式期间只探索不实现；深入档的「澄清/建模/写规格经用户确认」明确属于「下一步必须由用户决定」，不受「信息足够就动手」约束；汇报段对「不创建过程文档」的禁令改为按分档规则执行（快速档不建、标准/深入档落 `.agent/workflow/`）。守卫与计划模式无交互：计划模式轮次是纯探索、零改动，evidence 规则读的是「改动后必须有验证」，纯探索轮不会触发打回。
- 压缩补丁的失败策略是**完全回退**：取不到 `ctx.get('compaction')`、引擎没有 `summarize` 钩子、或补丁抛错时，只记一条日志，宿主原有压缩行为不变。压缩永远不该因为本行存在而变差。引擎的 `regionDependencies` 以 `(input, owner, abort) => this.summarize(...)` 动态读取实例属性，因此包装实例对所有压缩路径（自动压力、溢出恢复、`/compact`）一致生效。
- 未采用「子类化 `BasicCompactionEngine`」方案：该包位于 DSH 应用归档（`app.asar`）内，profile 侧 `require.resolve` 无法解析，导入失败会让整个 `compaction` 组失去引擎——比不压缩严重得多。

### Fixed

- **长任务进度文件互相覆盖**：`st-context-reset` 原文写「create PROGRESS.md at the repo root」且第 5 步是整篇重写指令，而 `wf-project-init`/persona 说 `.agent/workflow/PROGRESS.md`、`st-plan-loop` 说「PLAN.md, or the PROGRESS.md」——三个技能给出的路径互相矛盾，导致后一个长任务直接覆盖前一个未完成任务的状态。现在统一为：每个长任务一个 `PROGRESS-<task-slug>.md`（放 `.agent/workflow/`），**Goal 仍描述当前任务才续写，描述别的任务永不覆盖、永不追加**；`st-plan-loop`/`st-verify-loop`/`st-unstick`/`wf-route`/`wf-project-init`/persona 六处引用同步该口径。

## [0.3.0] - 2026-11-25

### Added

- 复杂/深入档与长任务的**多 agent 协作**纪律：persona、`wf-route`、`wf-engineering` 明确要求把工作拆成可独立推进的子任务，用 `subagent`（全新上下文，可并行）/`subagent_fork`（继承上下文）委派，宽搜索/批量阅读/独立评审/批量扇出分别交给子代理或 `workflow`；主线只保留目标、决策与集成，子代理只回传结论与证据，控制上下文膨胀。
- `wf-route` 深入档流程加入“拆分并行委派”，并新增“复杂/长任务全自己扛”的反模式。

## [0.2.0] - 2026-11-25

### Changed

- `turn-guard` 规则 A（改完必须验证）默认改为 **balanced** 判定：本轮在**首个改动之后**只要出现过一次成功验证就算通过，之后的收尾小改动不再反复触发打回。仍可通过 `evidenceScope: strict` 恢复旧的“验证必须在最后一次改动之后”语义。
- 官方 `bash`/`pwsh` 的成功结果现在会被识别：这类工具只在非零退出时输出 `[exit code: N]`，因此“非 error 且无标记”视为 exit 0（`assumed-ok`）。OPS `ops_bash` 仍只认显式 `opsShell` 进程事实。可用 `assumeOfficialShellSuccess: false` 关闭。
- 扩大“强验证”命令识别：`bun`/`deno test|check|lint`、`uv|poetry|pdm|pipenv run pytest|mypy|ruff|tox|nox`、`npm|pnpm|yarn|bun run <test|check|verify|build|lint|type|spec|e2e…>`，以及 `dotnet|go|gradle|flutter|deno|bun run` 目标程序。

## [0.1.0] - 2026-11-23

### Added

- Agent preset `workflow` (display name `Workflow`) with three-tier routing
  (quick / standard / deep) and a project-entry discipline.
- OPS native integration through the public `dsh-ops/integration` entry.
- `turn-guard` turn-boundary guard: requires real verification evidence and
  stops a repeated same-idea fix after two failed attempts.
- 22 bundled skills covering requirement questioning, spec writing, ticket
  breakdown, implementation, review, verification and handoff.
- `uninstall-guard` lifecycle guard and the `dsh-oh-my-workflow` CLI
  (`status`, `doctor --fix`, `uninstall`).
- `scripts/verify-manifest.mjs` manifest consistency check, wired into
  `npm test` and `prepublishOnly`.
