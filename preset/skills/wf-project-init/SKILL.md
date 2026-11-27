---
name: wf-project-init
description: "初始化或补充 .agent/AGENTS.md 与 .agent/workflow 记录布局。Use when a code project lacks an entry document."
---

# wf-project-init — 项目入口与工作记录

## 何时执行

1. 每次进入代码项目先检查项目根目录的 `.agent/AGENTS.md`。
2. **已存在**：读取并遵循，不覆盖、不重建。只有用户明确要求，或项目结构/命令发生较大变化时，才补充相应事实。
3. **缺失**：即使当前是快速档，也要完成初始化；创建初稿后再继续原任务。
4. 非代码项目（纯文档、临时目录）不必初始化，除非用户要求。

## 初始化步骤

1. 扫描但不臆造：读取 `README`、`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`、锁文件、构建配置、CI 配置、`.editorconfig`、现有规范文档和目录结构。
2. 识别真实命令：安装、构建、测试、类型检查、运行、格式化。只写实际存在的脚本或配置；无法确认的写「待确认」。
3. 识别架构事实：入口文件、核心模块、数据流、关键接口、扩展点。只写能从代码或文档观察到的事实。
4. 识别规范真源：`CONTRIBUTING.md`、`docs/`、lint/format 配置、ADR、团队约定。**链接真源，不复制全文**。
5. 创建 `.agent/AGENTS.md`，使用下面模板。缺失的章节保留标题并写「待确认」，不要删除。
6. 只有深入档或长任务需要时才创建 `.agent/workflow/` 子目录；快速档不创建任何过程文档。

## `.agent/AGENTS.md` 模板

```markdown
# 项目入口

## 项目概述
（一句话说明项目做什么、给谁用；待确认则标注）

## 技术与运行环境
（语言、运行时版本、包管理器、平台要求）

## 常用命令
| 用途 | 命令 |
|---|---|
| 安装 | （待确认） |
| 构建 | （待确认） |
| 测试 | （待确认） |
| 类型检查 | （待确认） |
| 运行 | （待确认） |
| 格式化 | （待确认） |

## 架构概览
（核心数据流、模块职责、关键接口、扩展点）

## 项目规范真源
（链接到 CONTRIBUTING、docs、lint/format 配置、ADR；不要复制规则全文）

## 不变量与红线
（不可破坏的约束；没有则写「待确认」）

## 文档与过程记录位置
（长期文档位置；过程记录默认 `.agent/workflow/`）

## 外部依赖
（服务、数据库、第三方 API、必要的环境变量名）

## 分支与交付策略
（默认分支、提交/PR 约定、是否允许自动合并）

## 已知限制与环境注意事项
（平台限制、已知坑、不能自动验证的部分）
```

## 工作记录布局

项目没有既有约定时使用：

```text
.agent/
├─ AGENTS.md
└─ workflow/
   ├─ CONTEXT.md
   ├─ plans/
   ├─ specs/
   ├─ tickets/
   ├─ adr/
   ├─ PROGRESS-<task-slug>.md   （每个长任务一个）
   └─ handoff/
```

- 深入档：按需创建本次工作需要的 `specs/`、`plans/` 或 `adr/`。
- 长任务：每个任务维护专属的 `PROGRESS-<task-slug>.md`，配合 `tickets/`、`handoff/`；不同任务不共用一个进度文件。
- 快速档与普通标准档：不创建。
- 项目已有布局时优先遵循项目约定。

## 项目验证命令配置

项目可以把专用强验证命令写到 `.agent/workflow/verify.json`，守卫在首次进入该工作目录时读取并缓存：

```json
{
  "commands": ["npm run typecheck", "npm test", "cargo test"],
  "documentationSuffixes": [".md", ".mdx"]
}
```

`commands` 按子串匹配；只放真正能证明行为正确的命令。不要放 `echo`、`cat`、读回文件或无关命令。

## 规则优先级

```text
当前用户明确要求
  > 项目 AGENTS.md 与项目规范真源
  > workflow 通用工程基线
  > 模型自身习惯
```

## 完成标准

- `.agent/AGENTS.md` 存在，十个通用章节齐全。
- 命令来自实际配置，未知项标注「待确认」。
- 规范真源是链接而非副本。
- 没有覆盖任何已有项目文档。
