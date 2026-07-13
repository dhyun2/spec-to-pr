# SpecToPR Codex SDK Runner

This package starts a Codex task with the installed SpecToPR plugin and collects the final response, task ID, and token usage. It is intended for CI and internal automation; interactive plugin users do not need it.

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

| Option                 | Meaning                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `--cwd <path>`         | target repository; required                                            |
| `--prompt <text>`      | requested change or extra constraints                                  |
| `--mode <mode>`        | `auto`, `brief`, `legacy`, `feature`, or `figma`                       |
| `--change-kind <kind>` | `auto`, `feature`, `fix`, `refactor`, `migration`, `design`, or `docs` |
| `--brief <path>`       | brief/spec source                                                      |
| `--docs <path>`        | supporting documentation source                                        |
| `--figma <url>`        | Figma file or node URL                                                 |
| `--openapi <path>`     | OpenAPI source                                                         |
| `--publish`            | create or update a draft PR/MR when ready                              |
| `--no-publish`         | stop after evidence-backed implementation and review                   |
| `--resume <task-id>`   | resume an existing Codex task                                          |
| `--model <model>`      | optional model override                                                |
| `--no-review-agents`   | omit independent reviewer instructions                                 |

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

Implementation remains in one Codex context. For API-backed UI, Codex submits `kind: "api-ready"` with a stable `implementationContextId`, distinct physical non-empty `apiArtifacts.types`, `schemas`, `wrappers`, `mocks`, and a JSON `contractTests` result reporting `status: passed`; path, symlink, and hard-link aliases are rejected. Final implementation repeats the ID. A final `apiReady: true` flag alone cannot satisfy the checkpoint. After implementation, the orchestrator passes an immutable `workflow_status` snapshot, contracts, diff, and evidence paths to independent reviewers. Reviewers return schema-shaped payloads without calling workflow tools. Code scope receives `functional-reviewer`; UI scope additionally receives `design-reviewer`.

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

console.log(result.threadId, result.finalResponse, result.usage);
```
