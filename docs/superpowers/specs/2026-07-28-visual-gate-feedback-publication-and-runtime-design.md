# Visual Gate, Feedback Publication, and Runtime Design

- Status: approved in conversation; pending written-spec review
- Date: 2026-07-28
- Target: `@spec-to-pr/plugin`
- Related decision: `docs/adr/040-use-a-92-percent-visual-gate-and-terminal-feedback-drafts.md`

## Summary

The plugin will use one runtime-owned visual review threshold of exactly `0.92`.
An initial comparison and up to two automatic implementation repairs remain available,
for three valid comparisons total. Acquisition failures do not consume an attempt.

If any valid comparison reaches `0.92`, the Run proceeds through the normal independent
reviews, canonical report, and draft publication flow. If the third valid comparison is
still below `0.92`, the Run becomes blocked immediately without asking a design reviewer
to reinterpret the failed score. The plugin then creates or updates the requested draft
PR/MR with the same canonical report structure used for a successful delivery, while
truthfully showing the failed metric, threshold, blocker, baseline, current capture,
diff, and overlay.

The automatic repair loop must be made more informative immediately and cheaper in measured
follow-ups. Every valid attempt continues to cover every declared target so packet-bound
evidence cannot become stale, while invalid Figma or browser acquisition consumes no attempt.

## Goals

1. Make `92%` the authoritative, fixed visual gate for new comparisons.
2. Preserve automatic progress through three valid comparisons so a normal Run does not
   pause for user feedback between attempts.
3. Publish a truthful, reviewable draft after terminal visual failure while leaving the
   Run blocked.
4. Use the same `pr-report-v2.1` section structure for ready and blocked publication.
5. Make Figma, browser, fixture, design-system, and image evidence strong enough to catch
   the failure modes observed during the MobyDick shop implementation.
6. Reduce repeated work without weakening evidence, validation, or publication safety.
7. Keep historical reports readable and keep packetless blockers publishable without
   inventing visual evidence.

## Non-goals

- The plugin will not treat a score below `0.92` as passed.
- The plugin will not merge, approve, close, or mark a draft ready.
- The plugin will not allow callers to lower or raise the threshold per target.
- The plugin will not count capture acquisition failures as implementation failures.
- The plugin will not promise that an external host mutation succeeds when credentials,
  a committed delta, a clean branch, the remote, or the host itself is unavailable.
- This change will not combine every deep runtime optimization into one risky patch.
  Larger optimizations are sequenced after instrumentation.

## Approaches Considered

### 1. Replace `0.98` with `0.92` only

This is the smallest edit, but it leaves material defects:

- persisted or caller-provided target thresholds can still override the policy;
- the third failed comparison still needs a design-review failure to make the Run blocked;
- blocked visual publication can select stale media;
- GitHub blocked visual publication lacks the packet/head binding required for assets;
- the three-column preview makes long baseline and current images hard to compare;
- capture, overlay, icon-token, fixture, and authentication failures remain unaddressed.

This approach is rejected.

### 2. Add a new public `feedback` publish intent

A new intent would distinguish feedback drafts from other blockers, but it expands the
public workflow schema, SDK prompts, compatibility surface, and publisher state machine.
The existing `blocked-diagnostic` intent already means "publish evidence without passing
the Run."

This approach is rejected for now.

### 3. Keep automatic repairs and make terminal failure a packet-bound blocked diagnostic

This approach reuses the current comparison lineage and publication intent:

- attempts one and two can reopen implementation automatically;
- attempt three becomes a durable verification blocker;
- the blocked report is bound to the exact failed packet and visual report;
- the existing draft for the same source and target is created or updated;
- successful and failed reports keep one template and differ only in truthful status.

This approach is selected.

## Visual Policy

### Single source of truth

`src/workflow/delivery-mode-policy.ts` remains the authoritative source:

```ts
export const VISUAL_POLICY = {
  reviewThreshold: 0.92,
  maxMaskedAreaRatio: 0.2,
  maxComparisonAttempts: 3,
} as const;
```

The generated SDK policy must continue to be derived with `pnpm policy:sync`.
Runtime prompts must interpolate or import the generated value instead of embedding
independent `98%` strings. Current README, website, agent, and skill documentation must
say `92%`. Historical ADR text and historical visual reports retain their original facts;
ADR 040 supersedes the active threshold and retry/publication decisions in ADR 038/039.

### No per-target override

New comparisons always use `VISUAL_POLICY.reviewThreshold`. A target manifest may retain
a compatibility field while old Runs are read, but it cannot change the verdict.

- New canonical manifests record `0.92`.
- Stored legacy manifests with `0.98..1.0` normalize to the current runtime policy when a
  new comparison is executed.
- Historical visual reports keep their recorded threshold and remain readable evidence.
- Caller-supplied scores and verdicts remain forbidden.

### Boundary behavior

`reviewMatchRatio` is the pass metric; `exactMatchRatio` remains diagnostic.

| Input | Result |
| --- | --- |
| `reviewMatchRatio >= 0.92` | visual target passes |
| `reviewMatchRatio < 0.92` | visual target fails |
| dimensions, receipt, digest, fixture, or capture environment invalid | acquisition rejected; no attempt consumed |
| masks exceed `0.20` or cover all pixels | comparison rejected; no pass |

Exactly `0.92` passes.

## State Machine

### Automatic comparison lineage

The autonomous flow is:

1. Capture and compare every declared target.
2. If all targets pass, continue to independent review.
3. If attempt 1 or 2 has failed targets:
   - persist baseline/current/diff/overlay and metrics first;
   - mark those target IDs as needing repair;
   - reopen implementation with `VISUAL_IMPLEMENTATION_REPAIR_REQUIRED`;
   - expose `implementation-repair`;
   - keep the blocker retryable so the boundary runner continues automatically;
   - keep public workflow status actionable rather than terminally blocked;
   - require a new commit and immutable review packet before recapture.
4. On every repair packet, recapture and compare every declared target. A previous packet's
   actual capture can never satisfy a new packet. Target-scoped probing is deferred until a
   future contract can prove affected-target closure, partial-report coverage, reservation
   identity, and final full-packet freshness without trusting caller assertions.
5. If attempt 3 still fails:
   - close the lineage as `exhausted`;
   - fail implementation with `VISUAL_REVIEW_THRESHOLD_NOT_MET`;
   - classify it as a durable, non-retryable `verification` blocker;
   - set public workflow status to `blocked`;
   - expose no automatic fourth comparison;
   - skip the redundant design-review request for the already-failed visual gate;
   - start blocked-diagnostic finalization when publication was requested.

The terminal transition is one explicit state-machine operation from passed implementation
to failed implementation. It persists the exhausted lineage and the
`VISUAL_REVIEW_THRESHOLD_NOT_MET` error atomically, invalidates downstream review/report/
publish state, and sets `retryable: false`. The error code is a known durable
`verification` blocker with a visual-specific summary and next action. Implementation must
register it in the durable blocker allowlist and stage-error classifier rather than letting
it fall through to a generic unexpected blocker.

Action selection reads only the latest outcome for the current visual lineage and packet.
An `exhausted` outcome stops resolution; the resolver cannot scan backward and revive an
older `repair-required` artifact from attempt 1 or 2.

Terminal outcome identity is derived from Run, lineage, packet, committed attempt number,
and visual report digest. Replaying the same completed submission returns the existing
terminal blocker/report and cannot add another stage transition or publication claim.

The terminal lineage close, implementation failure, downstream-stage invalidation, and
blocker identity are committed in one optimistic Run save. A functional or design result
that finishes late cannot mutate the Run after this terminal fence unless its revision,
packet, head, and nonterminal state are still current.

### Committed attempt semantics

A reservation is not itself a consumed comparison attempt.

- `in-progress` records ownership and idempotency only.
- A numeric visual report completed as `passed` or `failed` commits and consumes one attempt.
- Acquisition, normalization, internal comparison, persistence, or process failure before
  a complete numeric report aborts the reservation and consumes no attempt.
- A retry after an aborted or stale reservation recovers the same attempt number.
- Duplicate submission identity returns the same committed result or resumes the same
  reservation; it cannot consume another attempt.
- The cap counts committed numeric outcomes, not reservation artifacts.

The reservation model therefore needs explicit committed/aborted/stale recovery semantics
and a fence against concurrent submissions.

The final blocked draft is the feedback surface. A later user-directed continuation starts
a new Run or an explicitly designed future lineage; it does not silently exceed the
three-attempt automatic cap.

### Attempt quality

The repair action must receive structured evidence, not just an aggregate score:

- failed target IDs and display names;
- review, exact, mismatch, masked, and threshold ratios;
- diff and overlay artifact IDs;
- target route, state, fixture, viewport, and device scale;
- capture/provider/browser/font readiness summary;
- categorized cause hints: implementation, acquisition, fixture, design mapping, or
  baseline-isolation failure.

Acquisition, contract, and baseline-isolation errors are repaired at their source and
do not invite blind CSS tuning.

The public action remains `implementation-repair`, with a compact current-runtime summary
and a `repairEvidenceArtifactId`. The referenced bounded JSON artifact contains the full
target context, metrics, cause hints, and diff/overlay IDs above. Current-runtime actions
require that artifact; historical v1 lineage records containing only target ID and review
ratio remain readable through an explicit compatibility normalization and never gain
invented fields.

## Canonical Blocked Publication

### "Always publish" contract

For `publication: draft`, a terminal visual mismatch is eligible for draft publication;
the visual failure itself is never a publication precondition failure.

The SDK reserves one diagnostic-finalization turn and a token allowance before the
autonomous work loop reaches its limit:

- once authoritative status first reports `publication: draft`, normal work uses at most
  `maxTurns - 1`;
- normal work budget decisions use
  `hardLimitTokens - blockedDiagnosticTokenReserve`;
- `blockedDiagnosticTokenReserve` is an SDK option with a measured, tested default large
  enough for one publish call and one status call;
- terminal blocked-diagnostic publication has priority over optional final-response
  formatting;
- a completed Run releases the diagnostic reserve;
- an ineligible terminal preflight consumes no mutation turn and returns the local blocked
  result;
- a nonterminal Run that reaches the work limit checkpoints instead of spending the
  reserved finalization capacity.

The finalization performs at most one external mutation claim for the current blocker
identity, then checks status and stops. Idempotent recovery rules for uncertain host
mutations remain in force. Draft-intent SDK input must provide at least two turns.

External publication still requires:

- a clean non-target source branch;
- a committed delta beyond the pinned target;
- a supported and exact GitHub/GitLab remote;
- existing non-interactive credentials for that exact host;
- a current packet/head when visual assets are published.

If one of those conditions is genuinely absent, the plugin records the exact publication
failure and preserves the local blocked report. It never claims that an MR exists when the
host mutation was not confirmed.

### Packet-bound visual evidence

Blocked visual publication must not use the "latest visual report" heuristic.

1. Resolve the Markdown report's `reportJsonArtifactId`.
2. Parse the canonical `pr-report-v2.1` JSON.
3. Resolve `binding.reviewPacketId`, `binding.headSha`, and
   `visual.reportArtifactId`.
4. Revalidate packet/head/diff freshness.
5. Upload only assets referenced by that visual report.

Packet-bound blocked reports propagate `reviewPacketId` and `headSha` to the publisher.
This closes the current GitHub gap where blocked payloads omit both values even though
evidence-ref asset publication requires them. Packetless blockers remain publishable
without fake head or media fields.

### Same report template

Ready and blocked publication use the same `pr-report-v2.1` renderer and section order.
The blocked report changes only truthful content:

- top status is blocked;
- the visual row says failed;
- the measured ratio and `92%` threshold are shown;
- the terminal blocker and exact next action appear under "확인 필요";
- unrun validations remain visible;
- no incomplete review is represented as passed.

The blocked title and `spec-to-pr:blocked` label remain useful host-level signals.

### Visual layout

For each screen:

1. Show route, state, fixture, viewport, DPR, attempt, measured ratio, mismatch ratio,
   exact ratio, masked ratio, threshold, and verdict.
2. Render baseline and current capture in a two-column table with equal explicit display
   width.
3. Put diff and overlay below that table as separate diagnostic links or previews.
4. Start a new block for the next screen so long mobile images do not compress each other.

Failed visual blocked drafts always include baseline, current, and diff when those artifacts
exist. An intake preview preference cannot hide the evidence needed to explain a terminal
visual failure. Overlay remains diagnostic and is included when available.

### Upload reliability

- Upload assets with bounded concurrency.
- Persist a digest-bound upload receipt per asset.
- Retry only transiently failed assets, not already-confirmed uploads.
- Treat malformed or empty upload responses as failure.
- Verify the final draft body contains the confirmed asset URLs.
- Keep GitLab project-relative upload paths intact.
- Do not use raw fallback for generated diff/overlay evidence.
- Leave Run and publish result blocked/partial when required media is not synchronized.

## Authentication Consistency

The SDK preflight and runtime publisher must use the same credential-provider semantics.

1. Explicit environment variables remain first.
2. GitHub may use `gh auth token`.
3. GitLab uses the supported host-aware `glab` token lookup for the exact hostname,
   including credentials backed by the operating-system keyring.
4. Enterprise/custom hosts remain explicit and exact; lookalike hostnames are rejected.
5. Tokens are never persisted in artifacts, command output, reports, or error messages.

This removes the state where runtime publication can read a GitLab credential but SDK
preflight incorrectly declares the credential unavailable.

## Figma and Browser Evidence Hardening

### Native geometry

Every Figma target records logical geometry, bitmap geometry, export scale, and provider.
The acquisition validator requires:

- matching aspect ratio;
- uniform scale on both axes;
- no non-uniform thumbnail upscaling;
- a bitmap large enough to represent the declared logical target;
- exact target node ID and state binding.

A provider thumbnail such as a narrow `202x1024` bitmap cannot be stretched into a
`360x1831` baseline and accepted. The plugin must request a native node export or report an
acquisition blocker. Reacquisition does not consume a visual comparison attempt.

### Deterministic capture environment

The actual capture receipt binds:

- browser family/channel/version;
- renderer/capture adapter version;
- viewport and device scale;
- locale, timezone, color scheme, and reduced-motion state;
- server origin and route;
- fixture ID and digest;
- document, font, and asset readiness;
- actual PNG path and digest.

One Run does not compare or rank scores captured by different renderer lineages as if they
were directly comparable. A warmed server/browser session may be reused only while these
bindings remain stable.

### Baseline isolation

The Figma or legacy baseline is evidence, never implementation.

- Product render code must not import, request, embed, or display the baseline PNG.
- Full-frame or partial baseline overlays invalidate the capture even if the score passes.
- Runtime/source evidence records baseline-isolation checks before comparison.
- Reviewers retain an independent source/bundle check.
- A test fixture that renders the baseline over semantic DOM must be rejected.

### State authority and fixtures

Before contracts, the Figma bundle enumerates each supplied node/state and records the
actual differences between states. Fixtures bind to those state-specific facts by digest.
The implementation cannot preserve an earlier assumption such as "only CINEMA 4K differs"
when the captured Figma states also change other rows.

### Design-system mapping

Every Figma component and icon maps before implementation to:

- design-system package and exact export;
- component props/variant/state;
- icon export;
- semantic text/icon/background/border token;
- expected size and alignment;
- explicit, reviewable exception when no export exists.

Browser evidence verifies computed icon width/height, `flex-shrink`, semantic color, and
alignment. This covers cases such as `icon/normal/spot` with
`semantic/text/tertiary`, close/circle status icons, and SVGs shrinking below their
declared dimensions.

### Targeted UI assertions

The full-page score is supplemented with focused assertions for Figma-critical details:

- equal image geometry;
- top/bottom/outer table borders;
- copy-button size and placement;
- icon size/color/alignment;
- visible focus state;
- heading order and accessible names;
- interactive action behavior.

These assertions explain failures that a single aggregate pixel ratio cannot diagnose.

## Runtime Reduction Plan

### Changes included with the visual policy

1. Keep at most three valid comparisons, but remove the redundant design-review call after
   the third numeric failure.
2. Keep full current-packet target coverage on each valid comparison rather than adding an
   unsafe target-impact shortcut.
3. Retry only failed publication assets.
4. Reserve publication capacity instead of discovering at the terminal boundary that no
   finalization turn remains.

### Instrumentation before deeper optimization

Record without secrets:

- wall time per stage and external action;
- blob bytes and read/write/hash counts;
- Run-store get/save counts and serialized status size;
- legacy file read/parse counts;
- Git command count and binary-diff bytes;
- visual decode/encode pixel counts;
- peak memory and active visual-worker counts;
- visual reservation committed/aborted/stale counts;
- baseline-normalization cache hit/miss counts and key version;
- warm browser-process reuse and isolated context reset/restart counts;
- publication HTTP request and retry counts.

No performance claim is accepted without before/after measurements on the same fixture.

### Follow-up optimization sequence

Each item should be an independent change with its own benchmark and regression tests.

1. **Artifact I/O**
   - return the digest/metadata computed during atomic write;
   - remove unconditional full-content rereads after successful writes;
   - preserve symlink, inode, race, collision, and corruption checks.
2. **Batch intake**
   - read/extract/fetch independent sources with bounded concurrency;
   - canonicalize chunks in memory;
   - save per source or batch instead of rewriting the Run for every chunk;
   - pass prepared bytes/digests forward rather than rereading files.
   - classify API scope from the canonical operation inventory instead of repeatedly
     concatenating complete OpenAPI documents into model-facing classification text.
3. **Legacy freshness**
   - cache source content and ASTs by real path and digest inside inventory construction;
   - pin an immutable file/digest/environment manifest;
   - rebuild semantic inventory only when the manifest changes.
4. **Status projections**
   - add `action`, `checkpoint`, and `detail` status views;
   - default action turns to the compact view;
   - load full inventories only for actions that need them.
5. **Further incremental work**
   - cache decoded/normalized visual inputs using baseline digest, normalizer version,
     source/logical dimensions, color space, and every normalization option in the key;
   - use a memory-bounded target comparison pool;
   - reuse only the server and browser process while creating a fresh isolated context/page
     per target, unless a verified reset clears cookies, storage, service workers, cache,
     fixture state, and event handlers;
   - introduce target-scoped repair probes only with runtime-verifiable affected-target
     closure, explicit partial-report semantics, and mandatory final full-packet evidence;
   - reuse committed packet Git snapshots;
   - reuse packet/head-bound test evidence;
   - reuse packet/head-bound publication preflight within one fenced publish operation;
   - measure visual-failure frequency and reviewer duration before changing reviewer
     scheduling, then avoid reviews that a visual repair would immediately invalidate;
   - batch provider asset mutations where host APIs support it.

## Test Strategy

Implementation follows code TDD and skill-document TDD.

### Runtime RED cases

- `0.9199` fails and `0.92` passes.
- Legacy target threshold data cannot change a new verdict.
- Acquisition rejection consumes no attempt.
- A crashed, aborted, or stale reservation resumes the same attempt number; only complete
  numeric reports consume the three-attempt cap.
- Attempts 1 and 2 return automatic repair actions with failed-target evidence.
- Current repair actions bind a rich repair-evidence artifact; historical minimal actions
  remain readable without fabricated diagnostics.
- Every valid repair attempt contains current-packet captures for all declared targets.
- A passing second/third attempt proceeds normally.
- A failed third attempt becomes a non-retryable verification blocker immediately.
- No design-review action is requested after numeric exhaustion.
- Blocked publication preserves Run status and updates the same source/target draft.
- GitHub and GitLab blocked drafts receive the exact packet-bound visual assets.
- Packetless blockers remain publishable without visual binding.
- Stale packet/report media cannot be selected.
- Two-column baseline/current output has equal display sizing and separate diff/overlay.
- Partial GitLab upload retries only missing assets and verifies body synchronization.
- SDK preflight and runtime resolve the same host-aware keyring credential.
- A terminal failure on the last allowed work turn still receives its reserved publication
  turn, while nonterminal work cannot consume the token reserve.
- A late reviewer result cannot cross the terminal visual revision/packet fence.
- A baseline-overlay implementation is rejected.
- Thumbnail geometry, renderer drift, fixture drift, and icon/token drift are rejected or
  reported with the correct category.

### Skill RED/GREEN cases

Before editing current skills, pressure scenarios exercise the installed wording and record
failures such as:

- lowering or overriding `92%`;
- accepting an invalid Figma thumbnail;
- embedding the baseline to improve the score;
- omitting failed images from a blocked draft;
- guessing an icon or raw color instead of mapping the design-system export and semantic
  token;
- blindly changing CSS for a fixture or capture-environment problem;
- stopping for user feedback after attempt one instead of completing the bounded automatic
  loop.

The same scenarios run after the skill edits and must converge on the required behavior.

### Verification commands

The implementation plan will select focused RED/GREEN commands first, then finish with:

```text
pnpm policy:sync
pnpm guide:assets
pnpm sdk:build
pnpm check
pnpm plugin:validate:codex
```

Release preparation remains a separate maintainer action.

## Compatibility and Rollout

- Historical reports and ADR statements remain readable as historical evidence.
- New comparisons always produce threshold `0.92`.
- Existing source/target draft discovery remains unchanged; blocked and ready publication
  update the same draft.
- `blocked-diagnostic` remains the public intent, avoiding an unnecessary API break.
- Packetless blocked publication remains supported.
- Current generated SDK, bundled MCP output, website, Korean/English docs, agents, and
  skills are regenerated or updated together.
- A new ADR explicitly supersedes only the visual threshold, automatic exhaustion, and
  terminal visual publication portions of ADR 038/039.

## Acceptance Criteria

The design is implemented when all of the following are true:

1. Every new runtime visual verdict uses exactly `0.92`.
2. Three valid comparisons can run autonomously without pausing for user feedback.
3. Invalid acquisition never consumes one of those comparisons.
4. Every valid attempt contains a fresh current-packet capture for every declared target;
   any all-target pass continues normal delivery.
5. Third-attempt failure immediately yields a durable blocked verification status.
6. The requested draft is created or updated with truthful failed evidence whenever safe
   publication preconditions are satisfied.
7. Ready and blocked drafts share one report structure.
8. Baseline/current images are equally sized; diff/overlay are separately inspectable.
9. Packet/head/media binding prevents stale or circular evidence.
10. Figma geometry, state fixtures, design-system icons/tokens, browser capture, and focused
    UI assertions cover the observed MobyDick failure modes.
11. The initial runtime-reduction changes are measured, and deeper optimizations remain
    separated into benchmarked follow-ups.
