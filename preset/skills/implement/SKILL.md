---
name: implement
description: "按规格或工单实现并验证。Use when a spec or tickets are ready to build."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

在预先约定的接缝处先写一条能因正确原因失败的测试（如果项目有测试框架）；没有测试框架时直接做最小实现，并用真实命令验证。不要为了形式新建测试框架。

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.
