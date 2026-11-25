# dsh-oh-my-workflow

> 开箱即用的 AI 软件交付工作流 —— a DeepSeek Harness agent preset that turns the agent into a disciplined software-delivery line: it sizes each task, loads the right method skill, and refuses to call a change "done" without real verification evidence.

`dsh-oh-my-workflow` 是一个 DeepSeek Harness 代理预设插件。它把「先想清楚、保持简单、只做必要修改、以可验证目标驱动执行」落成一条可执行流水线：需求追问 → 写规格 → 拆工单 → 实现 → 评审 → 验证 → 交接。

- **三档推进**：按目标清晰度与风险，自动判断 **快速 / 标准 / 深入** 三档；快速档直接改并验证，标准档先给 3–6 步计划，深入档先澄清/建模/写规格再实现。
- **22 个技能**：覆盖需求追问、写规格、拆工单、实现、评审、验证与交接（来源与许可见 [NOTICE.md](NOTICE.md)）。
- **轮次守卫**：每轮结束前要求「改完必须真验证」的行为证据（默认 balanced：首个改动后的任意一次成功验证即算数，收尾小改动不再反复打回）；同一种修法连续失败两次就停下来重新核对共同前提，避免 AI 反复瞎改。
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

- **Preset `workflow`**（显示名 `Workflow`）：自定义 persona、三档推进纪律、`agent-instructions` 工作区规则注入。
- **OPS Native 集成**：通过公开的 `dsh-ops/integration` 入口接入文件/Shell/渐进发现工具，不碰私有 `lib/*` 路径。
- **Turn guard（`turn-guard.mjs`）**：在轮次收尾的串行钩子上读取本轮日志；发现「改了文件却没有任何成功验证」或「同一修法重复失败」时，回灌一条短消息让本轮再走一步；守卫自身失败不阻塞回合。默认 `evidenceScope: balanced`（首个改动后验证一次即通过），`assumeOfficialShellSuccess: true`（官方 bash/pwsh 非零才输出退出码，非 error 即视为成功）；需要旧严格语义时设 `evidenceScope: strict`。
- **22 个技能**：见下方清单，全部随包内置，挂载时从本包目录加载。
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
