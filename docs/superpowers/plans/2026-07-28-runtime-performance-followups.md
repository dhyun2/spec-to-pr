# Measured Runtime Reduction Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce SpecToPR wall time, repeated I/O, parsing, status payloads, image work, Git work, and invalidated reviewer work without removing any required evidence or weakening publication safety.

**Architecture:** Instrument first and compare every optimization on identical deterministic fixtures. Remove redundant work in independent slices: successful blob rereads, serial intake saves, legacy reparsing, full status projection, repeated visual normalization, repeated packet snapshots, and repeated in-operation preflight. Keep caches digest/version/fence keyed and memory bounded. Change reviewer scheduling only after enough real measurements prove that invalidation costs more than lost parallelism.

**Tech Stack:** TypeScript 5.9, Zod 4, Vitest benchmarks, SQLite, Node.js 22 worker threads, PNGJS, Git CLI, pnpm/tsup.

## Global Constraints

- Execute this plan after the visual state-machine, blocked publication, and Figma evidence plans are GREEN. Those plans already remove the redundant post-exhaustion design review, retry only missing publication assets, and reserve finalization capacity.
- Do not remove full current-packet target coverage, independent reviews after a visual pass, capture receipts, baseline isolation, fixture/design-system assertions, functional gates, publication preconditions, or body synchronization.
- Do not implement target-scoped visual probes in this plan.
- Every task begins with a same-fixture measurement and ends with the same measurement. Counter improvements are required; wall-time claims are reported only on the same machine/runtime/fixture digest.
- Instrumentation tags are low-cardinality enums or opaque digests. Never record source text, file contents, URLs with query strings, credentials, branches containing secrets, or raw command output.
- Cache keys include every input that can change semantics plus an explicit algorithm/adapter version.
- A cache miss must fall back to the current trusted path. A malformed, crossed, or stale cache entry is rejected rather than silently used.
- Bounded concurrency must preserve deterministic output order and existing byte/file/time limits.
- A wall-time p95 regression above 10% on any unaffected benchmark blocks the optimization even if its target counter improves.
- Keep each task in a separate commit and preferably a separate PR so regressions can be reverted independently.

---

## Task 1: Add Secret-Free Runtime Instrumentation and Deterministic Benchmarks

**Files:**

- Create: `src/runtime/performance-instrumentation.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/application/stage-service.ts`
- Modify: `src/application/publisher-service.ts`
- Modify: `src/artifact-registry/artifact-blob-store.ts`
- Modify: `src/store/sqlite-run-store.ts`
- Modify: `src/mcp/run-service-provider.ts`
- Modify: `src/mcp/create-server.ts`
- Create: `tests/unit/performance-instrumentation.test.ts`
- Create: `tests/performance/runtime-reduction.bench.ts`
- Create: `benchmarks/runtime/README.md`
- Create: `benchmarks/runtime/baseline-v1.json`
- Modify: `package.json`

- [ ] **Step 1: Write metric-schema and redaction RED tests**

Require:

```ts
const snapshot = recorder.snapshot({
  runId,
  fixtureDigest,
  collectedAt,
});

expect(RuntimePerformanceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
expect(JSON.stringify(snapshot)).not.toMatch(
  /token|authorization|password|https?:\/\/[^"]*[?#]|\/Users\//i,
);
```

Test counter increments, nested timers, active/peak gauges, zero-cost no-op sink, low-cardinality tag rejection, and deterministic sample ordering.

- [ ] **Step 2: Define the instrumentation interface**

Create:

```ts
export const RuntimeMetricNameSchema = z.enum([
  "stage.wall_ms",
  "external_action.wall_ms",
  "artifact.read_count",
  "artifact.read_bytes",
  "artifact.write_count",
  "artifact.write_bytes",
  "artifact.hash_count",
  "run_store.get_count",
  "run_store.save_count",
  "run_store.serialized_bytes",
  "status.serialized_bytes",
  "legacy.file_read_count",
  "legacy.parse_count",
  "legacy.rebuild_count",
  "git.command_count",
  "git.binary_diff_bytes",
  "visual.decode_pixels",
  "visual.encode_pixels",
  "visual.active_workers",
  "visual.peak_workers",
  "visual.reservation_committed",
  "visual.reservation_aborted",
  "visual.reservation_stale",
  "visual.normalization_cache_hit",
  "visual.normalization_cache_miss",
  "publisher.http_count",
  "publisher.retry_count",
  "review.wall_ms",
  "review.invalidated_wall_ms",
]);

export interface RuntimeMetricsSink {
  increment(
    name: RuntimeMetricName,
    value?: number,
    tags?: RuntimeMetricTags,
  ): void;
  gauge(name: RuntimeMetricName, value: number, tags?: RuntimeMetricTags): void;
  time<T>(
    name: RuntimeMetricName,
    tags: RuntimeMetricTags,
    operation: () => Promise<T>,
  ): Promise<T>;
}
```

Allowed tags are only `stage`, `action`, `host`, `outcome`, `cache`, and `view`, each parsed from bounded enums. Implement `NoopRuntimeMetrics` and an in-memory `RuntimeMetricsRecorder`.

- [ ] **Step 3: Inject and instrument boundaries**

Add an optional metrics sink to service/store constructors and wire one recorder in `createLazyServicesProvider`. Instrument:

- `WorkflowService.start`, `advance`, `submit`, `status`, visual reservation outcomes, Git subprocess count/diff bytes;
- `StageService` transition wall time;
- `ArtifactBlobStore` reads/writes/hashes/bytes;
- `SqliteRunStore.create/get/save` and serialized Run bytes;
- legacy reads/parses/rebuilds;
- visual decode/encode pixels, cache/worker gauges after those features exist;
- publisher HTTP/retries;
- final MCP `toolResult` serialized status bytes.

Persist one `runtime-performance-v1` JSON artifact when a ready or blocked canonical report is materialized. Do not persist one artifact per metric event.

- [ ] **Step 4: Add deterministic benchmark fixtures**

Create three fixtures in `runtime-reduction.bench.ts`:

1. mixed intake: 20 local documents, four parser-safe chunks, four OpenAPI sources;
2. legacy: 250 deterministic JS/Vue files with shared adapters and 40 terminal API calls;
3. visual: two `360×1831` targets across three valid comparisons.

Use one warm-up plus five measured iterations. Emit fixture digest, Node version, platform/architecture, CPU count, metric counters, p50/p95 wall time, and peak RSS. Never compare wall times when environment or fixture digest differs.

Add:

```json
{
  "bench:runtime": "vitest bench --run tests/performance/runtime-reduction.bench.ts",
  "bench:runtime:json": "vitest bench --run tests/performance/runtime-reduction.bench.ts --outputJson benchmarks/runtime/latest.json"
}
```

- [ ] **Step 5: Record and commit the before baseline**

Run:

```bash
pnpm exec vitest run tests/unit/performance-instrumentation.test.ts
pnpm bench:runtime:json
```

Copy the sanitized current result to `benchmarks/runtime/baseline-v1.json` and document the exact command/environment digest in `benchmarks/runtime/README.md`.

Commit:

```bash
git add src/runtime/performance-instrumentation.ts src/application/workflow-service.ts src/application/stage-service.ts src/application/publisher-service.ts src/artifact-registry/artifact-blob-store.ts src/store/sqlite-run-store.ts src/mcp/run-service-provider.ts src/mcp/create-server.ts tests/unit/performance-instrumentation.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime package.json
git commit -m "perf: instrument workflow runtime"
```

---

## Task 2: Remove Successful Artifact Blob Rereads

**Files:**

- Modify: `src/artifact-registry/artifact-blob-store.ts`
- Modify: `tests/unit/artifact-blob-store.test.ts`
- Modify: `tests/performance/runtime-reduction.bench.ts`

- [ ] **Step 1: Add the fresh-write read-count RED test**

Inject a counting filesystem/metrics sink and assert:

```ts
const stored = await store.writeBlob({
  content: Buffer.alloc(1_048_576, 7),
  mediaType: "application/octet-stream",
  storedAt,
});

expect(stored.metadata.byteLength).toBe(1_048_576);
expect(metrics.value("artifact.read_bytes")).toBe(0);
expect(metrics.value("artifact.hash_count")).toBe(1);
```

Keep existing tamper, symlink, inode, metadata mismatch, truncated collision, and concurrent-write cases.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-blob-store.test.ts
```

Expected RED: `writeBlob` calls `readMetadata` and `readContent`, rereading and rehashing a successful new blob.

- [ ] **Step 3: Return atomic-create disposition**

Change the internal operation to:

```ts
type AtomicCreateDisposition = "created" | "verified-existing";

async function atomicCreateFile(
  filePath: string,
  content: Buffer,
  validateExisting?: (existing: Buffer) => void,
): Promise<AtomicCreateDisposition>;
```

For a newly linked content/metadata file, return the already-computed digest and metadata without a full read. On `EEXIST`, retain `readRegularFileNoFollow`, inode/symlink checks, byte comparison/schema validation, and digest verification. If content is existing but metadata is newly created or vice versa, validate the existing side before returning.

- [ ] **Step 4: Prove safety and counter reduction**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-blob-store.test.ts
pnpm bench:runtime:json
```

Acceptance:

- fresh write post-write read bytes: zero;
- one initial content hash;
- all existing integrity tests GREEN;
- no unaffected benchmark p95 regression above 10%.

- [ ] **Step 5: Commit**

```bash
git add src/artifact-registry/artifact-blob-store.ts tests/unit/artifact-blob-store.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime/latest.json
git commit -m "perf: avoid successful blob rereads"
```

---

## Task 3: Batch Composable Intake and Classify APIs from the Operation Inventory

**Files:**

- Modify: `src/application/intake-request-service.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/source-ingestion/source-loader.ts`
- Modify: `src/source-ingestion/openapi-inventory.ts`
- Modify: `tests/integration/intake-request-service.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/unit/source-ingestion.test.ts`
- Modify: `tests/unit/openapi-inventory.test.ts`
- Modify: `tests/performance/runtime-reduction.bench.ts`

- [ ] **Step 1: Add ordering, limit, and save-count RED tests**

For 20 sources/four chunks, assert:

- result order matches declared source/chunk order;
- at most four reads/extractions/fetches are active;
- every 1 MB, symlink, cross-role, redirect, timeout, and parser-safe grapheme limit remains enforced;
- the Run is saved once for the user request and at most once per bounded source batch, not once per chunk;
- classification input contains compact operations, not full OpenAPI bodies.

Example:

```ts
expect(metrics.value("run_store.save_count", { action: "intake-source-batch" }))
  .toBeLessThanOrEqual(2);
expect(maxActiveSourceLoads).toBeLessThanOrEqual(4);
expect(classificationText).toContain("GET /shops/{shopId}");
expect(classificationText).not.toContain(openApiDescription.repeat(500));
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/integration/intake-request-service.test.ts tests/unit/source-ingestion.test.ts tests/unit/openapi-inventory.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "composes|parser-safe|OpenAPI operation|HTTPS OpenAPI|symlink aliases|cross-role"
```

- [ ] **Step 3: Load independent sources with bounded concurrency**

Add a shared ordered pool with `maxConcurrency = 4`. Resolve and claim project paths first so duplicate/cross-role errors remain deterministic, then read/extract claimed files through the pool. Fetch independent OpenAPI URLs through the same bound, preserving each URL’s current redirect, byte, and deadline limits.

`PreparedComposableSources` retains canonical raw bytes/digest/text/chunks so later stages never reread the file merely to hash or ingest it.

- [ ] **Step 4: Add one optimistic batch parse/save**

Add:

```ts
export const ParseIntakeRequestsInputSchema = z.object({
  runId: RunIdSchema,
  requests: z.array(
    ParseIntakeRequestInputSchema.omit({ runId: true }),
  ).min(1).max(200),
}).strict();

public async parseIntakeRequests(
  rawInput: unknown,
): Promise<ParseIntakeRequestResult[]>;
```

Prepare canonical sources, snapshots, evidence, inline OpenAPI sources, and parsed artifacts in input order. Write independent blobs/snapshots with concurrency four, then append all refs in one optimistic Run save. On revision conflict, reload and recompute duplicate-source decisions; never append duplicates or reorder results.

Make `parseIntakeRequest` call the batch method with one request.

- [ ] **Step 5: Replace full OpenAPI classification text**

Add:

```ts
export function openApiClassificationSummary(
  operations: OpenApiOperationInventoryEntry[],
): string {
  return operations
    .map(({ method, path, operationId, sourceLocator }) =>
      JSON.stringify({ method, path, operationId, sourceLocator }),
    )
    .join("\n");
}
```

Build scope classification from request/brief/docs plus this bounded canonical inventory summary. Do not concatenate complete OpenAPI JSON/YAML documents.

- [ ] **Step 6: Run GREEN tests and benchmark**

Run:

```bash
pnpm exec vitest run tests/integration/intake-request-service.test.ts tests/unit/source-ingestion.test.ts tests/unit/openapi-inventory.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "composes|parser-safe|OpenAPI operation|HTTPS OpenAPI|symlink aliases|cross-role"
pnpm bench:runtime:json
```

Acceptance: concurrency never exceeds four, semantic outputs/digests are unchanged, and intake Run saves decrease from O(chunks) to at most two bounded batch saves in the benchmark.

- [ ] **Step 7: Commit**

```bash
git add src/application/intake-request-service.ts src/application/workflow-service.ts src/source-ingestion/source-loader.ts src/source-ingestion/openapi-inventory.ts tests/integration/intake-request-service.test.ts tests/integration/workflow-service.test.ts tests/unit/source-ingestion.test.ts tests/unit/openapi-inventory.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime/latest.json
git commit -m "perf: batch composable intake"
```

---

## Task 4: Reuse Legacy Bytes and ASTs Behind an Immutable Manifest

**Files:**

- Create: `src/legacy/legacy-source-cache.ts`
- Modify: `src/legacy/legacy-source-graph.ts`
- Modify: `src/legacy/legacy-parser.ts`
- Modify: `src/legacy/legacy-api-discovery.ts`
- Modify: `src/legacy/legacy-inventory.ts`
- Create: `tests/unit/legacy-source-cache.test.ts`
- Modify: `tests/unit/legacy-source-graph.test.ts`
- Modify: `tests/unit/legacy-api-discovery.test.ts`
- Modify: `tests/unit/legacy-inventory.test.ts`
- Modify: `tests/performance/runtime-reduction.bench.ts`

- [ ] **Step 1: Add read/parse/rebuild RED tests**

For the deterministic 250-file fixture:

- cold build reads each included real file at most once and parses each code file at most once;
- unchanged freshness reads/hashes the manifest but performs zero AST parses and zero semantic rebuilds;
- changing one byte invalidates the manifest and rebuilds;
- symlink/hard-link/path aliases remain rejected or deduplicated according to current policy;
- v1/v2 compatibility digests remain accepted only through their current explicit path.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/legacy-source-cache.test.ts tests/unit/legacy-source-graph.test.ts tests/unit/legacy-api-discovery.test.ts tests/unit/legacy-inventory.test.ts
```

- [ ] **Step 3: Define the immutable manifest and shared cache**

Create:

```ts
export const LegacySourceManifestSchema = z.object({
  schemaVersion: z.literal("legacy-source-manifest-v1"),
  algorithmVersion: z.literal("legacy-source-digest-v3"),
  files: z.array(z.object({
    realPathKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    applicationRelativePath: z.string().trim().min(1),
    digest: Sha256DigestSchema,
    byteLength: z.number().int().nonnegative(),
  }).strict()),
  environmentDigest: Sha256DigestSchema,
  configDigest: Sha256DigestSchema,
  manifestDigest: Sha256DigestSchema,
}).strict();
```

Hash real paths before persistence so local absolute paths are not exposed. Environment/config digests cover only the bounded variables/config files already used by legacy resolution, never raw secret values.

Implement an in-build cache keyed by `realPath + "\0" + digest` with bytes, UTF-8 text, and lazily parsed AST.

- [ ] **Step 4: Feed one cache through graph, feature, and API discovery**

`discoverLegacySourceGraph`, module/environment reference discovery, feature discovery, and `discoverLegacyApiCandidates` must consume the shared cached record. Remove second `collectSourceFiles`/`readFile` loops from `buildLegacyInventory`; use graph/cache content.

Store the manifest digest with the inventory. `assertLegacyInventoryFresh` computes the current manifest once:

- equal digest returns the pinned semantic inventory without parsing/rebuilding;
- unequal digest performs a full trusted rebuild and reports source change;
- compatibility inventory versions keep their existing dedicated digest algorithms.

- [ ] **Step 5: Run GREEN tests and benchmark cold/warm/change**

Run:

```bash
pnpm exec vitest run tests/unit/legacy-source-cache.test.ts tests/unit/legacy-source-graph.test.ts tests/unit/legacy-api-discovery.test.ts tests/unit/legacy-inventory.test.ts
pnpm bench:runtime:json
```

Acceptance: cold reads/parses are at most once per file; unchanged warm parse/rebuild counts are zero; a one-file mutation is detected.

- [ ] **Step 6: Commit**

```bash
git add src/legacy/legacy-source-cache.ts src/legacy/legacy-source-graph.ts src/legacy/legacy-parser.ts src/legacy/legacy-api-discovery.ts src/legacy/legacy-inventory.ts tests/unit/legacy-source-cache.test.ts tests/unit/legacy-source-graph.test.ts tests/unit/legacy-api-discovery.test.ts tests/unit/legacy-inventory.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime/latest.json
git commit -m "perf: cache legacy source parsing by digest"
```

---

## Task 5: Add Action, Checkpoint, and Detail Status Views

**Files:**

- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/mcp/create-server.ts`
- Modify: `packages/codex-sdk/src/boundary-runner.ts`
- Modify: `tests/unit/workflow-contracts.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/integration/mcp-stdio.test.ts`
- Modify: `tests/unit/codex-sdk-budget.test.ts`
- Modify: `tests/performance/runtime-reduction.bench.ts`

- [ ] **Step 1: Add projection and zero-read RED tests**

Assert:

- `view: "action"` returns next actions/blockers/publication/delegation/workload and no full legacy inventory;
- `view: "checkpoint"` adds bounded resume evidence/submissions and stage checkpoints;
- `view: "detail"` preserves the current full profile/inventory response;
- action/checkpoint perform zero inventory blob reads;
- action serialized bytes are at most 25% of detail for the 250-file fixture;
- SDK continuation asks for action, checkpoint prompt asks for checkpoint, reviewer preparation asks for detail.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-contracts.test.ts tests/integration/mcp-stdio.test.ts tests/unit/codex-sdk-budget.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "status|legacy inventory"
```

- [ ] **Step 3: Define discriminated status projections**

Add:

```ts
export const WorkflowStatusViewSchema = z.enum([
  "action",
  "checkpoint",
  "detail",
]);

export const WorkflowStatusInputSchema = z.object({
  runId: RunIdSchema,
  view: WorkflowStatusViewSchema.default("action"),
}).strict();
```

Define `WorkflowActionStatusSchema`, `WorkflowCheckpointStatusSchema`, and `WorkflowDetailStatusSchema` as a discriminated union on `view`.

Action view includes:

- Run/revision/status/current stage;
- publication/recommended skills summary;
- workspace binding needed for the next action;
- workload/delegation/required validations;
- compact stages, next actions, blockers/details, diagnostic publication.

Checkpoint adds bounded goal, evidence handles, last 16 submissions, and checkpoint names. Detail preserves current scope/full delivery profile/inventory.

- [ ] **Step 4: Project before expensive reads**

Split `WorkflowService.status` into pure common/action/checkpoint/detail builders. Do not call `legacyInventorySummaryForRun` or scan large evidence arrays for action/checkpoint. Update MCP input/description and SDK parsing. The boundary runner explicitly requests:

- action after each external action;
- checkpoint when creating a compact continuation;
- detail only when preparing immutable reviewer/report evidence.

- [ ] **Step 5: Run GREEN tests and benchmark**

Run:

```bash
pnpm exec vitest run tests/unit/workflow-contracts.test.ts tests/integration/mcp-stdio.test.ts tests/unit/codex-sdk-budget.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "status|legacy inventory"
pnpm bench:runtime:json
```

- [ ] **Step 6: Rebuild SDK/schema/MCP and commit**

Run:

```bash
pnpm schemas:build
pnpm sdk:build
pnpm build
```

Commit:

```bash
git add src/workflow/workflow-contracts.ts src/application/workflow-service.ts src/mcp/create-server.ts packages/codex-sdk/src/boundary-runner.ts packages/codex-sdk/dist schemas/runtime dist/mcp tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts tests/integration/mcp-stdio.test.ts tests/unit/codex-sdk-budget.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime/latest.json
git commit -m "perf: project compact workflow status"
```

---

## Task 6: Cache Normalized Visual Inputs and Use a Memory-Bounded Worker Pool

**Files:**

- Create: `src/visual/visual-normalization-cache.ts`
- Create: `src/visual/visual-comparison-pool.ts`
- Create: `src/visual/visual-comparison-worker.ts`
- Modify: `src/visual/visual-normalizer.ts`
- Modify: `src/visual/visual-comparator.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `tsup.config.ts`
- Modify: `src/release/release-verifier.ts`
- Create: `tests/unit/visual-normalization-cache.test.ts`
- Create: `tests/unit/visual-comparison-pool.test.ts`
- Modify: `tests/unit/visual-normalizer.test.ts`
- Modify: `tests/unit/visual-comparator.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/unit/release-verifier.test.ts`
- Modify: `tests/performance/runtime-reduction.bench.ts`

- [ ] **Step 1: Add cache-key, eviction, and pool RED tests**

Require cache invalidation for changes to:

- source digest;
- normalizer version;
- source/logical width or height;
- color space;
- alpha/pixel/mask/normalization options.

Require LRU byte eviction, no mutation of cached buffers, deterministic target output order, max three workers, and at most 8,000,000 active pixels.

Add an integration test proving baseline normalization hits on attempts 2 and 3 while every current-packet actual remains fresh and every target is still compared.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/visual-normalization-cache.test.ts tests/unit/visual-comparison-pool.test.ts tests/unit/visual-normalizer.test.ts tests/unit/visual-comparator.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual|Figma manifests|scaled Figma"
```

- [ ] **Step 3: Implement the versioned 128 MiB LRU**

Define:

```ts
export const VISUAL_NORMALIZATION_CACHE_VERSION =
  "visual-normalization-cache-v1";

export type VisualNormalizationCacheKey = {
  sourceDigest: `sha256:${string}`;
  normalizerVersion: string;
  sourceSize: { width: number; height: number };
  logicalSize: { width: number; height: number };
  colorSpace: "srgb";
  options: {
    alphaMode: "premultiplied";
    interpolation: "nearest";
  };
};
```

Cache normalized PNG plus decoded RGBA and charge `png.byteLength + rgba.byteLength` against a 128 MiB LRU. Return defensive read-only copies/owned buffers. A malformed entry is evicted and recomputed.

- [ ] **Step 4: Add a true CPU worker pool**

Use Node worker threads because PNG decode/compare/encode loops are CPU-bound. Configure:

- maximum three workers;
- an 8,000,000-active-pixel semaphore;
- one job per target;
- worker crash/timeout returns a normal comparison failure before report commit, so the reservation aborts and consumes no attempt;
- parent process writes artifacts and sorts results by original target order.

Add `mcp/visual-comparison-worker` to `tsup.config.ts`, resolve it with `new URL`, and update release module allowlists/tests.

- [ ] **Step 5: Preserve acquisition and evidence boundaries**

Acquisition, receipt, fixture, baseline isolation, and UI assertion validation stays in the parent before reservation. The worker receives only validated bytes/options and returns computed metrics/diff/overlay. Full target coverage is unchanged.

- [ ] **Step 6: Run GREEN tests and cold/warm benchmark**

Run:

```bash
pnpm exec vitest run tests/unit/visual-normalization-cache.test.ts tests/unit/visual-comparison-pool.test.ts tests/unit/visual-normalizer.test.ts tests/unit/visual-comparator.test.ts tests/unit/release-verifier.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "visual|Figma manifests|scaled Figma"
pnpm bench:runtime:json
```

Acceptance:

- attempts 2/3 hit every unchanged baseline;
- key drift always misses;
- active pixel/worker bounds hold;
- peak RSS stays within the configured cache/pixel budgets;
- all reports remain deterministic and complete.

- [ ] **Step 7: Commit**

```bash
git add src/visual/visual-normalization-cache.ts src/visual/visual-comparison-pool.ts src/visual/visual-comparison-worker.ts src/visual/visual-normalizer.ts src/visual/visual-comparator.ts src/application/workflow-service.ts tsup.config.ts src/release/release-verifier.ts tests/unit/visual-normalization-cache.test.ts tests/unit/visual-comparison-pool.test.ts tests/unit/visual-normalizer.test.ts tests/unit/visual-comparator.test.ts tests/integration/workflow-service.test.ts tests/unit/release-verifier.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime/latest.json
git commit -m "perf: cache and parallelize visual comparison"
```

---

## Task 7: Reuse Packet-Bound Git, Test, and Publication Preflight Evidence

**Files:**

- Create: `src/workflow/implementation-snapshot.ts`
- Create: `src/workflow/packet-evidence-index.ts`
- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/application/publisher-service.ts`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Create: `tests/unit/implementation-snapshot.test.ts`
- Create: `tests/unit/packet-evidence-index.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/integration/publisher-service.test.ts`
- Modify: `tests/unit/codex-sdk-workflow-policy.test.ts`
- Modify: `tests/unit/codex-sdk-budget.test.ts`
- Modify: `tests/unit/remote-detector.test.ts`
- Modify: `tests/performance/runtime-reduction.bench.ts`

- [ ] **Step 1: Add stale-fence and command-count RED tests**

Cover:

- two reviewers/report on one clean packet invoke the expensive binary diff capture once;
- source/head/status change invalidates snapshot reuse;
- a repair/new packet never reuses prior test evidence;
- same packet/head/diff/command/selector/result/adapter may reuse evidence;
- public SDK preflight is advisory and cannot authorize a later mutation;
- one `PublisherService.publish` execution resolves Git/remote/credential state once;
- a changed Run/report/packet/head/branch/remote invalidates a publication fence.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/implementation-snapshot.test.ts tests/unit/packet-evidence-index.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "changed files|stale packet|review"
pnpm exec vitest run tests/unit/codex-sdk-workflow-policy.test.ts tests/unit/codex-sdk-budget.test.ts tests/unit/remote-detector.test.ts tests/integration/publisher-service.test.ts
```

- [ ] **Step 3: Persist one immutable implementation snapshot per packet**

Define:

```ts
export const ImplementationSnapshotSchema = z.object({
  schemaVersion: z.literal("implementation-snapshot-v1"),
  repositoryKey: Sha256DigestSchema,
  baseSha: GitObjectIdSchema,
  headSha: GitObjectIdSchema,
  sourceBranch: z.string().trim().min(1),
  clean: z.literal(true),
  changedFiles: z.array(RelativePathSchema),
  diffDigest: Sha256DigestSchema,
  binaryDiffBytes: z.number().int().nonnegative(),
  capturedAt: IsoDateTimeSchema,
}).strict();
```

Bind snapshot artifact ID/digest to `ImplementationReviewPacketSchema`. On reuse, run only HEAD, branch, and clean-status checks. If any differs, run the full snapshot path and reject the old packet. Dirty compatibility mode never uses the shortcut.

- [ ] **Step 4: Index executable evidence by immutable packet**

Define:

```ts
export const PacketEvidenceEntrySchema = z.object({
  command: z.string().trim().min(1),
  selector: z.string().trim().min(1).optional(),
  resultDigest: Sha256DigestSchema,
  artifactId: ArtifactIdSchema,
  headSha: GitObjectIdSchema,
  diffDigest: Sha256DigestSchema,
  adapterVersion: z.string().trim().min(1),
}).strict();
```

Build the index when implementation evidence is accepted. Reviewer/report action envelopes reference matching entries instead of asking the agent to rerun already-passed evidence. Any binding mismatch requires fresh evidence.

- [ ] **Step 5: Reuse preflight only inside one fenced publish call**

Add a private:

```ts
type PublicationExecutionFence = {
  runRevision: number;
  reportArtifactId: string;
  reportDigest: string;
  reviewPacketId?: string;
  headSha?: string;
  sourceBranch: string;
  targetBranch: string;
  remoteName: string;
  remoteTargetKey: string;
  credentialSource: "env" | "cli";
  cleanStatusDigest: `sha256:${string}`;
};
```

`PublisherService.publish` constructs this once after all read-only checks and passes it through branch push, asset preparation, and create/update. It is never serialized publicly or reused across calls. SDK preflight remains an advisory early-exit optimization; runtime still creates its own authoritative fence.

- [ ] **Step 6: Run GREEN tests and benchmark**

Run:

```bash
pnpm exec vitest run tests/unit/implementation-snapshot.test.ts tests/unit/packet-evidence-index.test.ts
pnpm exec vitest run tests/integration/workflow-service.test.ts -t "changed files|stale packet|review"
pnpm exec vitest run tests/unit/codex-sdk-workflow-policy.test.ts tests/unit/codex-sdk-budget.test.ts tests/unit/remote-detector.test.ts tests/integration/publisher-service.test.ts
pnpm bench:runtime:json
```

- [ ] **Step 7: Commit**

```bash
git add src/workflow/implementation-snapshot.ts src/workflow/packet-evidence-index.ts src/workflow/workflow-contracts.ts src/application/workflow-service.ts src/application/publisher-service.ts packages/codex-sdk/src/spec-to-pr-runner.ts packages/codex-sdk/dist tests/unit/implementation-snapshot.test.ts tests/unit/packet-evidence-index.test.ts tests/integration/workflow-service.test.ts tests/integration/publisher-service.test.ts tests/unit/codex-sdk-workflow-policy.test.ts tests/unit/codex-sdk-budget.test.ts tests/unit/remote-detector.test.ts tests/performance/runtime-reduction.bench.ts benchmarks/runtime/latest.json
git commit -m "perf: reuse fenced packet evidence"
```

---

## Task 8: Measure Reviewer Invalidation Before Changing Scheduling

**Files:**

- Modify: `src/workflow/delivery-policy.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `packages/codex-sdk/src/workflow-policy.ts`
- Create: `benchmarks/runtime/reviewer-scheduling-decision.json`
- Modify: `tests/unit/delivery-policy.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/unit/codex-sdk-workflow-policy.test.ts`

- [ ] **Step 1: Collect the minimum decision sample**

Using the instrumentation from Task 1, collect at least 30 UI packets that reached a numeric visual result. Record only aggregates:

- first-attempt visual failure rate;
- reviewer wall time started before visual stability;
- reviewer wall time invalidated by visual repair;
- wall time from visual pass to both reviews complete;
- workload size distribution.

Write the sanitized aggregate and fixture/environment digests to `reviewer-scheduling-decision.json`.

- [ ] **Step 2: Apply the deterministic decision rule**

Calculate:

```ts
const invalidationRatio =
  invalidatedReviewerWallMs / Math.max(1, totalReviewerWallMs);
```

- If sample size is at least 30 and `invalidationRatio >= 0.15`, implement stable-packet scheduling in Steps 3–5.
- Otherwise keep current parallel scheduling, commit the measurement artifact, and do not claim reviewer-scheduling speedup.

- [ ] **Step 3: Add scheduling RED tests when the gate selects the change**

Assert:

- while a required visual comparison is missing/failed but repairable, expose only compare/repair actions;
- after current-packet visual pass, expose applicable functional/design reviews with existing workload-based parallelism;
- third failure is terminal and exposes neither reviewer;
- non-UI and UI-without-visual routes retain current behavior.

- [ ] **Step 4: Gate reviewers on visual stability**

In `actionsForRun`, applicable reviews are emitted only after:

```ts
!profile.requirements.visualComparison ||
currentVisual?.metadata["visualStatus"] === "passed"
```

Keep functional/design independence and workload-based parallel execution after the gate. Update SDK action instructions so it does not start reviewers before status exposes them.

- [ ] **Step 5: Run GREEN tests**

Run:

```bash
pnpm exec vitest run tests/unit/delivery-policy.test.ts tests/integration/workflow-service.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
pnpm bench:runtime:json
```

- [ ] **Step 6: Commit the measured decision**

If scheduling changed:

```bash
git add src/workflow/delivery-policy.ts src/application/workflow-service.ts packages/codex-sdk/src/workflow-policy.ts packages/codex-sdk/dist benchmarks/runtime/reviewer-scheduling-decision.json tests/unit/delivery-policy.test.ts tests/integration/workflow-service.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
git commit -m "perf: defer reviews until visual stability"
```

If the gate retained current scheduling:

```bash
git add benchmarks/runtime/reviewer-scheduling-decision.json
git commit -m "perf: record reviewer scheduling decision"
```

---

## Task 9: Verify the Complete Runtime Reduction

**Files:**

- Update: `benchmarks/runtime/latest.json`
- Create: `benchmarks/runtime/runtime-reduction-report.md`
- Regenerate: `packages/codex-sdk/dist/**`
- Regenerate: `schemas/runtime/**`
- Regenerate: `dist/mcp/**`

- [ ] **Step 1: Run the same-fixture before/after benchmark**

Run:

```bash
pnpm bench:runtime:json
```

Create `runtime-reduction-report.md` with before/after counters and p50/p95 only where fixture/environment digests match. Report unchanged or regressed metrics truthfully.

- [ ] **Step 2: Prove the evidence surface was not reduced**

Run the full visual/Figma/publication matrices from the other plans and assert:

- same required validations;
- same all-target current-packet coverage;
- same independent reviews after pass;
- same receipt/baseline/fixture/design/UI assertions;
- same blocked publication media/body checks;
- no fourth visual attempt.

- [ ] **Step 3: Run full generation and verification**

Run:

```bash
pnpm policy:sync
pnpm guide:assets
pnpm sdk:build
pnpm check
pnpm plugin:validate:codex
pnpm case4:check
```

- [ ] **Step 4: Commit the measured report and generated outputs**

```bash
git add benchmarks/runtime packages/codex-sdk/dist schemas/runtime dist/mcp
git commit -m "docs: report measured runtime reduction"
```
