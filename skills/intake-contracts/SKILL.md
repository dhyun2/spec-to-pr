---
name: intake-contracts
description: Use when a v2 workflow requests intake or contract preparation from a brief, OpenAPI evidence, Figma evidence, or repository context.
---

# Intake and Contracts

Start with `workflow_status`, then use `workflow_advance` to confirm the `prepare-contracts` action.

Collect only supplied or repository-backed requirements. Resolve applicable scope, acceptance criteria, API operations and schemas, design evidence, and explicit gaps. Never invent undocumented API or UI behavior.

Record the result with `workflow_submit` as a `contracts` submission containing `passed`, `failed`, or `blocked`, a compact summary, and artifact paths. Use `blocked` when required evidence is absent. Advance only after the accepted submission is visible in status.
