# ADR 035: Use a Coarse Workflow Facade and Split Reviews

- Status: Accepted
- Date: 2026-07-13

## Context

The original architecture exposed implementation details as dozens of MCP tools, stages, skills, agent lanes, and task documents. Model context and protocol coordination dominated runtime even when the deterministic repository checks were fast. Separate API and UI agents also forced an integration step while UI validation still depended on API wrappers and mocks.

The durable evidence ledger, artifact storage, stage leases, safe publisher adapters, and explicit post-merge archive remain useful. The public workflow does not need to mirror each internal service.

## Decision

SpecToPR v2 keeps local stdio MCP and the durable evidence model, but exposes exactly seven workflow tools:

1. `workflow_info`
2. `workflow_start`
3. `workflow_advance`
4. `workflow_submit`
5. `workflow_status`
6. `workflow_publish`
7. `workflow_archive`

The orchestrator owns exactly eight durable stages:

1. `intake`
2. `contracts`
3. `implementation`
4. `functional-review`
5. `design-review`
6. `report`
7. `publish`
8. `archive`

The installed plugin exposes nine skills: `spec-to-pr`, `doctor`, `intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, `archive-openspec`, and `prepare-release`.

Implementation uses one context. For API-backed UI, distinct physical non-empty types, schemas, wrappers, mocks, and a passing JSON contract-test result are submitted with a stable `implementationContextId` through the existing `workflow_submit` boundary as an explicit `api-ready` checkpoint. Path, symlink, and hard-link aliases are rejected. Final implementation must repeat the ID before UI completion evidence is accepted. A final boolean claim cannot replace that evidence. There are no separate API/UI implementation lanes and no integration worktree lane.

Review is deliberately split into only two independent roles:

- `functional-reviewer` for code scope and required functional gates;
- `design-reviewer` only when UI scope applies.

The orchestrator calls `workflow_status` and freezes its snapshot with accepted contracts, the diff, and evidence paths before dispatch. Reviewers consume that immutable packet and return literal schema-shaped verdicts; they do not call workflow tools or mutate implementation.

The default gates are proportional to the change. Missing optional scripts are not applicable; missing or failed required evidence blocks. Full matrices, tracked-archive integrity, package verification, and cross-host checks are release-only.

Publication only creates or updates a draft PR/MR. It never merges, approves, closes, or marks a review request ready. Archive is a separate, explicit post-merge action supported by authoritative merge evidence; the runtime does not poll for merge state.

## Consequences

- Public tool schemas and normal round trips are much smaller.
- API mocks are available before UI and design validation.
- Non-UI work never waits for design review.
- Internal services may evolve without expanding the public facade.
- v1 microtools, task graphs, specialist lanes, Review Council, and their documentation are intentionally unsupported.
- Existing evidence, persistence, lease, publisher, and archive foundations remain behind the facade.
