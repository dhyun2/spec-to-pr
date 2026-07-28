# 92% Visual Gate and Terminal State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new visual comparison use the fixed 92% gate, count only complete numeric comparisons, run two automatic repairs, terminally block the third failed comparison, and preserve one SDK turn/token reserve for the requested blocked draft.

**Architecture:** Keep `VISUAL_POLICY` as the only active threshold source. Extract reservation reduction and lineage outcome selection into pure workflow modules, then make `WorkflowService` commit each numeric outcome, rich repair evidence, and any terminal transition through one optimistic Run save. Fence late reviewers against the current packet and make the SDK use a separate normal-work budget once authoritative status confirms draft publication.

**Tech Stack:** TypeScript 5.9, Zod 4, Vitest 3, SQLite Run store, Codex SDK package, pnpm/tsup.

## Global Constraints

- Follow code TDD: write each focused failing test, run it and inspect the expected failure, implement the minimum behavior, then rerun it.
- `VISUAL_POLICY.reviewThreshold` is exactly `0.92`; callers, manifests, and persisted target data cannot alter a new verdict.
- Preserve historical visual report metrics verbatim. Compatibility normalization applies only when an old target is used for a new comparison.
- One valid attempt contains a complete numeric report for every declared target from the current packet. A reservation, aborted operation, stale lease, or acquisition failure does not consume an attempt.
- Attempts 1 and 2 remain automatic and retryable. Attempt 3 failure is immediately non-retryable and does not request design review.
- Blob writes may precede a Run save, but the committed numeric reservation, visual report references, lineage outcome, terminal checkpoint, implementation failure, and downstream invalidation must become visible in one optimistic Run save.
- Never weaken packet, head, diff, capture digest, mask, dimension, fixture, or receipt validation.
- Do not implement target-scoped partial recapture in this plan.
- Do not manually edit generated SDK policy, SDK `dist`, runtime schemas, or MCP bundle outputs; regenerate them with repository scripts.
- Make one commit after each task passes its focused tests.

---

## Task 1: Fix the Runtime-Owned Threshold at 92%

**Files:**

- Modify: `src/workflow/delivery-mode-policy.ts`
- Modify: `src/visual/visual-comparator.ts`
- Modify: `src/application/workflow-service.ts`
- Test: `tests/unit/visual-comparator.test.ts`
- Test: `tests/unit/delivery-policy.test.ts`
- Test: `tests/integration/workflow-service.test.ts`

- [ ] **Step 1: Add failing boundary and override tests**

Add tests that construct 10,000 compared pixels so the ratios are exact:

```ts
it("passes exactly 0.92 and fails 0.9199", async () => {
  const atBoundary = await compareVisualPngs({
    baseline: solidPng(100, 100, [0, 0, 0, 255]),
    actual: pngWithChangedPixels(100, 100, 800),
  });
  const belowBoundary = await compareVisualPngs({
    baseline: solidPng(100, 100, [0, 0, 0, 255]),
    actual: pngWithChangedPixels(100, 100, 801),
  });

  expect(atBoundary.metrics.reviewMatchRatio).toBe(0.92);
  expect(atBoundary.metrics.threshold).toBe(0.92);
  expect(atBoundary.status).toBe("passed");
  expect(belowBoundary.metrics.reviewMatchRatio).toBe(0.9199);
  expect(belowBoundary.status).toBe("failed");
});

it("normalizes a stored legacy target threshold before a new comparison", () => {
  expect(
    normalizeVisualTargetManifest({
      ...visualTarget(),
      reviewThreshold: 0.98,
    }).reviewThreshold,
  ).toBe(0.92);
});
```

Add an integration assertion that a submitted new Figma target records `0.92`, and that loading an old artifact with `reviewThreshold: 0.98` yields a new report whose `metrics.threshold` is `0.92`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/visual-comparator.test.ts tests/unit/delivery-policy.test.ts
```

Expected RED: the boundary report uses `0.98`, and the current comparator accepts a per-call/per-target override.

- [ ] **Step 3: Separate compatibility parsing from canonical targets**

In `src/visual/visual-comparator.ts`, move the current fields from `targetId` through
`masks` into `VisualTargetManifestCoreSchema`, then define a compatibility parser and
canonical normalizer:

```ts
const VisualTargetManifestCompatibilitySchema = VisualTargetManifestCoreSchema.extend({
  reviewThreshold: z.number().min(0).max(1).optional(),
}).strict();

export type VisualTargetManifest = Omit<
  z.infer<typeof VisualTargetManifestCompatibilitySchema>,
  "reviewThreshold"
> & {
  reviewThreshold: typeof VISUAL_POLICY.reviewThreshold;
};

export function normalizeVisualTargetManifest(raw: unknown): VisualTargetManifest {
  const parsed = VisualTargetManifestCompatibilitySchema.parse(raw);
  return {
    ...parsed,
    reviewThreshold: VISUAL_POLICY.reviewThreshold,
  };
}
```

Expose a canonical `VisualTargetManifestSchema` whose public/new input only accepts the literal active threshold:

```ts
reviewThreshold: z
  .literal(VISUAL_POLICY.reviewThreshold)
  .default(VISUAL_POLICY.reviewThreshold),
```

Use `normalizeVisualTargetManifest` only when reading pre-existing artifact metadata in `visualTargetsFromRun` and the Figma manifest compatibility path. New submissions must pass the canonical schema.

- [ ] **Step 4: Remove threshold control from the comparator call**

Change the policy and comparator API:

```ts
export const VISUAL_POLICY = {
  reviewThreshold: 0.92,
  maxMaskedAreaRatio: 0.2,
  maxComparisonAttempts: 3,
} as const;
```

```ts
export async function compareVisualPngs(input: {
  baseline: Buffer;
  actual: Buffer;
  masks?: VisualMask[];
  pixelTolerance?: number;
}): Promise<VisualComparisonOutput> {
  const threshold = VISUAL_POLICY.reviewThreshold;
  return compareDecodedVisualPngs({ ...input, threshold });
}
```

Extract the current decode/mask/distance implementation without behavioral changes into
`compareDecodedVisualPngs`, whose `threshold` argument is module-private. Delete
`reviewThreshold: target.reviewThreshold` from `WorkflowService.recordVisualComparison`.
Keep `reviewThreshold` on canonical target data only as recorded policy evidence.

- [ ] **Step 5: Run unit and integration GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/visual-comparator.test.ts tests/unit/delivery-policy.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual"
```

Expected GREEN: exactly `0.92` passes, `0.9199` fails, old target data cannot change a new verdict, and old report JSON is not rewritten.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/delivery-mode-policy.ts src/visual/visual-comparator.ts src/application/workflow-service.ts tests/unit/visual-comparator.test.ts tests/unit/delivery-policy.test.ts tests/integration/workflow-service.test.ts
git commit -m "fix: enforce the 92 percent visual gate"
```

---

## Task 2: Count Only Committed Numeric Attempts

**Files:**

- Create: `src/workflow/visual-attempt-reservation.ts`
- Modify: `src/workflow/visual-repair-lineage.ts`
- Modify: `src/application/workflow-service.ts`
- Create: `tests/unit/visual-attempt-reservation.test.ts`
- Modify: `tests/unit/visual-repair-lineage.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`

- [ ] **Step 1: Write reducer RED tests**

Cover committed, aborted, stale, duplicate, and concurrent cases:

```ts
const now = "2026-07-28T10:30:00.000Z";

it("reuses attempt one after aborted and stale reservations", () => {
  expect(
    nextCommittedVisualAttempt(
      reduceVisualReservations([
        reservation({ attempt: 1, status: "aborted" }),
        reservation({
          attempt: 1,
          status: "in-progress",
          reservedAt: "2026-07-28T10:00:00.000Z",
        }),
      ], now),
    ),
  ).toBe(1);
});

it("counts only a committed numeric report", () => {
  expect(
    nextCommittedVisualAttempt(
      reduceVisualReservations([
        reservation({ attempt: 1, status: "committed" }),
        reservation({ attempt: 2, status: "aborted" }),
      ], now),
    ),
  ).toBe(2);
});
```

Add integration tests that inject a comparator/blob failure after reservation, then assert:

- an `aborted` event exists;
- `workflow_status.nextActions` offers `compare-visuals` with `attempt: 1`;
- the next successful report is attempt 1;
- replaying its submission identity does not add a report or Run revision.

- [ ] **Step 2: Run the reducer and visual integration tests to confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/visual-attempt-reservation.test.ts tests/unit/visual-repair-lineage.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual comparison"
```

Expected RED: current reservation count consumes failed/in-progress attempts and a stale record hides the next action indefinitely.

- [ ] **Step 3: Implement the pure reservation model**

Create `src/workflow/visual-attempt-reservation.ts`:

```ts
export const VISUAL_ATTEMPT_LEASE_MS = 15 * 60 * 1_000;
export type VisualAttemptNumber = 1 | 2 | 3;
export type VisualReservationStatus =
  | "in-progress"
  | "committed"
  | "aborted"
  | "stale";

export type VisualAttemptReservation = {
  submissionIdentity: string;
  attempt: VisualAttemptNumber;
  status: VisualReservationStatus;
  ownerToken: string;
  reservedAt: string;
  updatedAt: string;
  reportArtifactId?: string;
  reportDigest?: string;
};

export type VisualReservationSummary = {
  committed: VisualAttemptReservation[];
  active?: VisualAttemptReservation;
  recoverable?: VisualAttemptReservation;
};
```

Implement:

```ts
export function reduceVisualReservations(
  events: VisualAttemptReservation[],
  nowIso: string,
): VisualReservationSummary;

export function nextCommittedVisualAttempt(
  summary: VisualReservationSummary,
): VisualAttemptNumber | undefined;
```

Rules:

- collapse events by `ownerToken`, then by submission identity;
- normalize legacy v2 `completed` to `committed` and `failed` to `aborted`;
- an in-progress event older than 15 minutes is `recoverable`, never committed;
- committed attempt numbers must be contiguous and unique;
- `nextCommittedVisualAttempt` returns committed count + 1, capped at 3.

- [ ] **Step 4: Upgrade WorkflowService reservations to fenced v3 events**

Change the status artifact adapter to `visual-attempt-reservation-v3`. Generate an opaque `ownerToken` at reservation time and persist `reservedAt`, `updatedAt`, optional report ID/digest, and one of the four statuses.

Make `reserveVisualAttempt` return:

```ts
type VisualAttemptReservationResult =
  | { kind: "reserved"; reservation: VisualAttemptReservation }
  | { kind: "committed-replay"; reservation: VisualAttemptReservation }
  | { kind: "busy"; reservation: VisualAttemptReservation };
```

Behavior:

- matching committed identity returns `committed-replay`;
- matching non-stale in-progress identity returns `busy` without mutation;
- stale in-progress first appends `stale`, then reserves the same next committed attempt number;
- an active different identity returns retryable `VISUAL_ATTEMPT_IN_PROGRESS`;
- a thrown acquisition/normalization/comparison/blob error appends `aborted`;
- only a `committed` event with a complete report ID/digest advances the counter.

Rename `visualComparisonAttemptCount` to `committedVisualComparisonAttemptCount`, and use it in action selection and cap checks. `hasInProgressVisualAttempt` must ignore stale leases.

- [ ] **Step 5: Add idempotent replay before stage prerequisites**

Before rejecting a visual submission because terminal implementation is no longer passed, compute its current packet/capture identity and look for a committed v3 event. If it matches, return the current status without ingesting files, starting a stage, or incrementing the revision. A different identity still fails the terminal/cap prerequisite.

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/visual-attempt-reservation.test.ts tests/unit/visual-repair-lineage.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual comparison"
```

- [ ] **Step 7: Commit**

```bash
git add src/workflow/visual-attempt-reservation.ts src/workflow/visual-repair-lineage.ts src/application/workflow-service.ts tests/unit/visual-attempt-reservation.test.ts tests/unit/visual-repair-lineage.test.ts tests/integration/workflow-service.test.ts
git commit -m "fix: count committed visual attempts only"
```

---

## Task 3: Bind Automatic Repairs to Rich Current-Lineage Evidence

**Files:**

- Modify: `src/workflow/visual-repair-lineage.ts`
- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `tests/unit/visual-repair-lineage.test.ts`
- Modify: `tests/unit/workflow-contracts.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`

- [ ] **Step 1: Write rich-evidence and stale-lineage RED tests**

Add a workflow action contract test:

```ts
expect(
  WorkflowActionSchema.parse({
    kind: "implementation-repair",
    repairEvidenceVersion: "v2",
    runId,
    reviewPacketId,
    lineageId,
    nextAttempt: 2,
    failedTargets: [{ targetId: "shop-default", reviewMatchRatio: 0.87 }],
    repairEvidenceArtifactId,
  }),
).toMatchObject({ repairEvidenceVersion: "v2", repairEvidenceArtifactId });
```

Add a lineage test proving `[repair-required attempt 1, exhausted attempt 3]` resolves to no repair action, and a compatibility test proving a historical v1 action has `repairEvidenceVersion: "legacy-v1"` and no invented artifact ID.

Add an integration test with two targets showing the second packet must supply fresh captures for both targets even when only one failed.

- [ ] **Step 2: Run tests to confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/visual-repair-lineage.test.ts tests/unit/workflow-contracts.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual"
```

- [ ] **Step 3: Define lineage outcomes and latest-outcome selection**

In `src/workflow/visual-repair-lineage.ts`, add:

```ts
export type VisualLineageOutcomeStatus =
  | "repair-required"
  | "closed"
  | "exhausted";

export type VisualLineageOutcome = {
  lineageId: string;
  sourcePacketId: string;
  attempt: 1 | 2 | 3;
  status: VisualLineageOutcomeStatus;
  repairEvidenceArtifactId?: string;
};

export function latestVisualLineageOutcome(
  outcomes: VisualLineageOutcome[],
  lineageId: string,
): VisualLineageOutcome | undefined;
```

Sort by committed attempt, reject duplicate/conflicting outcomes, and return the highest committed outcome. `closed` and `exhausted` are terminal for resolution; never scan backward past them.

- [ ] **Step 4: Add the bounded rich repair artifact**

Write one `visual-repair-evidence-v2` JSON artifact per failed numeric attempt:

```ts
const VisualRepairEvidenceV2Schema = z.object({
  schemaVersion: z.literal("visual-repair-evidence-v2"),
  runId: RunIdSchema,
  lineageId: ReviewPacketIdSchema,
  reviewPacketId: ReviewPacketIdSchema,
  attempt: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  generatedAt: IsoDateTimeSchema,
  failedTargets: z.array(z.object({
    targetId: VisualTargetManifestSchema.shape.targetId,
    name: z.string(),
    route: z.string(),
    state: z.string(),
    fixture: z.string(),
    viewport: VisualTargetManifestSchema.shape.viewport,
    deviceScaleFactor: z.number(),
    metrics: VisualComparisonMetricsV2Schema,
    diffArtifactId: ArtifactIdSchema,
    overlayArtifactId: ArtifactIdSchema,
    captureSummary: z.object({
      provider: z.string(),
      browser: z.string(),
      fontsReady: z.boolean(),
      assetsReady: z.boolean(),
    }).strict(),
    causeHints: z.array(z.enum([
      "implementation",
      "acquisition",
      "fixture",
      "design-mapping",
      "baseline-isolation",
    ])),
  }).min(1).max(50),
}).strict();
```

Cause hints must come from validated runtime evidence/error categories, never from a caller verdict. Keep the public `failedTargets` list compact and put complete diagnostics in this artifact.

- [ ] **Step 5: Version the repair action without fabricating legacy data**

Represent the action as two schema variants with the same public kind:

```ts
const CurrentImplementationRepairActionSchema = z.object({
  kind: z.literal("implementation-repair"),
  repairEvidenceVersion: z.literal("v2"),
  runId: RunIdSchema,
  reviewPacketId: ReviewPacketIdSchema,
  lineageId: ReviewPacketIdSchema,
  nextAttempt: z.union([z.literal(2), z.literal(3)]),
  failedTargets: CompactFailedVisualTargetsSchema,
  repairEvidenceArtifactId: ArtifactIdSchema,
}).strict();

const LegacyImplementationRepairActionSchema = z.object({
  kind: z.literal("implementation-repair"),
  repairEvidenceVersion: z.literal("legacy-v1"),
  runId: RunIdSchema,
  reviewPacketId: ReviewPacketIdSchema,
  lineageId: ReviewPacketIdSchema,
  nextAttempt: z.union([z.literal(2), z.literal(3)]),
  failedTargets: CompactFailedVisualTargetsSchema,
}).strict();
```

New outcomes always emit `v2`. Only a stored `visual-repair-lineage-v1` record may normalize to `legacy-v1`.

- [ ] **Step 6: Replace backward scans with current-lineage resolution**

Update `activeVisualRepairAction` and `activeVisualRepairCheckpoint` to:

- resolve the current lineage;
- read only its latest committed outcome;
- require `status === "repair-required"`;
- bind the source packet and repair evidence ID;
- refuse an older packet, `closed`, or `exhausted` outcome.

Keep `reopenImplementationForVisualRepair` retryable for attempts 1 and 2.

- [ ] **Step 7: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/visual-repair-lineage.test.ts tests/unit/workflow-contracts.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual"
```

- [ ] **Step 8: Commit**

```bash
git add src/workflow/visual-repair-lineage.ts src/workflow/workflow-contracts.ts src/application/workflow-service.ts tests/unit/visual-repair-lineage.test.ts tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts
git commit -m "feat: attach rich evidence to visual repairs"
```

---

## Task 4: Make the Third Failed Comparison an Atomic Terminal Blocker

**Files:**

- Modify: `src/state/stage-machine.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `tests/unit/stage-machine.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`

- [ ] **Step 1: Write terminal transition RED tests**

Add a stage-machine test asserting one revision and complete invalidation:

```ts
const terminal = terminalizeVisualThresholdFailure(runWithPassedImplementation(), {
  artifacts: [committedAttempt, visualReport, exhaustedLineage],
  reviewPacket,
  visualLineageId,
  visualReportArtifactId: visualReport.id,
  visualReportDigest: visualReport.digest,
  terminalIdentity,
  timestamp,
});

expect(terminal.revision).toBe(run.revision + 1);
expect(terminal.status).toBe("blocked");
expect(stage(terminal, "implementation").error).toEqual({
  code: "VISUAL_REVIEW_THRESHOLD_NOT_MET",
  message: expect.stringContaining("92%"),
  retryable: false,
});
expect(stage(terminal, "implementation").checkpoint?.data).toMatchObject({
  visualLineageId,
  visualComparisonAttempt: 3,
  visualReportArtifactId: visualReport.id,
  visualReportDigest: visualReport.digest,
  visualTerminalIdentity: terminalIdentity,
});
```

Update the end-to-end three-attempt test to require:

- public status `blocked`;
- blocker code `VISUAL_REVIEW_THRESHOLD_NOT_MET`;
- blocker kind `verification`, `retryable: false`;
- no compare, repair, functional-review, or design-review action;
- replay of the same third submission makes no revision/artifact change.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/stage-machine.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "three visual"
```

Expected RED: attempt 3 only stores `exhausted`, leaves implementation passed, and enables design review.

- [ ] **Step 3: Add the explicit terminal transition**

Export this operation from `src/state/stage-machine.ts`:

```ts
export function terminalizeVisualThresholdFailure(
  run: RunManifest,
  input: {
    artifacts: ArtifactRef[];
    reviewPacket: ImplementationReviewPacket;
    visualLineageId: string;
    visualReportArtifactId: string;
    visualReportDigest: string;
    terminalIdentity: string;
    timestamp: string;
  },
): RunManifest;
```

It must:

- require passed implementation and a still-current packet/head/diff;
- append all supplied artifact references;
- fail implementation with non-retryable `VISUAL_REVIEW_THRESHOLD_NOT_MET`;
- preserve the review packet plus terminal identity in a strict implementation checkpoint named `visual-threshold-not-met`;
- reset functional review, design review, report, publish, and archive to pending with cleared leases/checkpoints/artifact IDs/errors;
- set Run status `blocked`;
- increment the Run revision exactly once.

Keep terminal identity out of `StageError`, whose schema remains the strict `{code,message,retryable}` shape.

- [ ] **Step 4: Commit numeric outcome and terminal state together**

Replace the split `appendVisualAttemptArtifacts` / `recordVisualRepairOutcome` path with:

```ts
private async commitVisualAttemptOutcome(input: {
  runId: string;
  packet: ImplementationReviewPacket;
  reservation: VisualAttemptReservation;
  generatedArtifacts: ArtifactRef[];
  visualReport: ArtifactRef;
  lineageArtifact: ArtifactRef;
  repairEvidenceArtifact?: ArtifactRef;
  status: "passed" | "failed";
}): Promise<void>;
```

For attempt 3 failure, derive:

```ts
const terminalIdentity = `sha256:${createHash("sha256")
  .update(JSON.stringify({
    runId,
    lineageId,
    reviewPacketId: packet.id,
    attempt: 3,
    visualReportDigest: visualReport.digest,
  }))
  .digest("hex")}`;
```

Then perform one optimistic save containing committed reservation, generated media/report refs, exhausted lineage, terminal checkpoint, implementation failure, and downstream invalidation. On a revision conflict, reload and:

- return idempotently if the same terminal identity is present;
- retry only if the same packet/head/diff remains current and implementation is still passed;
- otherwise reject as stale.

- [ ] **Step 5: Register a durable visual verification blocker**

Add `VISUAL_REVIEW_THRESHOLD_NOT_MET` to `KNOWN_DURABLE_BLOCKER_CODES`. Map it explicitly to `verification`, and render visual-specific text:

```ts
if (code === "VISUAL_REVIEW_THRESHOLD_NOT_MET") {
  return "Inspect the failed 92% visual comparison in the draft, correct the implementation or evidence source, and start a new approved Run for further work.";
}
```

Make `blockedDiagnosticReportKey` use the persisted `visualTerminalIdentity` for this code. Other blockers retain their existing key.

- [ ] **Step 6: Remove the post-exhaustion design-review route**

In `actionsForRun`, design review is eligible only when visual comparison is not applicable or the current packet has passed:

```ts
!profile.requirements.visualComparison ||
currentVisual?.metadata["visualStatus"] === "passed"
```

Delete the `attempts >= max` exception. A failed third comparison already supplies the authoritative numeric gate failure.

- [ ] **Step 7: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/stage-machine.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual"
```

- [ ] **Step 8: Commit**

```bash
git add src/state/stage-machine.ts src/application/workflow-service.ts tests/unit/stage-machine.test.ts tests/integration/workflow-service.test.ts
git commit -m "fix: block terminal visual mismatches atomically"
```

---

## Task 5: Fence Late Reviewer Results

**Files:**

- Modify: `src/application/stage-service.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `tests/integration/workflow-service.test.ts`

- [ ] **Step 1: Add a deterministic race RED test**

Use a deferred artifact-store operation:

```ts
const lateReview = service.submit({
  runId,
  submission: approvedFunctionalReview(packet.id),
});
await reviewerEvidenceIngested.promise;

await service.submit({
  runId,
  submission: thirdFailedVisualSubmission(packet.id),
});

releaseReviewerEvidence();
await expect(lateReview).rejects.toThrow(/REVIEW_PACKET_STALE|visual threshold/i);
```

Assert the terminal revision, implementation failure, blocker, and invalidated review stages remain unchanged.

- [ ] **Step 2: Run the race test and confirm RED**

Run:

```bash
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "late reviewer"
```

- [ ] **Step 3: Add revision-aware stage start**

Extend `StartStageInputSchema` and `StageService.start` with optional `expectedRevision`. The Run-store save must reject a stale expected revision.

Immediately before starting a review, re-read the Run and validate:

```ts
type ReviewSubmissionFence = {
  reviewPacketId: string;
  headSha: string;
  diffDigest: string;
};

function assertCurrentReviewFence(
  run: RunManifest,
  fence: ReviewSubmissionFence,
  reviewStage: "functional-review" | "design-review",
): void;
```

The helper requires:

- same current packet ID/head/diff;
- implementation still passed;
- review stage still nonterminal/actionable;
- no `visual-threshold-not-met` terminal checkpoint.

Start with the refreshed current revision. If another reviewer committed on the same packet, refresh and retry; if terminalization won, reject. A terminal transition that races after stage start clears the review lease, so the late completion also fails.

- [ ] **Step 4: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "review|visual"
```

- [ ] **Step 5: Commit**

```bash
git add src/application/stage-service.ts src/application/workflow-service.ts tests/integration/workflow-service.test.ts
git commit -m "fix: fence reviews against terminal visual state"
```

---

## Task 6: Reserve SDK Finalization Capacity for Blocked Drafts

**Files:**

- Modify: `packages/codex-sdk/src/boundary-runner.ts`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `packages/codex-sdk/src/cli.ts`
- Modify: `tests/unit/codex-sdk-budget.test.ts`
- Modify: `tests/unit/codex-sdk-workflow-policy.test.ts`
- Modify: `packages/codex-sdk/README.md`

- [ ] **Step 1: Add failing reserve tests**

Use the deterministic boundary harness to model a 16,000-token blocked publish/status pair. Set the default to 24,000 tokens, giving 50% measured headroom:

```ts
expect(DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE).toBe(24_000);
```

Add tests for:

1. a draft Run becomes blocked on the last normal turn and still gets one finalization turn;
2. a nonterminal Run cannot consume the reserved last turn;
3. normal work decisions use `hardLimitTokens - 24_000`;
4. a completed Run releases the reserve;
5. ineligible preflight consumes no mutation turn;
6. blocked publication runs before optional output formatting;
7. `publication: "draft", maxTurns: 1` is rejected before Codex starts.

- [ ] **Step 2: Run SDK tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/codex-sdk-budget.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
```

- [ ] **Step 3: Add and validate the SDK option**

In `spec-to-pr-runner.ts`:

```ts
export const DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE = 24_000;
```

Add `blockedDiagnosticTokenReserve?: number` to `SpecToPrCodexRunInput`.
Require a positive integer smaller than the smallest supported hard limit. For draft publication, require `maxTurns === undefined || maxTurns >= 2`. Add CLI flag `--blocked-diagnostic-token-reserve <positive-int>` and document it.

- [ ] **Step 4: Latch a separate normal-work budget**

Pass the reserve into `executeBudgetedBoundaryTurns`. Once authoritative `workflow_status` first reports `publication: "draft"`:

```ts
const normalTurnLimit = input.maxTurns - 1;
const normalTokenLimit =
  activeHardLimitTokens - input.blockedDiagnosticTokenReserve;
```

Use those limits only for nonterminal work and checkpoint decisions. Required behavior:

- eligible blocked finalization may use the held turn and tokens;
- completed releases the held capacity;
- nonterminal work at either normal limit checkpoints/stops without spending it;
- ineligible terminal preflight returns the local blocked result without another model turn;
- final formatting can use remaining capacity only after blocked finalization is finished.

The finalization prompt still permits at most one publish mutation claim and one status call.

- [ ] **Step 5: Run GREEN tests and build the SDK**

Run:

```bash
pnpm exec vitest run tests/unit/codex-sdk-budget.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
pnpm sdk:build
pnpm sdk:check-dist
```

- [ ] **Step 6: Commit**

```bash
git add packages/codex-sdk/src/boundary-runner.ts packages/codex-sdk/src/spec-to-pr-runner.ts packages/codex-sdk/src/cli.ts packages/codex-sdk/README.md packages/codex-sdk/dist tests/unit/codex-sdk-budget.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
git commit -m "feat: reserve blocked draft finalization capacity"
```

---

## Task 7: Regenerate Policy Outputs and Verify the State-Machine Slice

**Files:**

- Regenerate: `packages/codex-sdk/src/generated/delivery-mode-policy.ts`
- Regenerate: `packages/codex-sdk/dist/**`
- Regenerate: `schemas/runtime/**`
- Regenerate: `dist/mcp/**`
- Modify if snapshots require it: `tests/plugin/layout.test.ts`

- [ ] **Step 1: Regenerate from source**

Run:

```bash
pnpm policy:sync
pnpm schemas:build
pnpm sdk:build
pnpm build
```

- [ ] **Step 2: Verify generated files and focused suites**

Run:

```bash
pnpm policy:check
pnpm schemas:check
pnpm sdk:check-dist
pnpm bundle:check-dist
pnpm exec vitest run tests/unit/visual-comparator.test.ts tests/unit/visual-attempt-reservation.test.ts tests/unit/visual-repair-lineage.test.ts tests/unit/stage-machine.test.ts tests/unit/codex-sdk-budget.test.ts tests/unit/codex-sdk-workflow-policy.test.ts tests/integration/workflow-service.test.ts
pnpm typecheck
```

- [ ] **Step 3: Inspect the active threshold and terminal action contract**

Run:

```bash
rg -n "0\\.98|98%" src packages/codex-sdk/src skills README.md website .codex
rg -n "VISUAL_REVIEW_THRESHOLD_NOT_MET|repairEvidenceArtifactId|blockedDiagnosticTokenReserve" src packages/codex-sdk/src tests
```

At this slice, remaining active `0.98` references may exist only in documentation/skills scheduled by the Figma evidence plan; generated runtime policy must already show `0.92`. Historical ADR 038/039 references remain untouched.

- [ ] **Step 4: Commit generated outputs**

```bash
git add packages/codex-sdk/src/generated packages/codex-sdk/dist schemas/runtime dist/mcp tests/plugin/layout.test.ts
git commit -m "chore: regenerate visual policy contracts"
```
