# SpecToPR

An evidence-driven Claude Code and Codex plugin that turns a brief, a legacy change request, a user-facing feature, or a Figma design into verified implementation and, when requested, a draft PR/MR.

Korean version: [README.ko.md](README.ko.md)

## Four delivery modes

| Mode      | Give SpecToPR                              | What it verifies                                                    | Result                                      |
| --------- | ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------- |
| `brief`   | a brief/spec and target repository         | acceptance criteria, contracts, implementation, focused checks      | evidence-backed draft PR/MR                 |
| `legacy`  | a repository and a concrete change request | a focused current-behavior baseline and affected regression scope   | evidence-backed draft PR/MR                 |
| `feature` | a user-facing feature request              | changed-feature E2E only and exactly one `.webm` or `.mp4` video    | draft PR/MR with the video linked           |
| `figma`   | a Figma URL and target repository          | real Figma context, implementation, visual and interaction evidence | design implementation; optional draft PR/MR |

`auto` remains available for lightweight requests that do not need a mode-specific evidence policy.

Delivery mode controls delivery and evidence; input sources compose independently. A zero-to-100 `feature` run can combine `briefPath`, `figmaUrl`, repeated `docsPaths`, repeated `openApiPaths`, `guidancePaths`, and optional `skillHints`. Any supplied Figma URL requires a real bundle even when the mode is `feature`. Project guidance is traceable but excluded from scope classification. Instruction precedence is the current user request, explicit guidance, automatically discovered project guidance, applicable installed skills, then SpecToPR defaults. Missing optional skills never block a Run.

Feature mode accepts one unchained Playwright invocation that selects the changed feature by test path, tag, or project; listing and pass-with-no-tests options plus broad/full-project commands are rejected. Its strict JSON result contains only `status: passed`, the exact `selector`, the submission's `implementationContextId`, and a positive `testCount`. Its one video must be a structurally valid WebM/MP4 container with non-zero duration and be no larger than 25 MB. Other modes do not record feature video unless their delivery profile explicitly requires it.

Any delivery profile with a supplied `figmaUrl` uses the Figma capability already connected to the host. It submits exactly one `figma-bundle` with `provider: host-connected-figma`, ISO `capturedAt`, matching `fileUrl`, non-empty `nodeIds`, a declared `manifestPath`, and one or more actual PNG files. The strict manifest repeats that provenance and lists the PNG `visualPaths`. SpecToPR does not expose Figma microtools or poll Figma.

## Lightweight v2 surface

The public runtime is intentionally small:

- **7 MCP tools:** `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`
- **8 durable stages:** intake, contracts, implementation, functional review, design review, report, publish, archive
- **9 skills:** `spec-to-pr`, `doctor`, `intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, `archive-openspec`, `prepare-release`
- **2 independent reviewers:** `functional-reviewer` and conditional `design-reviewer`

API and UI implementation stay in one context. For API-backed UI, the agent first submits distinct physical, non-empty types, schemas, wrappers, mocks, and a passing JSON contract-test result with a stable `implementationContextId` as an explicit `api-ready` checkpoint; path, symlink, or hard-link aliases do not count as separate evidence. Final implementation must repeat that ID. `apiReady: true` alone is not evidence. There are no separate API/UI implementation agents and no integration lane. After implementation, the orchestrator freezes a `workflow_status` snapshot, contracts, diff, and evidence paths for each independent reviewer; reviewers return verdict payloads without calling workflow tools.

Immediately after intake, `workflow_status` reports an `XS`–`XL` workload, estimated token range, confidence, reasons, an 80% checkpoint threshold, and the authoritative required-validation list. Contract authors may submit non-empty numeric `workloadSignals` to refine it without adding a tool or stage. The same status carries a compact `resumeContext` with the recorded goal, project-relative evidence paths, and submission summaries. The SDK pins the first durable Run ID, instructs each turn to stop after one workflow action group, requires a fresh status at every completed boundary, never lets later statuses shrink required validation, sums actual input plus output tokens, and starts a compact fresh thread at the first boundary at or above 80%. At the hard limit it keeps every required validation and returns `split-required`; there is no caller-selected token allowance. Numeric-only fresh completed-run history may calibrate only the displayed range. The automatic hard limit stays at the workload class default, and legacy samples recorded with a different hard limit are excluded from calibration. Missing usage stops continuation as `usage-unavailable`. History writes are serialized and atomic, storage is bounded and revalidated on every access, prompts/code/diffs/paths/tool output/final responses are never stored, and optional history I/O cannot fail the workflow.

Publishing only creates or updates a draft GitHub PR or GitLab MR. Draft flows work on a non-target `codex/*` source branch and commit only intended changes before publication; runtime preflight requires a clean tree and at least one source commit beyond the target. Publishing never merges, approves, closes, or marks a review request ready.

## Requirements

- Node.js `>=22`
- Git
- Claude Code or Codex
- `pnpm` only when building from source
- authenticated `gh`/`glab` or a supported token when publishing
- a host-connected Figma capability whenever a Figma URL is supplied
- a browser test setup capable of recording video only for user-facing feature mode

## Install

### Claude Code

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

### Codex

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

Restart the host after installation. Run Doctor before the first workflow:

```text
/spec-to-pr:doctor
```

For local development:

```bash
git clone https://github.com/dhyun2/spec-to-pr.git
cd spec-to-pr
corepack enable
pnpm install
pnpm build
pnpm plugin:validate
```

## Examples

Brief to draft PR:

```text
/spec-to-pr /path/to/app
Mode: brief. Brief: docs/checkout.md. Implement it, verify it, and publish a draft PR.
```

Focused legacy change:

```text
/spec-to-pr /path/to/legacy-app
Mode: legacy. Change only the invoice retry behavior. Capture the current behavior first,
run affected checks, and publish a draft PR. Do not scan or migrate the whole product.
```

Zero-to-100 user-facing feature with composable sources:

```text
/spec-to-pr /path/to/app
mode: feature
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiPaths: [docs/openapi.yaml]
docsPaths: [docs/business-rules.md, docs/error-cases.md]
guidancePaths: [docs/architecture/ARCHITECTURE.md, docs/etc/folder-structure.md]
skillHints: [react-best-practices, next-best-practices, design-system, api-generator]
Implement checkout in one API/UI context. Run only its targeted E2E, record exactly one
video, verify project guidance and applied optional skills, and publish a draft PR.
```

Figma implementation:

```text
/spec-to-pr /path/to/app
Mode: figma. Implement https://www.figma.com/file/... using the connected Figma capability.
Submit real Figma evidence; do not use URL-only claims or polling.
```

## Codex SDK runner

The SDK runner is for CI and internal automation:

```bash
pnpm --dir packages/codex-sdk install
pnpm --dir packages/codex-sdk build
node packages/codex-sdk/dist/cli.js \
  --cwd /path/to/app \
  --mode feature \
  --change-kind feature \
  --prompt "Add the saved-address selector" \
  --publish
```

Use `--brief`, `--figma`, repeated `--openapi`/`--docs`, `--guidance`, and `--skill` for source inputs and optional installed-skill hints. `--publish` requests a draft; `--no-publish` stops after evidence-backed implementation and review. `--max-turns`, `--usage-history`, and `--no-usage-calibration` control bounded automation and numeric-only calibration.

`--resume <task-id>` continues the existing durable Run from the latest `workflow_status` and `resumeContext`; it does not repeat intake or create a duplicate Run.

See [packages/codex-sdk/README.md](packages/codex-sdk/README.md) for the complete runner contract.

## Verification policy

Normal changes run available formatting/lint, typecheck, build, and focused functional checks selected by applicability. OpenSpec, architecture, targeted security, visual, accessibility, and performance evidence are conditional. Observability is opt-in. Missing optional scripts are not applicable; missing, empty, skipped, or failed required evidence blocks.

Full test matrices, archive integrity, package verification, and cross-host manifest checks are release-only. They are not added to every feature or fix.

Repository checks:

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm plugin:validate
```

## Documentation

The maintained guide is at **https://dhyun2.github.io/spec-to-pr/**. It covers prerequisites, installation, the four cases, the v2 pipeline, skills, configuration, and troubleshooting.

[Start with the brief-to-PR guide](https://dhyun2.github.io/spec-to-pr/en/usage/brief) for required inputs, copyable prompts, execution phases, blockers, evidence, and illustrative draft PRs. The Usage sidebar links the other three cases separately.

Run it locally with:

```bash
pnpm --dir website install
pnpm --dir website start
```

The current architectural decisions are [ADR 035](docs/adr/035-use-coarse-workflow-facade-and-split-reviews.md), [ADR 036](docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md), and [ADR 037](docs/adr/037-use-boundary-budgeting-and-numeric-calibration.md).
