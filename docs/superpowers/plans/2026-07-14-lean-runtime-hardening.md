# Lean Runtime Hardening Implementation Plan

> Execute with test-first changes and independent review of each lane before integration.

**Goal:** remove manual token budgeting and obsolete runtime weight while closing the workflow, SDK, publishing, and release-integrity gaps found in the audit.

**Architecture:** retain the coarse workflow facade and four delivery profiles. Make runtime status the authoritative contract, bind reviews and publishing to immutable implementation evidence, keep workload control automatic, and make release verification operate on the actual archive. Remove legacy modules only after a reachability test proves they are outside current production entrypoints.

**Stack:** TypeScript, Zod, Vitest, Codex SDK, MCP SDK, pnpm, tsup, git.

---

## Task 1: Workflow safety and evidence contracts

**Files:** `src/workflow/workflow-contracts.ts`, `src/application/workflow-service.ts`, `src/state/stage-machine.ts`, `src/application/publisher-service.ts`, related workflow/publisher tests.

1. Add failing tests for review-packet identity, stale review rejection, repair invalidation/reopen, requirement IDs, legacy baselines, PR report evidence, and source-branch/HEAD mismatch.
2. Run the focused tests and confirm the expected failures.
3. Implement the smallest contract and state transitions that satisfy them.
4. Run focused tests, then workflow/publisher integration tests.

## Task 2: SDK workload and boundary runtime

**Files:** `packages/codex-sdk/src/*.ts`, `src/workflow/workload-policy.ts`, SDK/workload tests, SDK README, root README, ADR 037.

1. Add failing tests proving the public manual-budget API is absent, every hard-limit action is `split-required`, run IDs are pinned, validation sets cannot shrink, empty signals are rejected, non-UI briefs stay non-UI, and effective budget data appears in checkpoints.
2. Add failing calibration tests proving displayed ranges may adapt while automatic hard limits never fall below defaults.
3. Add failing usage-history tests for Git-root containment, oversized/non-regular/link targets, bounded reads, and bounded retention.
4. Implement the minimal runtime changes and rebuild SDK output from a clean directory.
5. Run focused SDK/workload tests and complete-file-set generation checks.

## Task 3: Release integrity

**Files:** `src/release/*`, `src/application/release-service.ts`, `scripts/build-release.ts`, `scripts/publish-release.ts`, release tests.

1. Add failing tests for non-zero failed verification, archive tampering, checksum/entry/commit mismatch, untracked packaging input, exact plugin inventory, profile parity, stale generated outputs, version mismatch, and unsafe publish ordering.
2. Replace constant-pass eval/security output with concrete checks or remove it from the release contract when redundant.
3. Build from tracked clean-tree inventory and verify the real extracted archive.
4. Add preflight version/tag/inventory checks before any remote mutation.
5. Run focused release tests and a dry-run archive verification.

## Task 4: Intake and contract lightening

**Files:** `src/application/workflow-service.ts`, contract schemas, workload policy, related tests.

1. Add failing tests showing intake does not execute the full profiler and that contracts require meaningful structured evidence.
2. Replace profiling with the minimal workspace package count needed by workload estimation.
3. Reject empty workload signals and compute confidence from observed signal coverage and uncertainty.
4. Run intake, workflow contract, and workload tests.

## Task 5: Reachability-based deletion and documentation sync

**Files:** production entrypoints, `src/application/index.ts`, unreachable modules/tests, plugin skills/agents, README/ADRs, MCP descriptions.

1. Add a failing inventory test that defines the supported production entrypoints and rejects unreachable shipped source.
2. Compute the dependency closure and review the deletion list against persisted/public compatibility needs.
3. Remove confirmed dead modules, their direct-only tests, obsolete exports, constant-pass release abstractions, and stale descriptions.
4. Synchronize all public docs and generated artifacts with the remaining runtime.
5. Run the inventory, documentation, layout, and schema tests.

## Task 6: Integration and verification

1. Review each lane for requirement coverage and code quality.
2. Resolve cross-lane contract conflicts without weakening tests.
3. Run `pnpm format:check`, `pnpm typecheck`, clean SDK build comparison, clean schema build comparison, `pnpm build`, and `pnpm test`.
4. Run plugin validation when installed CLIs are available.
5. Build and verify a release archive, then verify that tampering causes failure.
6. Record the final deletion/behavior summary and any intentionally deferred compatibility work.
