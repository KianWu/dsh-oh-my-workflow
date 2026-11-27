# dsh-oh-my-workflow

> 一个 DeepSeek Harness 代理预设：把软件交付的纪律——任务分级、方法技能、真实验证——组装进每次会话。

`dsh-oh-my-workflow` 将 AI 编程助手约束为一条可验收的交付流水线。任务先分级，再选方法，最后以真实验证收尾。

## 设计来源

本插件在以下已有工作的基础上组合而成：

- **Karpathy 的 AI 编程四原则**（先想清楚、保持简单、只做必要修改、以可验证目标驱动执行）——整体设计基线。
- **Claude Code 的行为系统提示词**——行为规范段参考其组织方式；正文为本项目中文撰写。
- **Matt Pocock 工程技能包**（MIT）——12 个工程方法技能，覆盖澄清、建模、写规格、拆工单、实现与评审。
- **dsh-stack**（MIT，源自 aicodeking/deepseek-stack）——7 个栈式循环技能，覆盖计划/评审/验证循环、止损与长任务接力。
- **DSH 宿主 standard 预设**——预设正文逐行镜像它作为组合基座，本插件在其上插入五个本地行。
- **dsh-ops**——文件、Shell 与渐进发现工具面，作为 peer dependency 通过公开的 `dsh-ops/integration` 入口接入。

各来源的具体署名与许可见 [NOTICE.md](NOTICE.md)。

## 核心机制

**三档路由。** 每个任务在开始时判定档位，并在首次回复中声明理由：

- *快速档*：目标明确、改动小、风险低。读取必要代码后直接修改并验证，不创建任何过程文档。
- *标准档*：多文件改动或可见行为变化。先做一轮轻量澄清——只问答案会改变做法的问题，目标清楚则跳过——然后给出 3–6 步计划再实现。
- *深入档*：需求含糊、高风险或涉及结构变化。澄清与建模之后，将规格、计划、决策写入 `.agent/workflow/`，停在实现之前；何时执行、按什么顺序执行，由使用者决定。使用者要求连续推进时除外。

**行为规范段。** 一段约 2.5 KB 的常驻提示词，约束每轮的推进方式：信息足够就动手，不再论证已确定的事实；一轮之内做完整个任务，不提前交回控制权；只报告实际观察到的事情，失败写在第一句。这是本插件减少空转轮次、节约 token 的主要来源。

**轮次守卫。** 轮次结束前的串行钩子读取本轮日志，检查两条规则：本轮修改了文件却没有任何成功的验证命令；同一修法连续失败两次。违反时向会话回灌一条短消息，促使本轮继续。守卫自身抛错时只记录日志，不阻断回合。验证判定默认为 balanced 语义（首轮改动后的一次成功验证即算数），官方 shell 的无标记成功结果按 exit 0 采信；两条都有配置项可以关闭或收紧。

**结构化压缩。** 上下文接近窗口阈值时（默认 80% 与"窗口减 65,536 token 预留"取小，宿主默认值），宿主压缩引擎触发总结。本插件在引擎实例之上替换总结指令：要求先在 `<analysis>` 草稿中梳理对话，再产出九段式检查点；明确指示被裁剪的工具结果标记如何处置，不得臆测缺失内容；单独保留"所有用户消息"段，防止纠正性指令在压缩中丢失。落盘前剥离草稿。阈值、保留策略、溢出恢复仍由宿主负责；补丁失败时回退到宿主默认行为。

**多 agent 协作。** 复杂任务不由单线程承担。存在两个以上边界清晰的独立子任务，或需要宽搜索、批量阅读、独立评审时，用 `subagent`（全新上下文，可并行）或 `subagent_fork`（继承当前上下文）委派，大批量扇出用 `workflow`。主线只保留目标、决策与集成；子代理只回传结论与证据。子代理简报按"交代给刚进门的同事"的标准写：说明目标与背景、已查明的事实、期望的产出形式。

## 安装

```sh
dsh plugin --profile web add dsh-oh-my-workflow
dsh plugin --profile web add github:KianWu/dsh-oh-my-workflow   # 从源码安装
```

安装后重启 DSH，新会话的预设列表中选择 **Workflow**（预设 id：`workflow`）。要求 DeepSeek Harness `>=0.2.2-rc.1 <0.2.3-0`，dsh-ops `>=0.5.5 <0.6`（peer dependency，安装时自动解析）。

## 实现说明

预设正文逐行镜像宿主的 standard 预设，在其上插入五个本地行。关键取舍记录在此，细节见 [CHANGELOG](CHANGELOG.md)：

**行为规范段的独立注册。** persona 的 prefix 是严格插值的模板，正文里出现任何 `{{` 都会导致会话首次渲染失败。行为规范段因此注册为独立段落（order 1，`interpolate: false`），与身份槽解耦，也可单独禁用。它在渲染顺序上先于 plan:policy（order 500）与工具段落（order 1000+），并显式声明对前者的让位关系。

**压缩引擎的包装式接入。** `@deepseek-ai/dsh-compaction-basic` 位于 DSH 应用归档（`app.asar`）内，无法从 profile 侧解析；直接导入一旦失败，整个压缩组将失去引擎，比不压缩更糟。本插件因此在宿主引擎行之后挂载，通过 `ctx.get('compaction')` 取已挂载的实例，仅包装其 `summarize` 钩子。取不到引擎或补丁失败时记录一条日志，宿主行为不变。

**OPS 集成的边界。** 仅通过公开的 `dsh-ops/integration` 入口接入文件、Shell 与渐进发现工具，不引用其私有 `lib/*` 路径，不修改全局配置。集成作用域限定在本预设，其他预设不受影响。

**与宿主 goal 模式的分工。** `create_goal` 建立的持久目标由宿主在轮次间自动续跑。两者互补而非重叠：goal 适合"按规格执行"阶段，自动续跑推动模型完成整份规格；深入档的澄清与建模阶段应避免建立 goal，因其停顿点需要使用者控制。轮内止损由守卫的 unstick 规则承担，轮间上报由 goal 的 `blocked` 状态承担。跨会话的接力由长任务技能的 `PROGRESS-<task-slug>.md` 承担（每个任务一个文件，不互相覆盖）。

**卸载安全。** 卸载或停用时，生命周期守卫仅在默认预设指针指向 `workflow` 时将其复位到 standard，避免悬空指针导致新会话失败。不触碰其他预设的选择。

## 技能清单

22 个技能全部随包内置，挂载时从本包目录加载。来源与许可见 [NOTICE.md](NOTICE.md)。

| 分组 | 技能 |
| --- | --- |
| 入口与工程基线（本项目原创） | `wf-route`, `wf-project-init`, `wf-engineering` |
| 工程方法（Matt Pocock 技能包，MIT） | `grilling`, `grill-with-docs`, `domain-modeling`, `codebase-design`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `code-review`, `improve-codebase-architecture`, `wayfinder`, `handoff` |
| 栈式循环（dsh-stack，MIT） | `st-plan-loop`, `st-review-loop`, `st-verify-loop`, `st-unstick`, `st-ledger`, `st-context-reset`, `st-ready` |

其中五个技能（`to-spec`、`to-tickets`、`implement`、`implement-spec`、`improve-codebase-architecture`）设为 `disable-model-invocation: true`：模型不能自主加载它们，写规格、拆工单、按规格实现必须由使用者发起。这是深入档"文档优先、执行解耦"的权限层保障。

## CLI

```sh
dsh-oh-my-workflow status                     # 查看各 profile 的安装状态与默认预设指针
dsh-oh-my-workflow doctor [--fix] [--dry-run] # 检测并修复悬空指针与残留配置
dsh-oh-my-workflow uninstall [--dry-run] [--yes]
```

## 开发

```sh
npm test               # 模块加载烟测 + 单元测试 + 装配/技能/清单/挂载/宿主契约校验
npm run verify:mount   # 需要可读的 DSH 安装作为 DSH_ROOT，找不到时 SKIP
```

测试入口包含一个真实 import 所有本地行模块的烟测。0.4.0 曾因模板字符串中一处未转义的反引号导致预设无法挂载，静态检查未能拦截，此后加载验证成为发布前的强制步骤。

## 许可

MIT（见 [LICENSE](LICENSE)）。内置技能的第三方署名与许可见 [NOTICE.md](NOTICE.md)。
