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
  --min-visual-score 0.9 \
  --max-repair-attempts 3
```

The runner prints a JSON payload with the Codex thread ID, final response, and
token usage. Store the thread ID when you want to resume the same automation
conversation later.

## Review And Repair Defaults

The runner asks Codex to spawn review subagents for visual regression,
accessibility, performance, security, observability, and PR-report consistency
when subagent workflows are available. If subagents are unavailable, the same
lanes are run sequentially.

When Figma evidence exists, the runner requires a bounded visual repair loop:
Design/UI repair, visual capture, comparison, and `evaluate_visual_repair_loop`.
The default threshold is `0.9` and the default cap is `3` attempts.

Before PR reporting, the runner requires lint, typecheck, build, functional,
OpenSpec, accessibility, performance/Web Vitals, security, observability, and
Figma visual comparison evidence when applicable. `generate_pr_report` is called
with Korean output by default unless the user explicitly requests English.

When the run reaches PR reporting and the report decision is not blocked, the
runner instructs Codex to call `publish_review_request` with `confirm: true`.
That creates or updates a draft PR/MR with the generated report artifact as the
base body. It never merges, approves, closes, or marks the request ready for
review.

If visual PNG evidence exists, publishing uploads Figma, browser, and diff
images to the review host and injects a localized visual evidence preview
section so the PR/MR body renders the comparison directly.
