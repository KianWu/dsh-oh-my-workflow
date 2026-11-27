---
name: st-context-reset
description: "维护 PROGRESS.md 供新会话继续。Use when handing long work to a new session."
---

# st-context-reset

Store the state of the work in a file, not in the chat, so a fresh context can continue without drift.

## Steps

1. At the start of a long task, name the progress file after the task (`PROGRESS-<task-slug>.md`, e.g. `PROGRESS-mdx-migration.md`) under `.agent/workflow/` and create it with these sections:
   - **Goal**: one or two sentences, plus the acceptance check for the whole task.
   - **Done**: the verified steps, each with the command and result that proved it.
   - **Next**: the ordered steps that remain. The first item is the exact next action.
   - **Open questions**: unknowns and decisions that wait for the user.
   - **Key facts**: paths, commands, versions, gotchas, and approaches that failed (with the reason).
   A file for this task already exists only if its **Goal** still describes the current task; then continue it instead of creating a new one. A file whose Goal names a DIFFERENT task is another task's state — never overwrite, never delete it, and never append to it.
2. Update the progress file after every verified step. Do not update it for unverified ones. Commit the code and the file together with a descriptive message.
3. Watch for reset signals: you repeat an earlier answer, you forget a fact that is in Key facts, you retry a fix that failed, the same file gets reread many times, or the context is more than about half full.
4. When a signal appears, finish or revert the current step so the tree is in a known state.
5. Rewrite the progress file as a complete handoff. A reader who has only this file and the repo must be able to continue. Remove chatter and keep the facts.
6. Start a fresh session or subagent. Give it one instruction: "Read the progress file for <task-slug> under `.agent/workflow/` and `git log -5`, run the acceptance check for the last Done item, then do the first item in Next."
7. In the new context, confirm that the baseline check passes before you make new edits. If it fails, fix that first.

## Stop when

- The goal's acceptance check passes and PROGRESS.md shows every item as Done.
- You have done 3 resets on one Next item without progress. Stop and ask the user, with the file as your report.

## Rules

- The progress file holds facts and evidence, not plans that nobody has checked.
- Keep it under about 150 lines. Move old Done items into a short summary line.
- Never put secrets or tokens in it.
- The fresh context reads the file, not the old transcript.
- One task, one file. Two concurrent long tasks get two files; a finished one is never overwritten by a new task.
- Pair with st-plan-loop for the Next list and with st-unstick for the failed-approach notes.
