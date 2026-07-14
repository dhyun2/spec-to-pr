# SpecToPR Codex SDK Runner

This package starts a Codex task with the installed SpecToPR plugin and collects the final response, task ID, workload estimate, budget state, and token usage. It is intended for CI and internal automation; interactive plugin users do not need it.

## Install and build

```bash
pnpm install
pnpm build
```

## Delivery modes

The runner passes one delivery profile to the shared v2 workflow:

| `--mode`  | Required source              | Conditional behavior                                               |
| --------- | ---------------------------- | ------------------------------------------------------------------ |
| `brief`   | `--brief <path>`             | preserves supplied acceptance criteria                             |
| `legacy`  | a concrete `--prompt`        | captures a focused current-behavior baseline                       |
| `feature` | a user-facing feature prompt | runs only the changed-feature E2E and records exactly one video    |
| `figma`   | `--figma <url>`              | uses the host Figma capability and submits one real `figma-bundle` |
| `auto`    | none                         | activates no mode-specific evidence by default                     |

The modes share one pipeline. They do not add tools, durable stages, implementation lanes, or reviewers.

## CLI

```bash
node dist/cli.js \
  --cwd /path/to/app \
  --mode brief \
  --change-kind feature \
  --brief docs/plan.md \
  --openapi docs/openapi.yaml \
  --publish
```

Options:

| Option                   | Meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `--cwd <path>`           | target repository; required                                            |
| `--prompt <text>`        | requested change or extra constraints                                  |
| `--mode <mode>`          | `auto`, `brief`, `legacy`, `feature`, or `figma`                       |
| `--change-kind <kind>`   | `auto`, `feature`, `fix`, `refactor`, `migration`, `design`, or `docs` |
| `--brief <path>`         | brief/spec source                                                      |
| `--docs <path>`          | supporting documentation source                                        |
| `--figma <url>`          | Figma file or node URL                                                 |
| `--openapi <path>`       | OpenAPI source                                                         |
| `--publish`              | create or update a draft PR/MR when ready                              |
| `--no-publish`           | stop after evidence-backed implementation and review                   |
| `--resume <task-id>`     | resume an existing Codex task                                          |
| `--model <model>`        | optional model override                                                |
| `--max-turns <n>`        | maximum workflow action-group turns; default `12`                      |
| `--usage-history <p>`    | numeric-only JSONL calibration path                                    |
| `--no-usage-calibration` | disable calibration reads and writes                                   |
| `--no-review-agents`     | omit independent reviewer instructions                                 |

Without an explicit mode, a Figma URL resolves to `figma`, a brief resolves to `brief`, and other requests resolve to `auto`. Brief, legacy, and feature profiles request draft publication unless `--no-publish` is supplied. Figma profile defaults to implementation without publication; use `--publish` when a draft PR/MR is wanted.

## Feature evidence boundary

Feature mode is reserved for user-facing functionality. The runner instructs Codex to:

1. select the changed feature by test path, tag, or browser-test project;
2. execute one unchained Playwright invocation with that selector as an argument;
3. write a strict JSON result containing only `status: passed`, the exact selector, the implementation submission's `implementationContextId`, and a positive `testCount`;
4. record exactly one structurally valid, non-zero-duration WebM/MP4 container, up to 25 MB;
5. submit those fields as `featureEvidence`.

It never asks for the full-project E2E suite by default. A broad command, missing selector, missing result, failed result, or zero/multiple videos cannot satisfy the feature profile.

## Figma boundary

The runner does not call a SpecToPR Figma microtool. Codex uses the Figma capability connected to its host, captures real nodes/screenshots/variables/assets/component context, writes project-local evidence, and submits exactly one `figma-bundle` through `workflow_submit`. The bundle declares `provider: host-connected-figma`, ISO `capturedAt`, matching `fileUrl`, non-empty `nodeIds`, `manifestPath`, and one or more real PNG artifacts. The strict manifest repeats the provenance and lists the PNG `visualPaths`. URL-only assertions, malformed images, repeated bundles, and provider polling are rejected.

## Workflow contract

Runner prompts use exactly seven public tools:

`workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, and `workflow_archive`.

The workflow owns eight durable stages: intake, contracts, implementation, functional review, design review, report, publish, and archive.

## Workload and automatic boundary control

The runtime exposes an `XS`–`XL` intake estimate with a token range, confidence, reasons, and 80% checkpoint threshold. A contracts submission can refine it with non-negative numeric `workloadSignals`: requirements, relevant files, API operations, UI surfaces, Figma nodes, test targets, workspace packages, and uncertainty. At least one observed signal other than uncertainty is required; sparse or uncertain evidence remains low-confidence.

SDK automation instructs Codex to stop after one external workflow action group per turn and requires a fresh structured workflow status from every action turn. Usage is available only when a turn completes, so the runner sums `input_tokens + output_tokens` and evaluates the policy at that boundary; cached input and reasoning output are retained as separate dimensions and are not added twice. At the first completed boundary at or above 80%, the runner creates a compact checkpoint from the durable run ID, stage/action status, blockers, workload, authoritative required validations, and `resumeContext` goal/project-relative evidence paths/submission summaries, then starts a fresh thread. It cannot interrupt at the exact token inside a running turn or undo multiple actions already performed by an agent that ignored the boundary instruction. Missing usage on a nonterminal turn returns `usage-unavailable` instead of treating it as zero.

At the hard limit, no following action group starts and every workload size returns `split-required`. Scope splitting creates independently verifiable slices rather than deleting gates. The caller cannot override the automatic hard limit. Calibration changes only the displayed estimate; the enforced limit is always the default maximum for the active workload size. Checkpoint and continuation prompts include the effective used, remaining, checkpoint, and hard-limit counters rather than a stale runtime estimate.

By default, samples are stored at `~/.codex/spec-to-pr/usage-history.jsonl`. Records contain only mode/workload enums, estimated and actual numeric counters, turn/checkpoint counts, completion, and time. They never contain prompts, sources, repository paths, code, diffs, tool payloads, or final responses. Only fresh, non-resumed completed runs with complete usage are recorded; resumed invocations neither read mode-specific calibration nor record their tail counters because they do not represent the whole Run. Legacy samples whose recorded hard limit differs from the workload default are ignored, so an old caller-approved large run cannot affect later estimates or limits. Ten matching automatic-policy samples enable median/p90 display calibration; confidence increases with sample count and stable spread. The store serializes writes, replaces the file atomically, retains at most 256 records from the last year in at most 1 MiB, revalidates location and file type on every access, and refuses symlinks, hard links, devices, pipes, and oversized files. History reads/writes are best-effort and return `usageCalibration.read/write: unavailable` without failing completed workflow work. Use `--usage-history` to relocate this store or `--no-usage-calibration` to disable both reads and writes.

If `outputSchema` is supplied programmatically, workflow action turns remain unconstrained by that final schema. After a terminal workflow status, one formatting-only turn applies the caller schema without performing another workflow action only while complete usage is known below the hard limit. `result.outputFormatting` reports `applied`, `failed`, `budget-skipped`, `usage-unavailable`, `not-terminal`, or `not-requested`, so callers never have to assume the final response matches their schema. A formatting error is best-effort: the runner preserves the terminal workflow response, reports `failed`, marks aggregate usage partial because the failed turn has no usage payload, and skips calibration recording. Once the limit is known to be reached, the runner returns the terminal action response instead of starting a formatting turn.

When `resumeThreadId` or `--resume` is supplied, the first turn recovers the latest durable run ID from task history and calls `workflow_status`. It continues that Run from `resumeContext` and never repeats intake or creates a replacement Run.

`resumeContext` is bounded: goal text is at most 4,000 characters, evidence paths at most 200 and 1,000 characters each (the first 50 and latest 150 when truncated), and only the latest submission per kind is retained with a 500-character summary. Opaque artifact IDs are not copied into workflow status or checkpoint prompts.

Calibration history must remain outside the enclosing Git worktree, even when `workingDirectory` is a nested package. An enabled `usageHistoryPath` inside that root is rejected using canonical existing-ancestor paths, including symlink aliases, and an existing multiply linked history file is rejected so it cannot mutate a repository file through a hard link. Relative paths are resolved from `workingDirectory`.

Implementation remains in one Codex context. For API-backed UI, Codex submits `kind: "api-ready"` with a stable `implementationContextId`, distinct physical non-empty `apiArtifacts.types`, `schemas`, `wrappers`, `mocks`, and a JSON `contractTests` result reporting `status: passed`; path, symlink, and hard-link aliases are rejected. Final implementation repeats the ID. A final `apiReady: true` flag alone cannot satisfy the checkpoint. After implementation, the orchestrator passes an immutable `workflow_status` snapshot, contracts, diff, and evidence paths to independent reviewers. Reviewers return schema-shaped payloads without calling workflow tools. Code scope receives `functional-reviewer`; UI scope additionally receives `design-reviewer`. Brief mode does not imply UI scope by itself.

The SDK pins the first accepted durable Run ID and stops with `run-mismatch` if a later boundary reports another Run. The first structured status becomes authoritative for validation applicability; later statuses may add validations but cannot remove them.

`workflow_publish` is draft-only. Before publication, the runner instructs Codex to use a non-target `codex/*` source branch, commit only intended changes, and require a clean tree with at least one commit beyond the target; runtime preflight enforces the committed delta. It never merges, approves, closes, or marks a review request ready. `workflow_archive` is explicit and requires verified post-merge evidence.

## Programmatic use

```ts
import { runSpecToPrWithCodex } from "@spec-to-pr/codex-sdk";

const result = await runSpecToPrWithCodex({
  workingDirectory: "/path/to/app",
  deliveryMode: "feature",
  changeKind: "feature",
  publication: "draft",
  prompt: "Add the saved-address selector",
});

console.log(result.threadId, result.workload, result.budget, result.usage);
```
