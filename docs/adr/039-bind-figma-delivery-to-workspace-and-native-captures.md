# ADR 039: Bind Figma Delivery to the Intended Workspace and Native Captures

- Status: Proposed
- Date: 2026-07-23

## Context

The first production-style case-4 run exposed a chain of failures that the
synthetic Figma tests do not cover:

1. `workflow_start` persisted the currently checked-out `projectRoot` and HEAD
   even though the requested change had to branch from `release-qa`.
2. Implementation continued in a clean linked worktree, but implementation
   snapshots, review freshness, reports, and publication remained bound to the
   original worktree.
3. A connected-host Figma screenshot was a 202×1024 thumbnail of a logical
   360×1824 frame. The thumbnail dimensions were declared as the browser
   viewport, so Chromium rendered a scaled page and the strict pixel comparator
   measured two different downsampling pipelines.
4. Two supplied Figma state URLs were represented by one singular `figmaUrl`
   plus manually assembled bundle metadata.
5. The Figma contract proved that PNG and JSON files existed, but did not prove
   design-system component mapping, native frame geometry, font and asset
   provenance, or that a declared deterministic fixture was consumed by the
   captured page.
6. The implementation was marked blocked before an official current-packet
   visual comparison. The out-of-band 0.78 score could not become Run evidence.
7. The self-hosted GitLab remote was classified only during publication, after
   implementation work had already completed.

The correct source branch contained a focused 18-file change against
`release-qa`, while the frozen Run base observed a 219-file difference against
the original branch. The implementation was not lost, but the Run had no safe
way to adopt it.

The current tests establish schema consistency with generated one-pixel PNGs.
They do not execute an end-to-end Figma delivery in a nested repository target,
from a non-default target branch, through a real browser capture and
self-hosted GitLab draft publication.

## Decision drivers

1. A Run must review and publish exactly the repository, target paths, base
   branch, source worktree, and commit lineage intended at intake.
2. `workflow_start` remains a single durable call. Invalid workspace or
   publication prerequisites must fail transactionally before a Run is stored.
3. The public facade remains the seven workflow tools from ADR 035. This change
   adds no public Figma, browser, Git, or publisher microtool.
4. Figma comparison must use native logical geometry or an explicitly declared,
   runtime-owned normalization. A host thumbnail can never silently become a
   viewport.
5. The 0.98 `reviewMatchRatio` gate remains. The measurement is made stable
   rather than weakened.
6. A failed valid comparison must lead to implementation repair and a new
   review packet. Invalid acquisition evidence must not consume a repair
   attempt.
7. Natural-language instructions to use an internal design system must become
   reviewable, machine-bound evidence.
8. Existing brief, legacy, and feature modes and previously persisted Run data
   must remain readable.

## Decision

### 1. Resolve and bind the workspace before durable start

The SDK and orchestration skill add a pre-durable preparation step before their
single `workflow_start` call. Its resolution phase is read-only and produces:

```ts
export type WorkspaceStartBinding = {
  repositoryRoot: string;
  targetPaths: string[];
  sourceBranch: string;
  targetBranch: string;
  baseSha: string;
  remoteName: string;
  remoteProvider: "github" | "gitlab";
  remoteHost: string;
};
```

`repositoryRoot` is the canonical Git worktree top-level. `targetPaths` are
unique repository-relative implementation boundaries. A user-supplied nested
path such as `repo/src/pages/shop` is normalized to
`repositoryRoot: repo` and `targetPaths: ["src/pages/shop"]`; it is never stored
as the Git root.

For draft publication, the preparation creates or selects a clean non-target
`codex/*` source worktree from the requested target branch before
`workflow_start`. `baseSha` is the resolved target-branch commit, not the
current source-branch HEAD. The source branch must contain no implementation
delta at start.

`workflow_start` receives the complete binding and validates it atomically:

- the repository and source worktree are canonical and clean;
- source and target branches differ and satisfy the configured branch policy;
- `baseSha` equals the resolved target ref and is an ancestor of source HEAD;
- every target path is repository-relative, non-escaping, and within the
  worktree;
- the remote host and provider are resolved;
- required self-hosted GitLab web/API configuration and host-specific
  credentials are available when publication is requested.

No Run is persisted when validation fails. The returned error contains one
stable code and one exact corrective action. This preserves the requested
“call `workflow_start` once” behavior: agents prepare until the binding is
valid, then create one durable Run.

The Run manifest persists the binding. `workflow_status` exposes the canonical
root, target paths, source branch, target branch, base SHA, current source SHA,
remote provider, and remote host. Implementation snapshotting, freshness,
review, reporting, and publication use this binding instead of independently
querying arbitrary current state.

Implementation changed files are computed as committed
`baseSha..sourceHead` repository-relative paths and are restricted to
`targetPaths` unless an explicitly declared supporting path is accepted during
contracts. Transient packet evidence under `.spec-to-pr` is ingested and
digest-bound separately; it does not make the implementation packet stale.

Backward-compatible `projectRoot` remains accepted at the public schema for one
release. The SDK normalizes it to `repositoryRoot` and `targetPaths`. Direct
callers that omit the new binding receive a deprecation warning and the
runtime-derived binding only when the current worktree unambiguously satisfies
the same invariants.

### 2. Represent every Figma state and its native capture geometry

`workflow_start` accepts `figmaUrls` in addition to the singular compatibility
field. The normalized delivery profile stores a nonempty deduplicated list.
Every URL must resolve to at least one Figma target before contracts can pass.

Each Figma visual target adds immutable capture metadata:

```ts
export type FigmaCaptureGeometry = {
  nodeId: string;
  captureKind: "viewport" | "full-frame";
  logicalSize: { width: number; height: number };
  exportScale: number;
  bitmapSize: { width: number; height: number };
  colorSpace: "srgb";
};
```

The runtime decodes the PNG and verifies `bitmapSize`. A 202×1024 bitmap for a
360×1824 logical frame is accepted only as an explicitly scaled source export;
it cannot declare a 202×1024 browser viewport. Comparison inputs use either:

- a 1× native full-frame baseline and a 1× full-page browser capture; or
- viewport-sized native segments with the same logical viewport and device
  scale factor.

Original artifacts remain immutable. The runtime produces digest-bound
normalized artifacts with one fixed sRGB conversion, alpha background, and
resampler version. Callers cannot resize either side or select an alternative
normalizer. Frame geometry, normalization version, original digests, and
normalized digests are attached to the current review packet.

The production gate remains `reviewMatchRatio >= 0.98`.
`exactMatchRatio` remains diagnostic, matching ADR 038.

### 3. Bind design-system, asset, font, and fixture evidence

The Figma bundle manifest gains a strict design mapping:

```ts
export type FigmaDesignMapping = {
  designSystem: {
    packageName: string;
    packageVersion: string;
    guidanceSkill?: string;
  };
  components: Array<{
    figmaComponent: string;
    nodeId: string;
    resolution:
      | { kind: "component"; module: string; exportName: string }
      | { kind: "asset"; path: string; digest: string }
      | { kind: "exception"; reason: string };
  }>;
  fonts: Array<{ family: string; source: string; digest?: string }>;
  tokens: Array<{ figmaVariable: string; codeToken: string }>;
};
```

Every component reference captured from Figma must have exactly one
resolution. A Figma path such as `Logo/Normal/nxplus_park` is not assumed to be
a CSS class, package export, or filename. It must resolve to a real internal
component, a digest-bound canonical asset such as `nxplus_park.webp`, or a
reviewable exception.

Contracts reject missing package metadata, unresolved component references,
nonexistent exports that can be checked from the installed package, unbound
assets, and unbound required tokens. Implementation evidence lists the source
files and import/export or asset usages that realize each mapping. Functional
review verifies those usages; design review verifies the visual and interaction
result.

Mock evidence changes from an independent file list to named fixtures:

```ts
export type DeterministicFixture = {
  id: string;
  path: string;
  digest: string;
};
```

Every `visualTarget.fixture` resolves to exactly one fixture. The browser
capture receipt repeats the fixture ID and digest observed during the capture.
A valid but unused JSON file cannot satisfy Figma mode.

### 4. Make browser capture provenance runtime-verifiable

The supported capture runner produces a packet-specific receipt containing:

- review packet ID and source HEAD;
- target ID, route, state, logical geometry, DPR, and capture kind;
- Playwright and browser versions;
- locale, color scheme, timezone, and user agent;
- font family and font-file digests;
- fixture ID and digest;
- loaded local asset digests and completion state;
- screenshot path, digest, dimensions, and timestamp;
- capture-runner and normalization versions.

The runner waits for `document.fonts.ready`, the declared fixture, and declared
local assets before capture. Required remote visual assets must be downloaded
and digest-pinned during implementation rather than left as mutable URLs.

The runtime validates the receipt and image geometry before reserving a visual
attempt. Direct reuse of a baseline path or a receipt from another packet,
source HEAD, fixture, target, or runner version is rejected. Identical baseline
and actual bytes remain valid only with a valid current-packet capture receipt,
because a genuinely pixel-perfect implementation may produce identical
artifacts. This follows ADR 038's local-owner threat model and prevents
accidental or stale replay without pretending to provide cryptographic
attestation against the repository owner.

### 5. Repair implementation between visual attempts

Visual evidence has two phases:

1. acquisition validation;
2. fidelity comparison.

Geometry, provenance, font, fixture, color-space, and artifact-integrity
failures stop in acquisition validation and do not allocate an attempt.

A valid comparison reserves one attempt across the implementation lineage. If
it fails:

- implementation is reopened with a typed `implementation-repair` action;
- the failed target metrics and diff/overlay are attached to the action;
- source changes create a new review packet;
- the next valid comparison uses attempt 2 or 3 across the packet lineage.

The runtime rejects another comparison against a stale packet after tracked
source changes. After attempt 3 fails, design review receives the complete
comparison history and can return changes requested; ready publication remains
blocked. A caller cannot replace this sequence with a generic non-retryable
implementation blocker.

### 6. Preflight and pin self-hosted publication

Remote classification moves into workspace preparation and durable start.
Self-hosted GitLab requires an explicit provider plus normalized web/API bases
and hostname-specific authentication. These values are stored as a sanitized
publication binding without credentials.

Publisher preview and execute must use the same provider, host, remote, target
branch, source branch, and base SHA recorded at start. A remote or branch change
after intake produces a typed freshness failure instead of late generic
“unsupported host” output.

### 7. Normalize Figma-mode scope

After delivery mode resolution, Figma mode explicitly sets API coverage and
API-ready requirements to false. Words such as “mock”, “local MCP”, or an asset
URL cannot re-enable API scope. UI, accessibility, interaction, responsive, and
visual gates remain applicable.

## Failure behavior

The runtime adds these stable blocker codes:

| Code                                    | Meaning                                                               | Exact corrective action                                                        |
| --------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `WORKSPACE_ROOT_MISMATCH`               | supplied path is not the bound source worktree                        | prepare the clean source worktree and start with its canonical Git root        |
| `WORKSPACE_TARGET_REF_MISMATCH`         | base SHA is not the requested target ref                              | refresh the target ref and recreate the source branch from it                  |
| `WORKSPACE_BRANCH_MISMATCH`             | source branch or current branch differs from the binding              | check out the bound non-target source branch in the bound worktree             |
| `WORKSPACE_TARGET_PATH_INVALID`         | a target path escapes or is outside the repository                    | provide repository-relative target paths                                       |
| `PUBLISH_REMOTE_UNCONFIGURED`           | a self-hosted remote lacks provider, API/web base, or host auth       | configure the reported host and rerun workspace preparation                    |
| `FIGMA_TARGET_UNRESOLVED`               | a supplied Figma URL has no captured target                           | capture every supplied Figma state before contracts                            |
| `FIGMA_CAPTURE_GEOMETRY_INVALID`        | logical, bitmap, scale, or decoded dimensions disagree                | recapture the native frame or declare the correct export scale                 |
| `FIGMA_DESIGN_MAPPING_INCOMPLETE`       | a captured component, token, font, or asset is unresolved             | map it to the installed design system, a bound asset, or an explicit exception |
| `VISUAL_CAPTURE_PROVENANCE_INVALID`     | receipt and packet, source, fixture, runner, or artifact do not match | recapture through the supported runner for the current packet                  |
| `MOCK_FIXTURE_NOT_CONSUMED`             | a target fixture was not observed during browser capture              | run the target with the bound deterministic fixture and recapture              |
| `VISUAL_IMPLEMENTATION_REPAIR_REQUIRED` | a valid comparison is below 0.98                                      | repair the listed targets and submit a new implementation packet               |

Workspace, publication, acquisition, and mapping codes are retryable without
consuming a visual attempt. `VISUAL_IMPLEMENTATION_REPAIR_REQUIRED` remains
retryable until the three valid fidelity comparisons are exhausted. Public
blocker summaries are generated from runtime facts rather than replaced with a
generic implementation-verification message.

## Runtime and schema boundaries

The change keeps the seven public tools and adds focused internal modules:

- `src/workspace/workspace-binding.ts` resolves, validates, serializes, and
  freshness-checks the Git and publication binding.
- `src/figma/figma-capture-contract.ts` validates URL coverage, native geometry,
  design mappings, and fixture identities.
- `src/visual/capture-receipt.ts` validates packet-specific browser provenance.
- `src/visual/visual-normalizer.ts` owns deterministic color and size
  normalization.
- `src/workflow/visual-repair-lineage.ts` allocates comparison attempts across
  review packets and emits repair actions.

`WorkflowService` orchestrates these modules but does not duplicate their
validation logic. Schemas remain strict and generated runtime schemas and SDK
types are updated together.

Persisted Run schemas add optional compatibility fields and migrate old data on
read. New Figma runs require the complete workspace and capture contracts.
Non-Figma runs use the workspace binding but do not require Figma evidence.

## Verification strategy

Implementation uses red-green-refactor in this order:

1. workspace normalization and binding;
2. multiple Figma targets and native geometry;
3. design-system mappings and fixture linkage;
4. capture receipt and normalization;
5. visual repair lineage;
6. self-hosted GitLab preflight and pinned publication;
7. mode-specific scope normalization;
8. documentation, SDK, generated schemas, and release-bundle parity.

Focused unit and integration tests cover each boundary. One production-style
case-4 regression fixture must cover the complete path:

- a repository whose current default branch differs from `release-qa`;
- a nested requested target normalized to a repository-relative path;
- a clean `codex/*` worktree based on `release-qa`;
- two Figma state URLs for a logical 360×1824 frame;
- a deliberately downscaled host thumbnail rejected as a viewport;
- real Playwright capture using a named deterministic fixture;
- complete internal component/asset mapping including a logo asset fallback;
- one failed comparison, one implementation repair, and a passing new packet;
- self-hosted GitLab preview and draft MR execution through fake host-specific
  web/API endpoints;
- assertions that no sibling change, stale packet, unused fixture, mutable
  remote asset, or baseline replay enters accepted evidence.

The existing one-pixel schema fixtures remain useful for focused parser tests
but cannot be the only Figma integration coverage. `pnpm check` must execute the
new integration test. Browser guide checks remain documentation checks and are
not treated as delivery E2E proof.

The final verification gate includes:

- focused workspace, Figma, visual, mock, and publisher tests;
- full Vitest;
- SDK and root type checks and builds;
- policy and generated-schema parity;
- plugin validation;
- browser-based case-4 regression;
- `git diff --check`;
- independent functional review and UI-applicable design review of changed
  guide surfaces.

## Consequences

- A path correction after durable start is no longer needed because nested
  inputs are resolved before the single start call and the resolved binding is
  visible in status.
- A Run cannot silently compare or publish from another worktree or branch.
- Figma thumbnails remain valid source artifacts but cannot masquerade as
  browser viewports.
- The 98 percent criterion becomes meaningful across a deterministic capture
  pipeline.
- Internal design-system requirements become explicit evidence rather than
  agent interpretation.
- Visual repair attempts represent implementation changes, not repeated
  screenshots of stale code.
- Publication failures caused by an unknown self-hosted host move to intake.
- Case 4 gains a real integration path instead of relying on schema-only
  synthetic fixtures.

## Rejected alternatives

### Add a public `workflow_preflight` or Figma capture tool

This would violate the stable seven-tool facade and reintroduce mode-specific
microtools. Read-only SDK preparation plus transactional `workflow_start`
provides the same safety without increasing the public surface.

### Allow worktree rebinding at any time

Late rebinding can disconnect accepted evidence from reviewed code. New runs
bind correctly before start. A future one-time recovery action may be designed
separately for pre-implementation Runs, but is not part of this change.

### Infer target branch from the current checkout

This caused the incident. Target branch and base SHA are explicit and verified.

### Lower the visual threshold or mask raster-heavy regions

The observed 0.78 score came from an invalid thumbnail/viewport contract plus
renderer differences. Lowering the gate would hide capture defects and weaken
unrelated cases.

### Reject every equal baseline and actual digest

A legitimate pixel-perfect implementation can be byte-identical. Packet-bound
capture receipts, role separation, and source/fixture freshness address stale
replay without rejecting correct output.

### Treat Figma component names as package exports or filenames

Figma component paths are design identities. Explicit component, asset, or
exception mapping is required because target design-system APIs differ by
platform and version.
