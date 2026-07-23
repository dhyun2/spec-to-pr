---
sidebar_position: 9
title: Troubleshooting
---

# Troubleshooting

When something goes wrong, start with `/spec-to-pr:doctor`. `workflow_info` should report contract version `2.0.0`, seven tools, eight stages, and two reviewers. The current marketplace exposes eight public skills.

## Inputs and sources

- Brief does not start: provide all three required sources—a readable project-relative regular file in `briefPath`, a `figmaUrl`, and either project-relative `openApiPaths` or credential-free HTTPS `openApiUrls`. For URL sources, provenance records the URL, fetch time, and content hash.
- Feature does not start: `feature` requires the same three sources as `brief`. It also requires targeted E2E for the changed feature and exactly one video.
- Legacy scope expands: first confirm that `legacyProjectRoot` is pinned to the intended separate legacy directory. Migrating the whole root needs no invented feature name; “migrate the selected scope” is enough. Add in-root routes or screens only when migrating a subset. The runtime inventories that root read-only and never expands scope through a repository-wide keyword search.
- `LEGACY_API_METHOD_UNKNOWN`: do not guess the method/path. Follow `collect-legacy-network-evidence`, save a project-local standard HAR/request JSON captured from that flow, and submit `kind: legacy-network-evidence` with `evidencePath`. The input is bounded to 1 MB and 1,000 requests and resumes intake in the same Run.
- Figma-only starts unexpected API or E2E work: Figma mode uses deterministic mocks and visual comparison. Real API integration, performance evidence, feature E2E, and video are not enabled by default.
- Figma contracts block: restore the host-connected Figma permission and submit exactly one strict bundle with `provider: host-connected-figma`, ISO `capturedAt`, matching `fileUrl`, non-empty `nodeIds`, JSON `manifestPath`, and real PNG `visualPaths`.
- Explicit guidance is missing: every `guidancePaths` item must be a project-local regular file. Missing auto-discovery candidates are ignored.
- Optional skill is absent: missing optional skills do not block the Run. Leave them out of `appliedSkills` and continue to follow project guidance and required validation.

## Feature browser evidence

Use one unchained Playwright Test/CLI command that selects the changed feature by path, tag, or project. Reject broad/full-project commands, list/pass-with-no-tests options, skipped/zero tests, or invalid structured JSON. Feature requires exactly one non-empty valid WebM/MP4 no larger than 25 MB; other profiles do not inherit that video requirement. Brief and legacy instead report applicable lab Web Vitals and explicitly mark field data available or unavailable.

Playwright assertions and structured results decide whether browser requirements pass. Browser MCP or a host browser is optional for reproducing and inspecting interactions. Chrome DevTools MCP is used only when console, network, performance, memory, or live-DOM diagnosis is needed. Screenshots, video, DevTools traces, and agent observations do not replace assertions.

If required browser proof cannot run, record `BROWSER_NOT_RUN`. Restore the test path/tag/project selector, server command, dependencies/browser, and execution permission, then resubmit Playwright proof in the same Run.

## Understanding a blocker

`blockerDetails.kind` must be one of the seven runtime enums below. Also check the stage, code, retryable and resumable flags, completed work, redacted evidence, attempted recovery, checks that did not run, and the exact recovery action. Never store raw prompts, secrets or tokens, transcripts, or unrestricted private absolute paths.

| `kind`                 | Typical cause                                          | Remediation                                                      |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `missing-input`        | Missing required brief, path, or source                | Supply the exact required input                                  |
| `missing-tool`         | Missing Figma/browser/auth capability or required tool | Supply the required tool, connection, or permission              |
| `policy`               | Source conflict or prohibited broad E2E/branch action  | Choose the authoritative source or allowed scope                 |
| `verification`         | Test/reviewer/evidence failure or `BROWSER_NOT_RUN`    | Fix the cause and rerun the same required validation             |
| `publish-precondition` | Dirty/target branch, auth, remote, or commit problem   | Satisfy preflight externally and resume                          |
| `budget-split`         | `split-required`                                       | Split into independently verifiable scope without removing gates |
| `unexpected`           | Unclassified deterministic/runtime failure             | Diagnose root cause from redacted evidence and reproduction      |

Retryable does not make required evidence optional. Resumable means continuing from the latest `workflow_status.resumeContext`, not starting a new Run.

## API/UI and review

API-backed UI needs distinct non-empty type/schema/wrapper/mock files, a passing contract-test JSON, and one stable `implementationContextId` submitted as API-ready before final UI. Path aliases or `apiReady: true` alone fail. Functional review applies to code; design review applies only to UI. Both reviewers are read-only and workflow-MCP-free.

An empty/skipped/not-run required gate blocks. Execute the repository command and submit project-local evidence, or classify it not applicable only with scope evidence.

## Budget and resume

At the first completed boundary at or above 80%, the SDK checkpoints and resumes in a compact fresh thread. At the hard limit, `split-required` stops the next action without shrinking `requiredValidations`. Missing usage is `usage-unavailable`, not zero. Resume the same Run; do not replay passed stages.

## Draft and diagnostic publication

Normal publication uses `workflow_publish intent: ready` and creates/updates a draft only. Verify publication is requested, the tree is clean, source is not target, authentication and remote are supported, intended changes are committed, source is at least one commit ahead, and required assets are synced.

### A GitLab image upload fails

When `fallbackMode: gitlab-raw-evidence` appears, the PR's legacy/current comparison uses raw PNG URLs pinned to the exact review commit instead of a project upload. This is available only for 401/403/408/429, 5xx, or transient network errors, and only when each image is a tracked regular file whose exact reviewed-commit blob and clean-worktree file both match the captured SHA-256.

Diffs/overlays, video, missing or modified PNGs, and digest mismatches are not fallback candidates. Repair the token/file state or make a clean commit, then retry publication in the same Run. Never attach cookies, HARs, or secrets to the artifact or PR to work around the error.

`workflow_publish intent: blocked-diagnostic` does not bypass these preconditions. A valid preflight may publish blocker evidence, but the draft remains `status: blocked` and is not a passed report/publish verdict. Missing delta is `PUBLISH_NO_DELTA`; never create an empty commit or issue fallback. A publish action cannot repair its own branch/auth/commit precondition, so return a **local blocked report** and exact unblock action instead of looping.

### `diagnostic-publication-uncertain` is returned

The durable publication claim expired or lost its heartbeat. The GitHub/GitLab mutation may have succeeded while only result persistence failed, so an automatic retry could create a duplicate draft.

1. Stop publication. `recoverUncertain: false` is the default, and the SDK never auto-approves recovery.
2. Inspect GitHub/GitLab for an existing matching draft with the same source/target and check its `[Blocked]` title, body, and label.
3. Show the inspection result to the user and obtain explicit recovery approval.
4. Only then call the same Run's existing `workflow_publish` action with `recoverUncertain: true`.

This optional recovery adds no tool or stage. It is diagnostic evidence, so blocked stages and `status: blocked` remain blocked, and no required validation is removed.

After recovery, resume the **same Run** and update the existing draft PR for the same source and target with `workflow_publish intent: ready`. Remove `[Blocked]` and the blocked label, then replace the body, report, and assets with the normal ready result. Do not create a duplicate PR. Ready, approval, and merge decisions remain with people.

Archive runs only after authoritative merge evidence and a separate user action; the runtime does not poll merge state.
