# Third-party notices

`dsh-oh-my-workflow` is released under the MIT License (see `LICENSE`).

This package bundles method/skill texts adapted from third-party MIT-licensed
projects. Those works remain under their original licenses and copyrights. The
in-repo file `preset/skill-sources.json` records, per skill, the exact upstream
path and every local adaptation applied.

## Matt Pocock skills

- Repository: https://github.com/mattpocock/skills
- Commit: `5863806dd4e15c63174bee4e7515a4256792ecfa`
- License: MIT
- Copyright: Copyright (c) 2026 Matt Pocock

Skills derived from this upstream: `code-review`, `codebase-design`,
`domain-modeling`, `grill-with-docs`, `grilling`, `handoff`, `implement`,
`implement-spec`, `improve-codebase-architecture`, `to-spec`, `to-tickets`,
`wayfinder`.

Local adaptations: catalog descriptions shortened for token cost; a few
tracker/setup instructions were replaced with a local markdown tracker under
`.agent/workflow/`; TDD references were relaxed to "write a failing test at the
pre-agreed seam when the project has a test framework, otherwise do a minimal
implementation and verify with a real command".

## dsh-stack

- Repository: https://github.com/58fly/dsh-stack
- Version: 0.3.3
- Upstream: https://github.com/aicodeking/deepseek-stack
- License: MIT
- Copyright: Copyright (c) 2026 AICodeKing; dsh-stack contributors

Skills derived from this upstream: `st-context-reset`, `st-ledger`,
`st-plan-loop`, `st-ready`, `st-review-loop`, `st-unstick`, `st-verify-loop`.

Local adaptations: catalog descriptions shortened for token cost; skill bodies
kept as-is.

## Original to this project

- License: MIT
- Copyright: Copyright (c) 2026 dsh-oh-my-workflow contributors

Skills original to this project: `wf-route`, `wf-project-init`, `wf-engineering`.

## Original to this project (no third-party provenance)

- `preset/behavior.mjs` — the behavioural contract. The rules are an original
  Chinese distillation of the behaviours that measurably reduce wasted turns
  (act on the most likely reading, finish in one turn, never re-derive settled
  facts, report only observed results, brief a subagent like a colleague).
  They were written for this preset's own three-tier routing and OPS tool
  surface. No third-party prompt text is copied or translated.
- `preset/compaction.mjs` — the checkpoint directive and the instance patch.
  The nine-section shape is aligned with the host's own default directive so
  the durable checkpoint stays compatible; the wording, the `<analysis>`
  scratchpad, the pruned-tool-result rules and the "all user messages" section
  are this project's.

The `dsh-claude-preset` project (MIT) was read while designing these two
modules, and its four mechanics — persona replacement, scoped tool-description
shadowing, plan structure, compaction subclassing — informed the trade-offs
recorded in CHANGELOG. No file from that project is vendored here.

## MIT License text (applies to the third-party portions above)

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
