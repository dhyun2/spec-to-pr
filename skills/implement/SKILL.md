---
name: implement
description: Use when a v2 workflow requests implementation of code, API-backed UI, tests, mocks, or repository changes from accepted contracts.
---

# Implement

Use one implementation context for API and UI; do not split them into separate agents or worktrees.

1. Read `workflow_status` and confirm the `implement` action from `workflow_advance`.
2. When the action says `requireApiReady: true`, implement and verify API types, schemas, generated clients or wrappers, mocks, and contract tests from documented evidence. Write each result as a real project-local artifact before starting UI work.
3. Submit `kind: api-ready`, `status: passed`, a stable `implementationContextId`, a summary, all paths in `artifactPaths`, and `apiArtifacts` with nonempty `types`, `schemas`, `wrappers`, `mocks`, and `contractTests` path arrays. Categories must use distinct physical non-empty files; path, symlink, or hard-link aliases are rejected. `contractTests` points to a JSON result with `status: passed`. Every categorized path must also appear in `artifactPaths`. Wait until `workflow_status` exposes the `api-ready` checkpoint before UI evidence submission, then continue UI work in the same context and repeat the same `implementationContextId` on final implementation.
4. Implement UI against those wrappers and mocks, then run applicable checks.
5. For a user-facing `feature` profile, use a stable `implementationContextId` and run one unchained Playwright invocation selected by a specific test file, `@tag`, or `--project` value. Never use `--list`, `--pass-with-no-tests`, or an unfiltered full-project E2E command. Write a strict project-local JSON `resultPath` containing only `status: passed`, `selector` exactly equal to `testSelector`, the same `implementationContextId`, and a positive `testCount`. Record exactly one structurally valid WebM or MP4 container with non-zero duration, up to 25 MB, and include `featureEvidence` with `scope: targeted-feature`, `testSelector`, `testCommand`, `resultPath`, and `videoPath`.
6. Call `workflow_submit` once with an `implementation` result: status, summary, `apiReady`, conditional `implementationContextId`, `uiChanged`, changed files, artifact paths, and conditional feature evidence.

An API-backed passed UI result requires the earlier `api-ready` submission and final `apiReady: true`; the boolean alone is not evidence. Brief, legacy, Figma, fix, refactor, migration, docs, and `auto` runs do not record feature video unless their delivery profile explicitly requires it. Missing, empty, skipped, or failed contract evidence blocks submission. Do not invent endpoints or report checks that did not run.

Keep implementation as one SDK action boundary. If the runner reaches 80% after this boundary, rely on the durable Run, contract artifacts, changed files, and test evidence in its compact checkpoint rather than replaying the full conversation. If the automatic hard limit is reached, stop before review or publication and return `split-required`; split the work into independently verifiable slices without trading away tests, review, or required gates.
