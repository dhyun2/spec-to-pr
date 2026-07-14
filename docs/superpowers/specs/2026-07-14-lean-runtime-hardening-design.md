# Lean Runtime Hardening Design

## Status

Approved by the user's 2026-07-14 direction: remove manual token budgets and implement the remaining audit improvements.

## Goal

Keep the four public delivery profiles while making the agent runtime smaller, faster, and safer:

1. brief/spec to draft PR,
2. legacy project change to draft PR,
3. feature development to draft PR with feature-scoped E2E evidence and video only when the change is a user-facing feature,
4. Figma URL to design implementation.

The runtime must preserve required functional and design validation, but it must not carry obsolete agent lanes, fake release gates, or user-managed numeric token budgets.

## Decisions

### 1. Automatic workload control, not a user budget product

- Remove `tokenBudget`, `--token-budget`, `budgetLocked`, and `approval-required` from the public SDK and CLI.
- Keep XS-XL workload estimation, an estimated token range, confidence, an 80% boundary checkpoint, numeric-only calibration, and actual usage recording.
- Treat the runtime's hard limit as an automatic safety boundary. Reaching it always returns `split-required`; no validation can be waived.
- Calibration may narrow the displayed estimate, but it cannot reduce an automatic hard limit below the default workload maximum. This prevents low-cost completed samples from making larger runs fail prematurely.
- Reject empty workload signals. Confidence rises only when meaningful observed fields exist and falls when uncertainty is declared.
- Expose the effective hard limit, used tokens, remaining tokens, and checkpoint threshold in checkpoint/resume prompts.

### 2. One authoritative run and validation contract

- Pin the first accepted workflow `runId`; stop on any later mismatch.
- After the first authoritative runtime status, required validations are monotonic. A later status may add requirements but cannot silently remove them.
- Non-UI briefs do not activate design review or visual validation. Runtime scope remains authoritative.
- Intake computes only the lightweight workspace signal it consumes; it does not run the full project profiler for an unused profile.

### 3. Immutable implementation review packets

- An implementation submission creates a review packet identity from run ID, implementation revision, base/head SHA, and changed/evidence paths.
- Functional review, design review when required, and the PR report must reference the current packet identity.
- A `changes-requested` review reopens implementation and invalidates every review/report derived from the old packet. Resubmission creates a new packet.
- Contract submission requires a normalized requirement manifest. Legacy mode additionally records focused baseline commands/results. Review findings and PR traceability reference requirement IDs.

### 4. Evidence-driven publishing

- Publishing verifies that the checked-out HEAD is the declared source branch/commit, not merely that arbitrary refs are ahead.
- The PR report contains requirement traceability, changed and evidence paths, quality/review results, risks, and feature-scoped visual/video evidence when applicable.
- Feature-scoped E2E/video remains conditional: it is required for user-facing feature work, not for every repository or every historical feature.

### 5. Real release verification

- Remove constant-pass eval/security gates. Release checks must execute real project checks or concrete file/security assertions.
- A failed verification exits non-zero.
- Build packages from a clean, tracked commit inventory.
- Verify the produced ZIP bytes, checksum, exact entries, extracted runtime smoke test, and manifest commit/version binding.
- Generate SDK and schema outputs into clean locations and compare the complete file set so stale or untracked outputs are detected.
- Validate exact agent/skill/runtime inventory and parity between Markdown and Codex reviewer profiles.
- Validate semver, all version declarations, tag availability, and mutation order before push/tag operations.

### 6. Safe, bounded usage history

- Resolve repository containment from the Git worktree root, not only the caller's working subdirectory.
- Revalidate the history target at read and append boundaries; accept only bounded regular files with safe link properties.
- Bound retained records and bytes, reading only the recent useful sample window.
- Optional history failures remain non-fatal and never reverse completed workflow work.

### 7. Delete by reachability, not by age

- Add a production-entrypoint reachability/inventory test first.
- Delete only modules, tests, exports, skills, and documentation proven unreachable from the current MCP, SDK, release, schema, and plugin entrypoints.
- Keep compatibility only where a current public contract or persisted run requires it. Do not preserve obsolete agent lanes merely because tests import them.
- Remove stale MCP wording and synchronize README, ADRs, SDK docs, skill descriptions, generated schemas, and release inventories.

## Verification

Each behavior change starts with a failing test. The final integration must pass formatting, type checking, clean SDK/schema generation comparison, build, unit/integration tests, plugin validation where the local CLIs are available, and a release build/verification smoke test against the produced archive.
