# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
