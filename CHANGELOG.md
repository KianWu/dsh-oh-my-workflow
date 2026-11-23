# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
