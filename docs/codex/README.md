# Codex Integration

spec-to-pr exposes two Codex surfaces:

1. **Codex plugin**: installable UX for Codex app and CLI users. It bundles the
   shared `skills/` workflows and the local stdio MCP kernel.
2. **Codex SDK runner**: programmatic automation entry point for CI, internal
   tooling, and multi-agent orchestration outside the interactive Codex UI.

Use the plugin when a person should install and invoke spec-to-pr from Codex.
Use the SDK runner when another process should start Codex, provide a brief, and
collect the final response or thread ID.

## Local Plugin Testing

The repo root is the plugin package. The repo-local marketplace lives at:

```text
.agents/plugins/marketplace.json
```

To test in Codex, add this repo as a marketplace source and install
`spec-to-pr` from the plugin directory:

```bash
codex plugin marketplace add .
```

Then restart Codex, open `/plugins`, select the `Spec to PR Local` marketplace,
and install `spec-to-pr`.

In Codex, the plugin MCP tools are exposed under the normalized
`mcp__spec_to_pr__*` namespace. If a thread loads the skills but says the MCP
tools are not visible, start a new thread or ask Codex to search for
`spec-to-pr kernel_info create_run` tools before running `Doctor`.

## SDK Runner

The SDK runner scaffold lives in `packages/codex-sdk`. It intentionally stays
separate from the root package so the Claude/Codex plugin kernel does not take a
runtime dependency on the Codex SDK.

```bash
cd packages/codex-sdk
pnpm install
pnpm build
node dist/cli.js --cwd /path/to/app --brief docs/plan.md --figma https://figma.com/file/...
```

The runner starts or resumes a Codex thread, asks Codex to use the installed
spec-to-pr plugin when available, and keeps the same evidence-first reporting
rules as the interactive workflow.

## Review Agents And Visual Repair

Codex support includes project-scoped custom agents under `.codex/agents/` for
visual review, review council aggregation, and Design/UI repair. The SDK runner
also emits review-lane instructions so Codex can spawn subagents when the host
supports subagent workflows, or run the same lanes sequentially when it does
not.

The default visual repair policy is:

- minimum visual score: `0.9`
- maximum repair attempts: `3`
- score metric: `reviewMatchRatio`

The shared `Run Visual Repair Loop` skill calls `evaluate_visual_repair_loop`
after each visual comparison. A `retry` or `failed` decision blocks PR report
publishing until the Design/UI lane repairs the failing targets or the loop
exhausts and reports a human-review blocker.

## Publishing Boundary

`Spec To PR` end-to-end runs should publish the generated PR report as a draft
PR/MR when the report decision is not blocked. The publisher uses the generated
`pr-report.md` artifact as the base review request body; it must not write a new
body from memory.

When visual comparison PNG artifacts exist, the publisher uploads Figma,
browser, and diff images to the review host and injects a `Visual Evidence
Preview` section into the PR/MR body. GitLab uses project markdown uploads.
GitHub publishes the images to the source branch under `.spec-to-pr/visual-assets/`
and links their raw URLs.

Publishing means creating or updating a draft GitHub Pull Request or GitLab
Merge Request. It does not merge, approve, close, or mark the request ready for
review.
