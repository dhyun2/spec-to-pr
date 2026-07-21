# SpecToPR

An evidence-driven Claude Code and Codex plugin for four explicit deliveries: full brief/Figma/API implementation, cross-project legacy migration, feature delivery with targeted E2E/video, and mock-backed Figma implementation. Every case ends in a draft PR/MR by default.

Korean version: [README.ko.md](README.ko.md)

> **Development status:** this branch contains **Unreleased** changes on top of package `0.2.1`. See the changelog before publishing a new version.

## Four delivery modes

| Mode      | Give SpecToPR                              | What it verifies                                                                   | Result                                 |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------- |
| `brief`   | brief/PDF/MD + Figma + OpenAPI             | API/UI, Figma ratios, API gaps, Web Vitals                                         | 15-section evidence-backed draft PR/MR |
| `legacy`  | target repo + separate `legacyProjectRoot` | inventory/coverage, running legacy comparison, performance, derived API usage/gaps | 15-section migration draft PR/MR       |
| `feature` | the same full inputs for one feature       | full evidence + targeted E2E and exactly one `.webm`/`.mp4`                        | video-linked draft PR/MR               |
| `figma`   | Figma URL and target repository            | deterministic mocks and measured Figma comparison                                  | design draft PR/MR                     |

`auto` remains available for lightweight requests that do not need a mode-specific evidence policy.

`brief` and `feature` require `briefPath`, `figmaUrl`, and at least one repeated local `openApiPaths` or HTTPS `openApiUrls` source. `legacy` requires a separate read-only `legacyProjectRoot` and may add a project-local `legacyNetworkEvidencePath` when source discovery cannot determine a request method/path; `figma` needs only Figma and uses mock data. `docsPaths`, `guidancePaths`, and optional `skillHints` compose independently. Project guidance is traceable but excluded from scope classification.

Feature mode accepts one unchained Playwright invocation that selects the changed feature by test path, tag, or project; listing and pass-with-no-tests options plus broad/full-project commands are rejected. Its strict JSON result contains only `status: passed`, the exact `selector`, the submission's `implementationContextId`, and a positive `testCount`. Its one video must be a structurally valid WebM/MP4 container with non-zero duration and be no larger than 25 MB. Other modes do not record feature video unless their delivery profile explicitly requires it.

Any delivery profile with a supplied `figmaUrl` uses the Figma capability already connected to the host. It submits exactly one `figma-bundle` with `provider: host-connected-figma`, ISO `capturedAt`, matching `fileUrl`, non-empty `nodeIds`, a declared `manifestPath`, and one or more actual PNG files. The strict manifest repeats that provenance and lists the PNG `visualPaths`. SpecToPR does not expose Figma microtools or poll Figma.

Intake pins timestamped raw-digest `sourceProvenance`. Brief/feature pin the supplied OpenAPI operation inventory; legacy derives bounded API candidates through explicitly reported fetch, dynamic-fetch, HTTP-client, request-config, and generated-client source adapters and treats optional OpenAPI as enrichment. A project-local `legacyNetworkEvidencePath` accepts at most 1 MB and 1,000 requests in standard HAR JSON, `{requests:[{method,url}]}`, or `[{method,url}]` form; its digest and `runtime-network-har` adapter are bound into the inventory. A zero-operation legacy inventory is still a complete API section bound to its adapter list and inventory digest, not `not-applicable`. Ambiguous methods/paths resolve only from a unique scoped OpenAPI/runtime match; otherwise intake remains blocked, exposes no downstream action, and rejects downstream submissions instead of guessing or losing the Run. Figma and running-legacy baselines share `visualTargets`; every `compare-visuals` capture repeats target route/state/viewport/device-scale/fixture and records provider, ISO capture time, actual PNG path, and `sha256:` digest. Runtime rejects target drift or digest mismatch, computes alpha-aware exact/review ratios, diff, and overlay at a minimum 98% threshold, permits at most 20% justified masking, and allows three total comparison attempts (the initial comparison plus at most two repairs). Final implementation records exact operation-aware `apiCoverage`, current-packet legacy coverage, and required performance evidence. Canonical `pr-report-v2.1` JSON and Markdown share 15 sections and explicit `complete`, `not-run`, `blocked`, or `not-applicable` status. Historical v2.1 reports remain parseable, while new publication requires current adapter/digest evidence. A blocked report omits stale packet/review/visual claims.

Runtime network evidence is parsed locally before a durable Run is created. Raw HAR headers, cookies, bodies, and query strings are not copied into intake artifacts or PR reports; only the project-relative locator, raw digest, normalized method/path, and adapter are retained. Source-derived literal API URLs also drop credentials, query, and fragment before inventory persistence. Keep the file in a gitignored project-local evidence directory so publication can remain clean.

## Lightweight v2 surface

The public runtime is intentionally small:

- **7 MCP tools:** `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`
- **8 durable stages:** intake, contracts, implementation, functional review, design review, report, publish, archive
- **8 skills:** `spec-to-pr`, `doctor`, `intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, `archive-openspec`
- **2 independent reviewers:** `functional-reviewer` and conditional `design-reviewer`

API and UI implementation stay in one context. For API-backed UI, the agent first submits distinct physical, non-empty types, schemas, wrappers, mocks, and a passing JSON contract-test result with a stable `implementationContextId` as an explicit `api-ready` checkpoint; path, symlink, or hard-link aliases do not count as separate evidence. Final implementation must repeat that ID. `apiReady: true` alone is not evidence. There are no separate API/UI implementation agents and no integration lane. After implementation, the orchestrator freezes a `workflow_status` snapshot, contracts, diff, and evidence paths for each independent reviewer; reviewers return verdict payloads without calling workflow tools.

Immediately after intake, `workflow_status` reports an `XS`–`XL` workload, estimated token range, confidence, reasons, an 80% checkpoint threshold, and the authoritative required-validation list. Contract authors may submit non-empty numeric `workloadSignals` to refine it without adding a tool or stage. The same status carries a compact `resumeContext` with the recorded goal, project-relative evidence paths, and submission summaries. The SDK pins the first durable Run ID, instructs each turn to stop after one workflow action group, requires a fresh status at every completed boundary, never lets later statuses shrink required validation, sums actual input plus output tokens, and starts a compact fresh thread at the first boundary at or above 80%. At the hard limit it keeps every required validation and returns `split-required`; there is no caller-selected token allowance. Numeric-only fresh completed-run history may calibrate only the displayed range. The automatic hard limit stays at the workload class default, and legacy samples recorded with a different hard limit are excluded from calibration. Missing usage stops continuation as `usage-unavailable`. History writes are serialized and atomic, storage is bounded and revalidated on every access, prompts/code/diffs/paths/tool output/final responses are never stored, and optional history I/O cannot fail the workflow.

Publishing only creates or updates a draft GitHub PR or GitLab MR. Draft flows work on a non-target `codex/*` source branch and commit only intended changes before publication; runtime preflight requires a clean tree and at least one source commit beyond the target. GitHub media uses the single managed `spec-to-pr/evidence` branch, immutable run/packet/target/artifact paths, and upload-commit-SHA URLs; it never creates one evidence branch per Run or writes media to the source branch. Publishing never merges, approves, closes, or marks a review request ready.

Ready publication uses `workflow_publish intent: ready`. If a required input, tool, policy, verification, publish precondition, budget split, or unexpected failure blocks the Run, typed redacted `blockerDetails` records completed work, attempted recovery, unrun validations, and the exact unblock action. A valid preflight can publish `intent: blocked-diagnostic`, but that diagnostic draft remains `status: blocked`; otherwise, including `PUBLISH_NO_DELTA`, the Run returns a **local blocked report** without an empty commit or issue fallback. Missing required browser proof is `BROWSER_NOT_RUN`. Recovery resumes the same durable Run and updates the same source/target **same draft PR** from blocked to ready.

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
mode: brief
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiUrls: [https://api.example.com/openapi.yaml]
Implement API and UI, compare the result with Figma, report API gaps and Web Vitals,
and publish the canonical draft PR.
```

Legacy migration:

```text
/spec-to-pr /path/to/new-app
mode: legacy
legacyProjectRoot: /path/to/legacy-app
legacyNetworkEvidencePath: evidence/legacy-checkout.har # optional when source method/path is ambiguous
Migrate invoice retry into the target architecture. Run both apps and compare the target
against the running legacy screen before publishing the draft PR.
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
Use deterministic mocks, require the measured 98% comparison, and publish a draft PR.
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

The maintained guide is at **https://dhyun2.github.io/spec-to-pr/**. Start with the outcome-first quickstart, choose one of four deliveries, then follow the interactive Run pipeline into agent ownership and the real pixel-verification model. Reference, troubleshooting, and an official-source comparison of Spec Kit, OpenSpec, Kiro, and BMAD remain separate.

[Choose a delivery](https://dhyun2.github.io/spec-to-pr/en/usage/) or open the [brief-to-PR guide](https://dhyun2.github.io/spec-to-pr/en/usage/brief) for required inputs, copyable prompts, execution phases, blockers, evidence, and an illustrative draft PR.

[Follow the Run](https://dhyun2.github.io/spec-to-pr/en/concepts/pipeline), then inspect [agent review ownership](https://dhyun2.github.io/spec-to-pr/en/concepts/reviews) and [visual verification](https://dhyun2.github.io/spec-to-pr/en/concepts/visual-verification) for the exact `pngjs` RGBA comparison, thresholds, masks, diff, overlay, and provenance gates.

[Read the comparison and adoption policy](https://dhyun2.github.io/spec-to-pr/en/concepts/comparison) for adopted, conditional, and rejected orchestration patterns.

Run it locally with:

```bash
pnpm --dir website install
pnpm --dir website start
```

The current architectural decisions are [ADR 035](docs/adr/035-use-coarse-workflow-facade-and-split-reviews.md), [ADR 036](docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md), [ADR 037](docs/adr/037-use-boundary-budgeting-and-numeric-calibration.md), and [ADR 038](docs/adr/038-harden-evidence-trust-and-unify-delivery-policy.md).
