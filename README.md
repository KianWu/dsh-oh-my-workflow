# dsh-oh-my-workflow

> 开箱即用的 AI 软件交付工作流 —— a DeepSeek Harness agent preset that turns the agent into a disciplined software-delivery line: it sizes each task, loads the right method skill, and refuses to call a change "done" without real verification evidence.

`dsh-oh-my-workflow` 是一个 DeepSeek Harness 代理预设插件。它把「先想清楚、保持简单、只做必要修改、以可验证目标驱动执行」落成一条可执行流水线：需求追问 → 写规格 → 拆工单 → 实现 → 评审 → 验证 → 交接。

- **三档推进**：按目标清晰度与风险，自动判断 **快速 / 标准 / 深入** 三档；快速档直接改并验证，标准档轻量澄清一轮（目标明确则跳过，不为问而问）后给 3–6 步计划，深入档澄清/建模/落盘文档后**停在执行前**——何时调 implement 执行由你决定。
- **行为规范段**（借鉴 Claude Code 行为系统提示词的机制，中文原创蒸馏）：把「信息足够就动手、一轮之内做完、不重新论证已定的事、只报告实际发生的事、默认不写注释、子代理简报要像交代给刚进门的同事」写成常驻提示词段，从源头减少空转轮次——这是省 token 的主要来源。
- **多 agent 协作**：深入档 / 复杂 / 长任务默认不是单线程扛到底——能拆出 2 个以上独立子任务时，用 `subagent` / `subagent_fork` 并行委派（宽搜索、批量阅读、独立评审、批量扇出走 `workflow`），主线只保留目标、决策与集成，子代理只回传结论与证据，避免上下文膨胀。
- **22 个技能**：覆盖需求追问、写规格、拆工单、实现、评审、验证与交接（来源与许可见 [NOTICE.md](NOTICE.md)）。
- **轮次守卫**：每轮结束前要求「改完必须真验证」的行为证据（默认 balanced：首个改动后的任意一次成功验证即算数，收尾小改动不再反复打回）；同一种修法连续失败两次就停下来重新核对共同前提，避免 AI 反复瞎改。
- **结构化压缩**：在宿主压缩引擎之上替换总结指令，加入 `<analysis>` 草稿与九段式检查点、明确说明被裁剪工具结果的处置方式、单独保留「所有用户消息」，并在落盘前剥离草稿；阈值、保留策略、溢出恢复与检查点锁仍由宿主负责。
- **可优雅卸载**：卸载时先清理默认预设指针，避免悬空指针让新会话启动失败。

## Install

```sh
# from npm (prebuilt)
dsh plugin --profile web add dsh-oh-my-workflow

# or straight from GitHub
dsh plugin --profile web add github:KianWu/dsh-oh-my-workflow
```

安装后，在预设列表中选择 **Workflow**（预设 id 为 `workflow`）。要求 DeepSeek Harness `>=0.2.2-rc.1 <0.2.3-0`。

## What you get

- **Preset `workflow`**（显示名 `Workflow`）：自定义 persona、三档推进纪律、复杂任务多 agent 并行委派纪律、`agent-instructions` 工作区规则注入。
- **行为规范段（`behavior.mjs`）**：独立注册 `workflow:behavior` 段落（order 1，`interpolate: false`）。放在独立行而不是塞进 `persona.prefix`，是因为 persona 会严格插值——正文里任何一个 `{{` 都会让会话在首次渲染时直接失败；独立段落还能单独关闭。
- **OPS Native 集成**：通过公开的 `dsh-ops/integration` 入口接入文件/Shell/渐进发现工具，不碰私有 `lib/*` 路径。
- **Turn guard（`turn-guard.mjs`）**：在轮次收尾的串行钩子上读取本轮日志；发现「改了文件却没有任何成功验证」或「同一修法重复失败」时，回灌一条短消息让本轮再走一步；守卫自身失败不阻塞回合。默认 `evidenceScope: balanced`（首个改动后验证一次即通过），`assumeOfficialShellSuccess: true`（官方 bash/pwsh 非零才输出退出码，非 error 即视为成功）；需要旧严格语义时设 `evidenceScope: strict`。
- **结构化压缩（`compaction.mjs`）**：在 `compaction-basic` 之后包装宿主已挂载的引擎实例，只替换总结指令并剥离 `<analysis>`。它取 `ctx.get('compaction')` 而不 import `@deepseek-ai/dsh-compaction-basic`——那个包在 DSH 应用归档内，profile 侧解析不到，导入失败会让整个压缩组失去引擎。取不到引擎或补丁失败时只记一条日志，宿主行为完全不变。
- **22 个技能**：见下方清单，全部随包内置，挂载时从本包目录加载。
- **与宿主 goal 模式的协作**：`create_goal` 建立持久目标后由宿主自动续跑推进。推荐把 goal 开在「按规格执行」阶段（自动续跑会推着模型把整份规格做完）；深入档的澄清/建模/落盘阶段不要建 goal——那几轮的停顿点由你掌控。轮内守卫与轮间 goal 互补：unstick 在轮内止损，`blocked`（默认 3 轮同阻塞才可标记）在轮间上报。跨会话接力仍走 `PROGRESS-<task-slug>.md`。
- **Uninstall guard + 生命周期 CLI**：`dsh-oh-my-workflow status | doctor [--fix] | uninstall`。

## The 22 skills

| 分组 | 技能 |
| --- | --- |
| 入口与工程基线（本项目原创） | `wf-route`, `wf-project-init`, `wf-engineering` |
| 工程方法（Matt Pocock 技能包，MIT） | `grilling`, `grill-with-docs`, `domain-modeling`, `codebase-design`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `code-review`, `improve-codebase-architecture`, `wayfinder`, `handoff` |
| 栈式循环（dsh-stack，MIT） | `st-plan-loop`, `st-review-loop`, `st-verify-loop`, `st-unstick`, `st-ledger`, `st-context-reset`, `st-ready` |

## CLI

```sh
dsh-oh-my-workflow status                    # 查看各 profile 安装状态与默认预设指针
dsh-oh-my-workflow doctor [--fix] [--dry-run] # 体检并修复悬空指针/残留行
dsh-oh-my-workflow uninstall [--dry-run] [--yes]
```

## Develop

```sh
npm test        # 单元测试 + 装配/技能/清单/挂载/宿主契约校验
npm run verify:mount   # 需要可读的 DSH 安装，无则 SKIP
```

## License

MIT（见 [LICENSE](LICENSE)）。内置技能的第三方署名与许可见 [NOTICE.md](NOTICE.md)。
