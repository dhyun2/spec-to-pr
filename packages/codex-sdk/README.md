# spec-to-pr Codex SDK Runner

This package is a programmatic Codex entry point for spec-to-pr workflows.

It is intentionally separate from the root plugin package:

- the root package ships the MCP kernel and installable plugin manifests;
- this package controls Codex from automation, CI, or internal tools;
- users who only install the Claude or Codex plugin do not need the SDK.

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Run

```bash
node dist/cli.js \
  --cwd /path/to/app \
  --brief docs/plan.md \
  --docs docs \
  --figma https://figma.com/file/... \
  --openapi docs/openapi.yaml \
  --min-visual-score 0.98 \
  --max-repair-attempts 3
```

The runner prints a JSON payload with the Codex thread ID, final response, and
token usage. Store the thread ID when you want to resume the same automation
conversation later.

## Workflow v2 Defaults

Runner prompts use only the seven public facade tools: `workflow_info`,
`workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`,
`workflow_publish`, and `workflow_archive`. The workflow service handles
sequencing, retries, compact status, report generation, and safe publication.

Implementation stays in one Codex context. For API-backed UI work, API types,
schemas, wrappers, mocks, and contract-test evidence must be submitted at the
`api-ready` checkpoint before UI completion evidence. API and UI work are not
split into separate agents or worktrees.

Code scope requests a `functional-reviewer`. UI scope adds an independent
`design-reviewer`; non-UI scope does not invoke or wait for design review. When
a Figma or legacy visual baseline exists, the UI context uses a bounded repair
loop with a default score of `0.98` and a default cap of `3` attempts.

## Fast Default And Release-Only Gates

The normal workflow runs available lint/format, typecheck, build, and one
relevant functional test for code changes. OpenSpec, architecture, targeted
security, visual, accessibility, and performance gates are conditional on the
classified scope. Observability is opt-in. Missing optional scripts are not
applicable; missing or failed required evidence blocks.

Full test matrices, hardening suites, package verification, and cross-host
manifest validation are release-only gates. They run only for an explicit
release workflow, not for every feature run.

`workflow_publish` creates or updates a draft PR/MR only after the workflow is
ready. It never merges, approves, closes, or marks the request ready for review.
`workflow_archive` remains an explicit post-merge action.
