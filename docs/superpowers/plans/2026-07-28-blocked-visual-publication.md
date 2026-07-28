# Packet-Bound Blocked Visual Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create or update the same draft PR/MR after terminal visual failure, using the canonical report’s exact packet/head/visual artifacts, an equal-size two-column preview, reliable digest-bound uploads, and consistent exact-host credentials.

**Architecture:** Resolve publication data from the Markdown report to its referenced `pr-report-v2.1` JSON and then to the exact visual report. Carry that binding through planning, branch validation, host asset publication, and body verification for both ready and blocked intents. Persist one upload receipt per immutable asset digest and retry only transient missing assets. Keep packetless blockers valid without fabricating packet or media fields.

**Tech Stack:** TypeScript 5.9, Zod 4, Vitest 3, GitHub/GitLab REST APIs, gh/glab CLIs, Markdown/HTML report rendering.

## Global Constraints

- Follow code TDD for every task: observe the focused RED failure before implementation and rerun to GREEN.
- Keep `blocked-diagnostic` as the public intent. Do not add a `feedback` intent.
- Ready and blocked publication must use the same `pr-report-v2.1` renderer and section order.
- Resolve visual media only through `Markdown.reportJsonArtifactId -> PrReportV2 -> binding + visual.reportArtifactId`.
- Never select a packet-bound blocked visual report with a global “latest visual report” heuristic.
- A visual report ID without packet/head/diff binding is invalid. A genuinely packetless blocker remains publishable with no visual media.
- Blocked visual publication leaves the Run blocked and the draft marked as blocked; it never reports a visual pass.
- Never merge, approve, close, or mark a draft ready.
- Preserve clean-tree, non-target branch, committed delta, exact remote, and uncertain-mutation fences.
- Failed blocked visual drafts always include available baseline, current, and diff assets; overlay is included when present. Intake preview preferences cannot hide them.
- Generated diff/overlay assets never use a raw-file fallback.
- Keep GitLab project-relative upload paths unchanged.
- Never persist or print credential values.
- Make one commit after each task passes focused tests.

---

## Task 1: Resolve the Canonical Report and Exact Failed Packet

**Files:**

- Modify: `src/pr-report/pr-report-model.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/application/publisher-service.ts`
- Modify: `tests/unit/workflow-report-renderer.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/integration/publisher-service.test.ts`

- [ ] **Step 1: Add canonical-binding RED tests**

Add tests for four cases:

```ts
it("binds a terminal visual blocked report to its exact packet and visual report", async () => {
  const markdown = await workflow.ensureBlockedDiagnosticReport({ runId });
  const json = await readReferencedPrReport(markdown);

  expect(json).toMatchObject({
    schemaVersion: "pr-report-v2.1",
    decision: "blocked",
    binding: {
      reviewPacketId,
      headSha,
      diffDigest,
    },
    visual: {
      applicable: true,
      reportArtifactId: failedVisualReportArtifactId,
    },
  });
});

it("keeps a packetless blocker publishable without invented binding", async () => {
  const plan = await publisher.plan(packetlessBlockedInput());
  expect(plan.payload).not.toHaveProperty("reviewPacketId");
  expect(plan.payload).not.toHaveProperty("headSha");
});
```

Also create a crossed/stale fixture where the Markdown references report JSON A but A names visual report B from another packet; expect `PUBLISH_REPORT_BINDING_INVALID`.

In the renderer unit test, compare the ordered `##` headings for ready and blocked v2.1 reports and assert that the blocked visual row remains failed, the 92% threshold is visible, and unfinished reviews remain `not-run`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-report-renderer.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "blocked diagnostic"
pnpm exec vitest run tests/integration/publisher-service.test.ts -t "blocked"
```

Expected RED: blocked publisher payload omits packet/head and can fall back to a latest visual artifact.

- [ ] **Step 3: Reuse one canonical report persistence helper**

In `WorkflowService`, extract:

```ts
private async writePrReportArtifacts(input: {
  run: RunManifest;
  report: PrReportV2;
  reportIntent: WorkflowReportIntent;
  timestamp: string;
  metadata: Record<string, unknown>;
}): Promise<{
  jsonArtifact: ArtifactRef;
  markdownArtifact: ArtifactRef;
}>;
```

Use it from ready and blocked report generation. It must:

- validate `PrReportV2Schema` and current v2.1 invariants;
- write JSON first;
- render Markdown only through `renderPrReportV2Markdown`;
- put `reportJsonArtifactId` on Markdown;
- copy packet/head/diff/visual-report IDs into artifact metadata only when the JSON has a binding;
- use Korean locale metadata for the existing Korean v2.1 renderer;
- preserve the same 15-section order.

For `VISUAL_REVIEW_THRESHOLD_NOT_MET`, `materializeBlockedReport` must resolve the implementation terminal checkpoint, require its terminal identity/report ID/digest, and include that exact current report. It must not call a latest-report helper.

- [ ] **Step 4: Add one publication report resolver**

In `PublisherService`, add:

```ts
type PublicationReportBinding = {
  report: PrReportV2;
  jsonArtifact: ArtifactRef;
  reviewPacketId?: string;
  headSha?: string;
  diffDigest?: string;
  visualReportArtifact?: ArtifactRef;
};

private async resolvePublicationReportBinding(
  run: RunManifest,
  markdownArtifact: ArtifactRef,
): Promise<PublicationReportBinding>;
```

The resolver must:

1. require `markdownArtifact.metadata.reportJsonArtifactId`;
2. read and parse that exact artifact as `PrReportV2Schema`;
3. validate Run ID, report intent, decision, and schema version;
4. when `visual.reportArtifactId` exists, require `binding`;
5. resolve that exact visual artifact ID;
6. match its metadata and JSON content to binding packet/head/diff;
7. match its digest to the terminal checkpoint for terminal visual blockers;
8. return no packet fields/media only when the canonical report is genuinely packetless.

Use the resolver from both `plan` and visual asset collection.

- [ ] **Step 5: Carry blocked packet/head through planning and branch checks**

Build `ReviewRequestPayload` from resolved binding for both intents:

```ts
const payload = ReviewRequestPayloadSchema.parse({
  runId: run.id,
  title,
  body,
  sourceBranch: input.sourceBranch,
  targetBranch: input.targetBranch,
  mode: "draft",
  labels,
  reviewers,
  assignees,
  reportArtifactId: markdownArtifact.id,
  ...(binding.headSha === undefined ? {} : { headSha: binding.headSha }),
  ...(binding.reviewPacketId === undefined
    ? {}
    : { reviewPacketId: binding.reviewPacketId }),
});
```

Call `assertPublishBranchReady` with the bound head for packet-bound blocked reports. Remove conditionals that strip these fields merely because intent is `blocked-diagnostic`.

In `WorkflowService.executeBlockedDiagnostic`, parse the ensured canonical report and propagate its `reviewPacketId`/`headSha` in `baseInput`. Packetless blockers continue without them.

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-report-renderer.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "blocked diagnostic|visual threshold"
pnpm exec vitest run tests/integration/publisher-service.test.ts -t "blocked|binding"
```

- [ ] **Step 7: Commit**

```bash
git add src/pr-report/pr-report-model.ts src/application/workflow-service.ts src/application/publisher-service.ts tests/unit/workflow-report-renderer.test.ts tests/integration/workflow-service.test.ts tests/integration/publisher-service.test.ts
git commit -m "fix: bind blocked publication to canonical visual evidence"
```

---

## Task 2: Render Equal-Size Baseline and Current Images Per Screen

**Files:**

- Modify: `src/application/publisher-service.ts`
- Modify: `tests/integration/publisher-service.test.ts`

- [ ] **Step 1: Add stale-selection and layout RED tests**

Construct a Run with:

- canonical report JSON pointing to failed visual report A;
- a newer visual report B from another packet;
- intake preview policy `{ includeDiff: false }`;
- baseline, current, diff, and overlay artifacts for A.

Assert:

```ts
expect(uploaded.map(({ artifactId }) => artifactId)).toEqual([
  reportA.baselineArtifactId,
  reportA.actualArtifactId,
  reportA.diffArtifactId,
  reportA.overlayArtifactId,
]);
expect(body).toContain('width="320"');
expect(body.match(/width="320"/g)).toHaveLength(2);
expect(body).toContain("검토 일치율");
expect(body).toContain("불일치율");
expect(body).toContain("Diff");
expect(body).toContain("Overlay");
expect(body).not.toContain(reportBArtifactUrl);
```

Add a two-target fixture and assert each target starts a separate preview block rather than sharing a wide multi-screen table.

- [ ] **Step 2: Run the layout tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/integration/publisher-service.test.ts -t "visual preview|blocked visual"
```

Expected RED: current code selects a latest report, creates a seven-column table, omits overlay, and allows diff suppression.

- [ ] **Step 3: Build the packet-bound publication target view**

Replace lossy latest-report selection with:

```ts
type PublicationVisualTarget = {
  attempt: number;
  targetId: string;
  name: string;
  route: string;
  state: string;
  fixture: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  status: "passed" | "failed";
  metrics: {
    reviewMatchRatio: number;
    exactMatchRatio: number;
    maskedAreaRatio: number;
    threshold: number;
  };
  baselineArtifactId: string;
  actualArtifactId: string;
  diffArtifactId?: string;
  overlayArtifactId?: string;
};
```

Parse it only from `binding.visualReportArtifact`. Carry publication intent into collection. For a failed blocked report, bypass intake preview filtering and require every existing baseline/current/diff plus overlay.

- [ ] **Step 4: Render one compact block per screen**

Replace the seven-column table with this structure:

```md
#### 매장 상세 · CINEMA 4K 사용 가능

| 경로 | 상태 | Fixture | 화면 | DPR | 시도 | 검토 일치율 | 불일치율 | 픽셀 일치율 | 마스킹 | 기준 | 결과 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| /shop/stores/123 | available | cinema4k-on | 360×1831 | 1 | 3 | 91.20% | 8.80% | 84.00% | 0.00% | 92.00% | 실패 |

| Figma 기준 | 현재 브라우저 |
| --- | --- |
| <img src="https://gitlab.example/uploads/abc/figma.png" alt="Figma 기준" width="320" /> | <img src="https://gitlab.example/uploads/abc/current.png" alt="현재 브라우저" width="320" /> |

진단: [Diff](https://gitlab.example/uploads/abc/diff.png) · [Overlay](https://gitlab.example/uploads/abc/overlay.png)
```

Calculate mismatch as `1 - reviewMatchRatio`. Use the same explicit `width="320"` for baseline and current. Render diff/overlay below the pair as diagnostic links or previews, never as a third peer column. Keep non-embeddable assets as named links to avoid broken images.

- [ ] **Step 5: Restrict raw fallback per asset role**

GitLab raw fallback may still be considered for immutable committed baseline/current source evidence after digest/head verification. It is never available for `diff` or `overlay`. If either required generated asset is not synchronized, keep publish status blocked/partial.

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/integration/publisher-service.test.ts -t "visual preview|blocked visual|raw evidence"
```

- [ ] **Step 7: Commit**

```bash
git add src/application/publisher-service.ts tests/integration/publisher-service.test.ts
git commit -m "feat: render two-column blocked visual evidence"
```

---

## Task 3: Persist Digest-Bound Upload Receipts and Retry Only Missing Assets

**Files:**

- Create: `src/publisher/asset-upload-receipt.ts`
- Modify: `src/publisher/publisher-port.ts`
- Modify: `src/publisher/publish-contracts.ts`
- Modify: `src/publisher/github-publisher.ts`
- Modify: `src/publisher/gitlab-publisher.ts`
- Modify: `src/application/publisher-service.ts`
- Create: `tests/unit/asset-upload-receipt.test.ts`
- Modify: `tests/unit/publish-contracts.test.ts`
- Modify: `tests/unit/github-publisher.test.ts`
- Modify: `tests/unit/gitlab-publisher.test.ts`
- Modify: `tests/integration/publisher-service.test.ts`

- [ ] **Step 1: Add receipt/retry/body-sync RED tests**

Cover:

- asset A succeeds, B returns 503, C succeeds;
- receipt artifacts are persisted for A and C;
- the next execution submits only B;
- changed B digest forces a new upload;
- HTTP 400 is permanent and not retried;
- HTTP 408/429/5xx is transient and retried at most three total attempts;
- a 2xx empty/malformed upload response is uncertain and stops;
- final body missing one confirmed URL is partial/blocked;
- the retry finds and updates the existing source/target draft instead of creating a second one;
- GitLab upload URL remains project-relative.

Example integration expectation:

```ts
expect(secondAttemptedArtifactIds).toEqual([assetB.artifactId]);
expect(host.createdRequests).toHaveLength(1);
expect(host.updatedRequests).toHaveLength(1);
expect(result.requestSynced).toBe(true);
expect(result.visualPreviewSynced).toBe(true);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/asset-upload-receipt.test.ts tests/unit/publish-contracts.test.ts tests/unit/github-publisher.test.ts tests/unit/gitlab-publisher.test.ts
pnpm exec vitest run tests/integration/publisher-service.test.ts -t "upload|partial|same draft"
```

- [ ] **Step 3: Define strict asset and receipt contracts**

Add immutable digest to the request and published asset:

```ts
export type ReviewRequestAsset = {
  artifactId: string;
  artifactDigest: `sha256:${string}`;
  targetId: string;
  role: ReviewRequestAssetRole;
  label: string;
  filename: string;
  mediaType: string;
  content: Buffer;
  evidence?: {
    projectRelativePath: string;
    digest: string;
    headSha?: string;
  };
};
```

Create `src/publisher/asset-upload-receipt.ts`:

```ts
export const ReviewAssetUploadReceiptSchema = z.object({
  schemaVersion: z.literal("review-asset-upload-v1"),
  runId: RunIdSchema,
  host: ReviewHostSchema,
  targetKey: z.string().trim().min(1),
  reportArtifactId: ArtifactIdSchema,
  reviewPacketId: ReviewPacketIdSchema.optional(),
  headSha: GitObjectIdSchema.optional(),
  artifactId: ArtifactIdSchema,
  artifactDigest: Sha256DigestSchema,
  targetId: z.string().trim().min(1),
  role: ReviewRequestAssetRoleSchema,
  url: z.string().trim().min(1),
  embeddable: z.boolean(),
  confirmedAt: IsoDateTimeSchema,
}).strict();
```

Receipt identity is the digest of host target, report, packet/head when present, artifact ID/digest, target ID, and role. Add `uploadReceiptArtifactIds` to `PublishResultSchema` and `artifactDigest` to `PublishedReviewAssetSchema`.

- [ ] **Step 4: Return settled outcomes from bounded adapter uploads**

Change the publisher port:

```ts
export type ReviewAssetPublishOutcome =
  | { status: "published"; asset: PublishedReviewAsset }
  | {
      status: "failed";
      artifactId: string;
      failure: "transient" | "permanent" | "uncertain";
      message: string;
    };

publishAssets(input: {
  target: PublishTarget;
  payload: ReviewRequestPayload;
  token: string;
  assets: ReviewRequestAsset[];
  maxConcurrency: number;
  signal?: AbortSignal;
}): Promise<ReviewAssetPublishOutcome[]>;

readBody(input: {
  target: PublishTarget;
  requestNumber: string;
  token: string;
  signal?: AbortSignal;
}): Promise<string>;
```

Both adapters must use a memory-bounded pool with `maxConcurrency = 3`. GitHub prepares its managed evidence ref once per batch, then uploads items through the pool. GitLab uploads directly through the pool. Each input yields exactly one outcome.

Classification:

```ts
export function classifyAssetUploadFailure(input: {
  status?: number;
  networkError?: boolean;
  responseMalformed?: boolean;
}): "transient" | "permanent" | "uncertain" {
  if (input.responseMalformed) return "uncertain";
  if (input.networkError) return "uncertain";
  if (input.status === 408 || input.status === 429 || (input.status ?? 0) >= 500) {
    return "transient";
  }
  return "permanent";
}
```

Do not include response bodies or credentials in failure messages.

- [ ] **Step 5: Reuse receipts and retry only transient failures**

In `PublisherService`:

1. load receipts matching the exact target/report/packet/head/artifact digest;
2. materialize their `PublishedReviewAsset` values without a host call;
3. upload only missing assets;
4. persist one receipt artifact per confirmed success in one optimistic save per batch;
5. retry only transient failed assets, for at most three total attempts;
6. stop on permanent/uncertain failures and record partial state;
7. never retry already-confirmed URLs.

Use the existing `findExisting` source/target lookup before create/update on every recovery. Preserve the same-draft behavior.

- [ ] **Step 6: Verify the body locally and from the host**

Before create/update:

```ts
function assertPublishedAssetUrlsInBody(
  body: string,
  requiredAssets: PublishedReviewAsset[],
): void {
  const missing = requiredAssets.filter((asset) => !body.includes(asset.url));
  if (missing.length > 0) {
    throw new Error("PUBLISH_ASSET_BODY_SYNC_INCOMPLETE");
  }
}
```

After create/update, call `readBody` and run the same check against the host-returned body. A mismatch produces blocked/partial `PUBLISH_PARTIAL_SYNC`, with `requestSynced: false` and `visualPreviewSynced: false`; do not claim success.

- [ ] **Step 7: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/asset-upload-receipt.test.ts tests/unit/publish-contracts.test.ts tests/unit/github-publisher.test.ts tests/unit/gitlab-publisher.test.ts
pnpm exec vitest run tests/integration/publisher-service.test.ts -t "upload|partial|same draft|body sync"
```

- [ ] **Step 8: Commit**

```bash
git add src/publisher/asset-upload-receipt.ts src/publisher/publisher-port.ts src/publisher/publish-contracts.ts src/publisher/github-publisher.ts src/publisher/gitlab-publisher.ts src/application/publisher-service.ts tests/unit/asset-upload-receipt.test.ts tests/unit/publish-contracts.test.ts tests/unit/github-publisher.test.ts tests/unit/gitlab-publisher.test.ts tests/integration/publisher-service.test.ts
git commit -m "feat: resume visual asset publication by digest"
```

---

## Task 4: Use One Exact-Host Credential Provider Contract

**Files:**

- Modify: `src/publisher/token-provider.ts`
- Modify: `src/publisher/remote-detector.ts`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `tests/unit/token-provider.test.ts`
- Modify: `tests/unit/remote-detector.test.ts`
- Modify: `tests/unit/codex-sdk-workflow-policy.test.ts`

- [ ] **Step 1: Add command-parity RED tests**

Mock no environment token and a keyring-backed custom GitLab host. Assert all three paths use exactly:

```ts
["glab", ["config", "get", "token", "--host", "gitlab.internal.example"]]
```

Add tests that:

- empty output is unavailable;
- help text is unavailable;
- a lookalike hostname is rejected;
- returned preflight/status/error data never contains the token;
- GitHub exact-host CLI remains `gh auth token --hostname <host>`.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/token-provider.test.ts tests/unit/remote-detector.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
```

Expected RED: runtime token provider is correct, while remote preflight and SDK use a different/invalid GitLab command.

- [ ] **Step 3: Align environment-first exact-host lookup**

Use this shared semantic order in runtime, workspace preflight, and SDK boundary:

```ts
function credentialCommand(
  provider: "github" | "gitlab",
  hostname: string,
): { command: string; args: string[] } {
  return provider === "github"
    ? { command: "gh", args: ["auth", "token", "--hostname", hostname] }
    : { command: "glab", args: ["config", "get", "token", "--host", hostname] };
}
```

Explicit `GITHUB_TOKEN`/`GH_TOKEN` or `GITLAB_TOKEN`/`GITLAB_PRIVATE_TOKEN` remains first. `supportedReviewHost` must return provider plus exact hostname. Preflight returns only `{available, source}` and discards token bytes immediately.

- [ ] **Step 4: Run GREEN tests and rebuild SDK**

Run:

```bash
pnpm exec vitest run tests/unit/token-provider.test.ts tests/unit/remote-detector.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
pnpm sdk:build
pnpm sdk:check-dist
```

- [ ] **Step 5: Commit**

```bash
git add src/publisher/token-provider.ts src/publisher/remote-detector.ts packages/codex-sdk/src/spec-to-pr-runner.ts packages/codex-sdk/dist tests/unit/token-provider.test.ts tests/unit/remote-detector.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
git commit -m "fix: align exact-host publisher credentials"
```

---

## Task 5: Run the Blocked Publication Regression Matrix

**Files:**

- Modify only if failures expose missing cases: `tests/integration/publisher-service.test.ts`
- Regenerate: `packages/codex-sdk/dist/**`
- Regenerate: `dist/mcp/**`

- [ ] **Step 1: Run host and report suites**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-report-renderer.test.ts tests/unit/publish-contracts.test.ts tests/unit/asset-upload-receipt.test.ts tests/unit/github-publisher.test.ts tests/unit/gitlab-publisher.test.ts tests/unit/token-provider.test.ts tests/unit/remote-detector.test.ts tests/integration/publisher-service.test.ts tests/integration/workflow-service.test.ts
```

- [ ] **Step 2: Exercise the required publication matrix**

Confirm automated coverage for:

| Intent/blocker | Binding | Host | Expected |
| --- | --- | --- | --- |
| ready | packet-bound visual | GitHub | exact assets, synced draft |
| ready | packet-bound visual | GitLab | project-relative assets, synced draft |
| blocked visual | packet-bound | GitHub | same draft, blocked label, four roles |
| blocked visual | packet-bound | GitLab | same draft, blocked label, four roles |
| blocked nonvisual | packetless | both | no invented visual media |
| blocked visual | stale/crossed report | both | rejected before host mutation |
| blocked visual | partial upload | both | Run remains blocked, result partial |
| blocked visual | retry | both | only missing digest retried |

- [ ] **Step 3: Regenerate and verify bundles**

Run:

```bash
pnpm sdk:build
pnpm build
pnpm sdk:check-dist
pnpm bundle:check-dist
pnpm typecheck
```

- [ ] **Step 4: Commit final generated outputs**

```bash
git add packages/codex-sdk/dist dist/mcp tests/integration/publisher-service.test.ts
git commit -m "test: cover blocked visual publication recovery"
```
