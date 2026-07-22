# Legacy Semantic Intake v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legacy delivery preserve gateway/client/call-site semantics, scope OpenAPI and HAR to the selected legacy feature, and recover opaque API intake in the same Run.

**Architecture:** Keep `legacyProjectRoot` as the feature ownership boundary, discover a bounded enclosing application context, and follow only explicit dependency edges. Replace regex API discovery with TypeScript-AST candidates, resolve candidates in a pure correlation module, and add a typed pre-intake evidence action that rebuilds the same Run atomically.

**Tech Stack:** TypeScript 5.8, TypeScript Compiler API, Zod 4, Vitest 3, tsup, pnpm 10, Node.js 22.

## Global Constraints

- The original `legacyProjectRoot: ../sandbox_new/src/modules/shop` prompt remains valid; no new required start field is introduced.
- Feature keys originate only below `legacyProjectRoot`; supporting dependencies never become unrelated routes, screens, state, or feature keys.
- Dependency traversal follows recorded import, alias, manifest, environment-reference, style/asset, and runtime edges only; repository-wide keyword fallback remains prohibited.
- Environment names and safe origin metadata are preserved, while raw secrets, cookies, authorization data, credential-bearing URLs, HAR payloads, and full `.env` contents are never persisted.
- In legacy mode, supplied OpenAPI and runtime evidence enrich correlated source candidates only; unmatched operations never expand API-ready or implementation coverage.
- Existing v2 inventory artifacts remain readable; new Runs emit v3.
- Existing seven MCP workflow tools and eight durable stages remain unchanged.
- Every production behavior change follows RED → GREEN → REFACTOR and ends in a focused commit.

## File Structure

- `src/legacy/legacy-api-contracts.ts`: v3 API provenance schemas, stable identity helpers, and v2 compatibility types.
- `src/legacy/legacy-source-graph.ts`: enclosing application discovery, alias resolution, and bounded dependency closure.
- `src/legacy/legacy-api-discovery.ts`: TypeScript-AST terminal call and call-site discovery.
- `src/legacy/legacy-api-resolution.ts`: path templates, origin identities, OpenAPI/HAR correlation, and unresolved classification.
- `src/legacy/legacy-inventory.ts`: generic feature inventory orchestration, v3 persistence, freshness, and bounded runtime evidence parsing.
- `src/source-ingestion/openapi-inventory.ts`: service-aware OpenAPI lookup rows without global method/path collision.
- `src/workflow/workflow-contracts.ts`: additive endpoint identity, legacy binding, action, submission, and status schemas.
- `src/application/workflow-service.ts`: scoped legacy profile derivation, early truncation, same-Run recovery, and migration binding gates.
- `src/workflow/delivery-policy.ts` and `src/workflow/delivery-mode-policy.ts`: operation counts derived from correlated endpoint identities.
- `packages/codex-sdk/src/spec-to-pr-runner.ts`, `skills/**`, `website/**`: host instructions and public guide updates.

---

### Task 1: Add v3 API provenance contracts and v2 compatibility

**Files:**
- Create: `src/legacy/legacy-api-contracts.ts`
- Modify: `src/legacy/legacy-inventory.ts:1-100`
- Modify: `src/workflow/workflow-contracts.ts:115-140`
- Create: `tests/unit/legacy-api-contracts.test.ts`

**Interfaces:**
- Produces: `LegacyOriginRefSchema`, `LegacyApiCallSiteSchema`, `LegacyApiCandidateSchema`, `LegacyApiResolutionSchema`, `endpointIdentity()`, `upgradeLegacyInventoryV2()`.
- Consumed by: Tasks 2-8.

- [ ] **Step 1: Write failing origin and compatibility tests**

```ts
import { describe, expect, it } from "vitest";

import {
  LegacyApiCandidateSchema,
  endpointIdentity,
  upgradeLegacyInventoryV2,
} from "../../src/legacy/legacy-api-contracts.js";

describe("legacy API contracts v3", () => {
  it("keeps identical method paths distinct across environment origins", () => {
    const first = LegacyApiCandidateSchema.parse(candidate("V1_API_URL"));
    const second = LegacyApiCandidateSchema.parse(candidate("V2_API_URL"));

    expect(first.operationKey).toBe("GET /health");
    expect(second.operationKey).toBe("GET /health");
    expect(endpointIdentity(first)).not.toBe(endpointIdentity(second));
  });

  it("upgrades a v2 inventory without inventing origin or transport evidence", () => {
    const upgraded = upgradeLegacyInventoryV2({
      version: 2,
      rootDigest: `sha256:${"a".repeat(64)}`,
      sourceDigest: `sha256:${"a".repeat(64)}`,
      visitedDirectories: 1,
      visitedEntries: 1,
      scannedFiles: 1,
      scannedBytes: 10,
      truncated: false,
      apiDiscoveryAdapters: ["source-http-client"],
      entries: [],
    });

    expect(upgraded).toMatchObject({ version: 3, apiState: "not-detected", apiCandidates: [] });
  });
});

function candidate(environmentName: string) {
  return {
    candidateKey: `candidate:${environmentName}`,
    endpointKey: `env:${environmentName}|GET /health`,
    operationKey: "GET /health",
    method: "GET",
    pathTemplate: "/health",
    originRef: { kind: "environment", runtime: "process.env", name: environmentName },
    confidence: "high",
    terminalKind: "http-client",
    callSites: [
      {
        callSiteKey: `call:${environmentName}`,
        ownerSourcePath: "api/health.ts",
        terminalSourcePath: "api/health.ts",
        line: 1,
        column: 1,
        receiver: "apiClient",
        transportRef: "ApiClient",
        wrapperChain: [],
      },
    ],
    requestEvidence: { queryKeys: [], bodySymbols: [], headerKeys: [] },
    responseEvidence: { selectors: [] },
    witnesses: [{ kind: "source", locator: "api/health.ts:1:1" }],
  };
}
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `pnpm exec vitest run tests/unit/legacy-api-contracts.test.ts`

Expected: FAIL because `src/legacy/legacy-api-contracts.ts` does not exist.

- [ ] **Step 3: Implement the v3 schemas and stable endpoint identity**

```ts
import { createHash } from "node:crypto";
import { z } from "zod";

const HttpMethodSchema = z.enum([
  "GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE", "UNKNOWN",
]);

export const LegacyOriginRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("environment"),
    runtime: z.enum(["process.env", "import.meta.env"]),
    name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    sanitizedOrigin: z.string().url().optional(),
  }).strict(),
  z.object({ kind: z.literal("literal"), sanitizedOrigin: z.string().url() }).strict(),
  z.object({
    kind: z.literal("openapi-server"),
    sourceLocator: z.string().trim().min(1),
    serverIndex: z.number().int().nonnegative(),
  }).strict(),
  z.object({ kind: z.literal("runtime-origin"), sanitizedOrigin: z.string().url() }).strict(),
]);

export const LegacyApiCallSiteSchema = z.object({
  callSiteKey: z.string().trim().min(1),
  ownerFeatureKey: z.string().regex(/^legacy_[a-f0-9]{24}$/).optional(),
  ownerSourcePath: z.string().trim().min(1),
  terminalSourcePath: z.string().trim().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  receiver: z.string().trim().min(1),
  transportRef: z.string().trim().min(1).optional(),
  branchGuard: z.string().trim().min(1).max(500).optional(),
  wrapperChain: z.array(z.string().trim().min(1)).max(32),
}).strict();

export const LegacyApiCandidateSchema = z.object({
  candidateKey: z.string().trim().min(1),
  endpointKey: z.string().trim().min(1),
  operationKey: z.string().trim().min(3),
  method: HttpMethodSchema,
  pathTemplate: z.string().startsWith("/").optional(),
  originRef: LegacyOriginRefSchema.optional(),
  confidence: z.enum(["high", "medium", "low"]),
  terminalKind: z.enum(["fetch", "http-client", "request-config", "generated-client"]),
  callSites: z.array(LegacyApiCallSiteSchema).min(1),
  requestEvidence: z.object({
    queryKeys: z.array(z.string()),
    bodySymbols: z.array(z.string()),
    headerKeys: z.array(z.string()),
  }).strict(),
  responseEvidence: z.object({ selectors: z.array(z.string()) }).strict(),
  witnesses: z.array(z.object({
    kind: z.enum(["source", "openapi", "runtime"]),
    locator: z.string().trim().min(1),
  }).strict()).min(1),
}).strict();

export type LegacyApiCandidate = z.infer<typeof LegacyApiCandidateSchema>;

export function endpointIdentity(value: Pick<LegacyApiCandidate, "endpointKey">): string {
  return value.endpointKey;
}

export function stableEndpointKey(input: {
  originRef?: z.infer<typeof LegacyOriginRefSchema>;
  method: string;
  pathTemplate?: string;
}): string {
  const origin = input.originRef === undefined ? "origin:unknown" : JSON.stringify(input.originRef);
  const operation = `${input.method} ${input.pathTemplate ?? "path:unknown"}`;
  return `endpoint_${createHash("sha256").update(origin).update("\0").update(operation).digest("hex").slice(0, 24)}`;
}
```

Add a strict inventory v3 schema with `version: 3`, `apiState`, `apiCandidates`, supporting dependencies, and a compatibility function that converts v2 metadata without inventing evidence. Add optional `endpointKey` and `serviceRef` to `OpenApiOperationContractSchema`; uniqueness uses `endpointKey ?? operationKey`.

- [ ] **Step 4: Run focused contract tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/legacy-api-contracts.test.ts tests/unit/workflow-contracts.test.ts tests/unit/legacy-inventory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the v3 contract slice**

```bash
git add src/legacy/legacy-api-contracts.ts src/legacy/legacy-inventory.ts src/workflow/workflow-contracts.ts tests/unit/legacy-api-contracts.test.ts
git commit -m "feat: add semantic legacy API contracts"
```

### Task 2: Build the bounded application context and dependency closure

**Files:**
- Create: `src/legacy/legacy-source-graph.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsup.config.ts`
- Create: `tests/unit/legacy-source-graph.test.ts`

**Interfaces:**
- Consumes: v3 source/digest types from Task 1.
- Produces: `discoverLegacySourceGraph(featureRoot, limits)` returning owned files, supporting files, edges, aliases, environment references, and `applicationRoot`.

- [ ] **Step 1: Write failing dependency-boundary tests**

```ts
it("resolves an enclosing Vue alias without discovering sibling features", async () => {
  const project = await vueFixture({
    "src/modules/shop/api.js": 'import { httpService } from "@/api/httpService"; export const api = new httpService();',
    "src/api/httpService.js": 'import axios from "axios"; export class httpService {}',
    "src/modules/booking/payment.js": 'fetch("/booking/payment")',
  });

  const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

  expect(graph.applicationRoot).toBe(project);
  expect(graph.ownedFiles.map((file) => file.sourcePath)).toContain("api.js");
  expect(graph.supportingFiles.map((file) => file.applicationRelativePath)).toContain(
    "src/api/httpService.js",
  );
  expect(JSON.stringify(graph)).not.toContain("booking/payment.js");
});

it("records referenced environment names without reading unrelated values", async () => {
  const project = await vueFixture({
    "src/modules/shop/api.js": "export const url = `${process.env.VUE_APP_API_GW_V2_URL}shop`;",
    ".env.qa": "VUE_APP_API_GW_V2_URL=https://fairway.example/v2/\nUNRELATED_SECRET=must-not-appear\n",
  });

  const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

  expect(graph.environmentRefs).toEqual([
    expect.objectContaining({ name: "VUE_APP_API_GW_V2_URL", runtime: "process.env" }),
  ]);
  expect(JSON.stringify(graph)).not.toContain("must-not-appear");
});
```

- [ ] **Step 2: Run graph tests and verify RED**

Run: `pnpm exec vitest run tests/unit/legacy-source-graph.test.ts`

Expected: FAIL because `discoverLegacySourceGraph` is missing.

- [ ] **Step 3: Add TypeScript as a bundled runtime parser**

Move `typescript` from `devDependencies` to `dependencies`, update the lockfile with `pnpm install --lockfile-only`, and add `/typescript/` to `tsup.config.ts` `noExternal` so the released MCP bundle does not depend on the host installation.

```ts
noExternal: [/@modelcontextprotocol\/sdk/, /pdfjs-dist/, /pngjs/, /typescript/, /zod/],
```

- [ ] **Step 4: Implement bounded graph discovery**

```ts
export type LegacySourceGraph = {
  featureRoot: string;
  applicationRoot: string;
  files: LegacyGraphFile[];
  ownedFiles: LegacyGraphFile[];
  supportingFiles: LegacyGraphFile[];
  edges: LegacyDependencyEdge[];
  aliases: Record<string, string>;
  environmentRefs: LegacyEnvironmentReference[];
  sourceDigest: `sha256:${string}`;
  truncated: boolean;
  truncation?: { limit: string; sourcePath: string };
};

export async function discoverLegacySourceGraph(
  featureRoot: string,
  limitOverrides: Partial<LegacyInventoryLimits> = {},
): Promise<LegacySourceGraph> {
  const canonicalFeatureRoot = await realpath(featureRoot);
  const applicationRoot = await findEnclosingApplicationRoot(canonicalFeatureRoot);
  const aliases = await loadSupportedAliases(applicationRoot);
  const ownedFiles = await collectOwnedSourceFiles(canonicalFeatureRoot, limitOverrides);
  return expandDependencyClosure({ canonicalFeatureRoot, applicationRoot, aliases, ownedFiles, limitOverrides });
}
```

Use `typescript.createSourceFile` for JS/TS and extracted Vue/Svelte script blocks. Resolve relative imports, `@` aliases from `vue.config.js` object literals, `compilerOptions.paths`, and package-local exports. Reject traversal outside the enclosing application root. Record but do not recursively scan bare external packages.

Read only the referenced key from `.env.example` and mode-specific environment files. Accept a value only when the key is URL/base/gateway/host/origin-shaped and the value sanitizes to an HTTP(S) origin without userinfo/query/fragment. Never include unrelated lines in returned objects or errors.

- [ ] **Step 5: Run graph and bundle tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/legacy-source-graph.test.ts && pnpm typecheck && pnpm build`

Expected: PASS and the bundle includes the TypeScript parser without an unresolved runtime import.

- [ ] **Step 6: Commit bounded dependency discovery**

```bash
git add package.json pnpm-lock.yaml tsup.config.ts src/legacy/legacy-source-graph.ts tests/unit/legacy-source-graph.test.ts
git commit -m "feat: trace bounded legacy dependencies"
```

### Task 3: Replace regex API discovery with semantic terminal candidates

**Files:**
- Create: `src/legacy/legacy-api-discovery.ts`
- Modify: `src/legacy/legacy-inventory.ts:390-680`
- Create: `tests/unit/legacy-api-discovery.test.ts`
- Modify: `tests/unit/legacy-inventory.test.ts`

**Interfaces:**
- Consumes: `LegacySourceGraph`, v3 API candidate schemas.
- Produces: `discoverLegacyApiCandidates(graph)` and `attachLegacyOwnerFeatureKeys(candidates, entries)`.

- [ ] **Step 1: Write failing audited-syntax tests**

```ts
it.each([
  ['const docs = `apiClient.post("/example-only")`;', 0],
  ['const value = 1; // apiClient.delete("/commented-out")', 0],
  ['import { marshall } from "@aws-sdk/util-dynamodb"; marshall({ id: 1 });', 0],
  ['fetch(new Request("/request", { method: "PUT" }));', 1],
  ['apiClient?.post("/optional");', 1],
  ['apiClient["get"]("/bracket");', 1],
  ['axios("/direct", { method: "PATCH" });', 1],
])("discovers only terminal network effects for %s", async (source, count) => {
  const graph = await graphFixture({ "src/modules/shop/api.ts": source });
  expect(discoverLegacyApiCandidates(graph)).toHaveLength(count);
});

it("does not leak a later fetch method into an earlier call", async () => {
  const graph = await graphFixture({
    "src/modules/shop/api.ts": 'fetch("/first"); fetch("/second", { method: "POST" });',
  });
  expect(discoverLegacyApiCandidates(graph).map((item) => item.operationKey)).toEqual([
    "GET /first",
    "POST /second",
  ]);
});
```

- [ ] **Step 2: Run semantic discovery tests and verify RED**

Run: `pnpm exec vitest run tests/unit/legacy-api-discovery.test.ts`

Expected: FAIL because the semantic discovery module does not exist.

- [ ] **Step 3: Implement expression and transport resolution**

```ts
export function discoverLegacyApiCandidates(graph: LegacySourceGraph): LegacyApiCandidate[] {
  const symbols = indexModulesAndExports(graph);
  const terminals = graph.files.flatMap((file) => terminalCallsInFile(file, symbols));
  return mergeTerminalCandidates(terminals.map((terminal) => candidateFromTerminal(terminal, symbols)));
}

function isGeneratedProvenance(binding: ResolvedBinding): boolean {
  return (
    binding.generatedHeader === true ||
    binding.packageMetadata?.generator === "openapi" ||
    /(?:^|[/._-])(?:generated|codegen|openapi|swagger)(?:[/._-]|$)/i.test(binding.sourcePath)
  );
}
```

Implement AST handlers for `fetch`, `new Request`, direct axios, optional/property/element access, verb calls, request config objects, statically resolved options variables, template literals, and string concatenation. Follow local imports and wrapper functions until a terminal network effect. Constructors and non-terminal local facade calls create call-graph edges only.

Preserve receiver, constructor class, wrapper chain, line/column, branch guard text, query keys, body symbols, header keys, and response selectors. Merge candidates by endpoint identity while appending every distinct call site and witness.

- [ ] **Step 4: Add the real Shop provenance regression fixture**

```ts
expect(result.map((item) => item.operationKey).sort()).toEqual([
  "DELETE /shop/{rgnNo}/favorite",
  "GET /shop/glf",
  "GET /shop/ranking",
  "GET /shop/ranking/mine",
  "GET /shop/{rgnNo}",
  "GET /shop/{rgnNo}/notices",
  "GET /v1/franchise-reservation/shops/image/{rgnNo}",
  "PATCH /shop/{rgnNo}/favorite",
].sort());
expect(new Set(result.map((item) => originName(item.originRef)))).toEqual(
  new Set(["VUE_APP_API_GW_V1_URL", "VUE_APP_API_GW_V2_URL", "VUE_APP_API_GW_LOUNGE_API"]),
);
expect(new Set(result.flatMap((item) => item.callSites.map((site) => site.transportRef)))).toEqual(
  new Set(["httpService", "defaultHttpService"]),
);
expect(result.find((item) => item.operationKey === "GET /shop/{rgnNo}")?.callSites).toHaveLength(2);
```

- [ ] **Step 5: Run discovery and inventory tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/legacy-api-discovery.test.ts tests/unit/legacy-inventory.test.ts`

Expected: PASS. Existing generic feature inventory tests remain unchanged; old regex API adapters are removed from the production path.

- [ ] **Step 6: Commit semantic discovery**

```bash
git add src/legacy/legacy-api-discovery.ts src/legacy/legacy-inventory.ts tests/unit/legacy-api-discovery.test.ts tests/unit/legacy-inventory.test.ts
git commit -m "feat: discover semantic legacy API calls"
```

### Task 4: Add structural path and service-aware API resolution

**Files:**
- Create: `src/legacy/legacy-api-resolution.ts`
- Modify: `src/source-ingestion/openapi-inventory.ts`
- Create: `tests/unit/legacy-api-resolution.test.ts`
- Modify: `tests/unit/openapi-inventory.test.ts`

**Interfaces:**
- Consumes: semantic candidates, OpenAPI lookup operations, normalized runtime requests.
- Produces: `resolveLegacyApiCandidates(input)` with `operations`, `correlations`, and `unresolved`.

- [ ] **Step 1: Write failing template, service, and noise-correlation tests**

```ts
it("folds parameter-name variants and concrete runtime paths", () => {
  const result = resolveLegacyApiCandidates({
    candidates: [candidate("UNKNOWN", "/shop/{rgnNo}")],
    openApi: [operation("POST", "/shop/{regionId}", "shop-v2")],
    runtime: [request("POST", "https://fairway.example/shop/123")],
  });
  expect(result.unresolved).toEqual([]);
  expect(result.operations).toEqual([
    expect.objectContaining({ operationKey: "POST /shop/{regionId}", serviceRef: "shop-v2" }),
  ]);
});

it("keeps identical method paths distinct across OpenAPI services", () => {
  const operations = inventoryOpenApiOperations([
    openApiFile("v1.yaml", "https://v1.example", "/health"),
    openApiFile("v2.yaml", "https://v2.example", "/health"),
  ]);
  expect(operations).toHaveLength(2);
  expect(new Set(operations.map((item) => item.endpointKey)).size).toBe(2);
});

it("does not promote unrelated HAR rows", () => {
  const result = resolveLegacyApiCandidates({
    candidates: [candidate("GET", "/shop/{id}")],
    openApi: [],
    runtime: [
      request("GET", "https://legacy.example/shop/1"),
      request("GET", "https://analytics.example/collect"),
      request("GET", "https://legacy.example/logo.png"),
    ],
  });
  expect(result.operations).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/collect|logo\.png/);
});
```

- [ ] **Step 2: Run resolver tests and verify RED**

Run: `pnpm exec vitest run tests/unit/legacy-api-resolution.test.ts tests/unit/openapi-inventory.test.ts`

Expected: FAIL on exact-string matching and duplicate OpenAPI operation rejection.

- [ ] **Step 3: Implement structural matching and scoped correlation**

```ts
export function compatiblePathTemplate(template: string, candidate: string): boolean {
  const left = splitPath(template);
  const right = splitPath(candidate);
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const other = right[index]!;
    return isParameter(segment) || isParameter(other) || segment === other;
  });
}

export function resolveLegacyApiCandidates(input: {
  candidates: LegacyApiCandidate[];
  openApi: OpenApiInventoryOperation[];
  runtime: LegacyRuntimeRequest[];
}): LegacyApiResolution {
  const resolutions = input.candidates.map((candidate) =>
    resolveOneCandidate(candidate, input.openApi, input.runtime),
  );
  return collectUniqueResolutions(resolutions);
}
```

Canonical precedence is unique structurally compatible OpenAPI, then concrete source method/path, then unique runtime corroboration. Runtime rows are witnesses only and never standalone scope. Parameter names are ignored for compatibility, while case, segment count, trailing slash, and encoded separators remain strict.

Update OpenAPI inventory to retain a `serviceRef` derived from source locator plus `servers[index]`, and an `endpointKey` derived from service, method, and path. Duplicate validation uses endpoint identity; two identical rows from the same service remain an error.

- [ ] **Step 4: Run resolver tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/legacy-api-resolution.test.ts tests/unit/openapi-inventory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit structural resolution**

```bash
git add src/legacy/legacy-api-resolution.ts src/source-ingestion/openapi-inventory.ts tests/unit/legacy-api-resolution.test.ts tests/unit/openapi-inventory.test.ts
git commit -m "feat: correlate scoped legacy API evidence"
```

### Task 5: Integrate v3 inventory and scoped API profiles at workflow start

**Files:**
- Modify: `src/application/workflow-service.ts:475-670`
- Modify: `src/application/workflow-service.ts:5156-5273`
- Modify: `src/workflow/delivery-policy.ts`
- Modify: `src/workflow/delivery-mode-policy.ts`
- Modify: `tests/integration/workflow-service.test.ts:2870-3240`

**Interfaces:**
- Consumes: graph, semantic discovery, resolution.
- Produces: intake-pinned v3 inventory and legacy-only correlated `deliveryProfile.openApiOperations`.

- [ ] **Step 1: Write failing workflow scope tests**

```ts
it("pins only source-correlated operations from a service-wide legacy OpenAPI", async () => {
  await writeLegacyShopFixture(legacyRoot);
  await writeOpenApiWithOperations(directory, 100, ["GET /shop/{rgnNo}"]);

  const started = await service.start({
    projectRoot: directory,
    legacyProjectRoot: path.join(legacyRoot, "src/modules/shop"),
    requestText: "Migrate the complete Shop module",
    mode: "legacy",
    openApiPaths: ["docs/shop.yaml"],
  });

  expect(started.status).not.toBe("blocked");
  expect(started.deliveryProfile.openApiOperations.map((item) => item.operationKey)).toHaveLength(8);
});

it("blocks truncated inventory during intake with the exact limit", async () => {
  await writeOversizedLegacyFixture(legacyRoot);
  const started = await service.start(legacyInput(legacyRoot));
  expect(started).toMatchObject({ currentStage: "intake", status: "blocked" });
  expect(started.blockerDetails[0]).toMatchObject({ code: "LEGACY_INVENTORY_TRUNCATED" });
});
```

- [ ] **Step 2: Run focused workflow tests and verify RED**

Run: `pnpm exec vitest run tests/integration/workflow-service.test.ts -t "source-correlated|truncated inventory"`

Expected: FAIL because the current start merges all OpenAPI operations and defers truncation.

- [ ] **Step 3: Replace start-time derivation with v3 resolution**

```ts
const legacyResolution =
  legacyInventoryResult === undefined
    ? emptyLegacyApiResolution()
    : resolveLegacyApiCandidates({
        candidates: legacyInventoryResult.inventory.apiCandidates,
        openApi: sourceOpenApiOperations,
        runtime: legacyInventoryResult.runtimeRequests,
      });

const openApiOperations =
  effectiveMode === "legacy"
    ? deliveryOperationsFromLegacyResolution(legacyResolution)
    : sourceOpenApiOperations;
```

If `inventory.truncated`, block intake immediately with `LEGACY_INVENTORY_TRUNCATED` and include sanitized limit metadata. Build legacy API requirements from correlated operations only. Preserve all OpenAPI source provenance separately.

When `apiCandidates` is empty, persist `apiState: "not-detected"`; do not silently report confirmed absence. Add `legacyApiAssessment` to passed contracts so the orchestrator must submit `{status:"confirmed-none", inventoryDigest, rationale}` when no API was detected.

- [ ] **Step 4: Run workflow and delivery policy tests and verify GREEN**

Run: `pnpm exec vitest run tests/integration/workflow-service.test.ts tests/unit/delivery-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit scoped workflow profiles**

```bash
git add src/application/workflow-service.ts src/workflow/delivery-policy.ts src/workflow/delivery-mode-policy.ts tests/integration/workflow-service.test.ts tests/unit/delivery-policy.test.ts
git commit -m "fix: scope legacy API delivery profiles"
```

### Task 6: Add same-Run network evidence recovery

**Files:**
- Modify: `src/workflow/workflow-contracts.ts:1285-1345`
- Modify: `src/application/workflow-service.ts:790-850`
- Modify: `src/application/workflow-service.ts:4052-4065`
- Modify: `src/application/workflow-service.ts:5156-5265`
- Modify: `tests/unit/workflow-contracts.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`

**Interfaces:**
- Produces: action `collect-legacy-network-evidence`, submission `legacy-network-evidence`, and `recoverLegacyIntakeWithNetworkEvidence()`.

- [ ] **Step 1: Write failing action and recovery tests**

```ts
it("requests runtime evidence and advances the same Run", async () => {
  await writeFile(path.join(legacyRoot, "api.ts"), "export const load = () => fetch(dynamicUrl);\n");
  const started = await service.start(legacyInput(legacyRoot));

  expect(started).toMatchObject({
    status: "needs-external-action",
    nextActions: [{ kind: "collect-legacy-network-evidence", runId: started.runId }],
  });
  expect(started.blockerDetails[0]).toMatchObject({ retryable: true, resumable: true });

  await writeFile(
    path.join(directory, "evidence/legacy-network.json"),
    JSON.stringify([{ method: "GET", url: "https://legacy.example/shop/123" }]),
  );
  const recovered = await service.submit({
    runId: started.runId,
    submission: {
      kind: "legacy-network-evidence",
      status: "passed",
      legacyNetworkEvidencePath: "evidence/legacy-network.json",
      capturedAt: "2026-07-22T00:00:00.000Z",
      summary: "Captured the scoped Shop state.",
    },
  });

  expect(recovered.runId).toBe(started.runId);
  expect(recovered.nextActions).toEqual([{ kind: "prepare-contracts", runId: started.runId }]);
});
```

Add a second test where incomplete evidence leaves the Run revision, gap, inventory artifacts, and provenance unchanged and keeps the collection action available.

- [ ] **Step 2: Run action/recovery tests and verify RED**

Run: `pnpm exec vitest run tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts -t "runtime evidence|same Run"`

Expected: FAIL because the schemas and action do not exist and intake rejects all submissions.

- [ ] **Step 3: Add the action and submission schemas**

```ts
export const LegacyNetworkEvidenceSubmissionSchema = z.object({
  kind: z.literal("legacy-network-evidence"),
  status: z.literal("passed"),
  legacyNetworkEvidencePath: WorkflowSourcePathSchema,
  capturedAt: z.string().datetime({ offset: true }),
  summary: z.string().trim().min(1).max(4_000),
}).strict();

z.object({
  kind: z.literal("collect-legacy-network-evidence"),
  runId: RunIdSchema,
  unresolvedCandidateKeys: z.array(z.string().trim().min(1)).min(1).max(500),
}).strict();
```

Add the submission to `WorkflowSubmissionSchema` and the action to `WorkflowActionSchema`.

- [ ] **Step 4: Implement atomic same-Run recovery**

Handle `legacy-network-evidence` before the generic `intake must pass` prerequisite. Read and validate the project-local evidence, verify source freshness, resolve in memory, and reject incomplete evidence before mutating the Run.

```ts
private async recoverLegacyIntakeWithNetworkEvidence(
  run: RunManifest,
  submission: z.infer<typeof LegacyNetworkEvidenceSubmissionSchema>,
): Promise<WorkflowStatus> {
  const prepared = await this.prepareLegacyNetworkRecovery(run, submission);
  if (prepared.resolution.unresolved.length > 0) {
    throw new Error("LEGACY_RUNTIME_EVIDENCE_INCOMPLETE: runtime evidence did not uniquely resolve every opaque terminal call");
  }
  const started = await this.dependencies.stageService.start({
    runId: run.id,
    stageName: "intake",
    workerId: WORKER_ID,
  });
  await this.commitLegacyNetworkRecovery(started.run, started.stage.lease!.id, prepared);
  return this.status({ runId: run.id });
}
```

Successful commit appends sanitized source provenance and inventory/receipt artifacts, resolves the API gap, rebuilds the delivery profile checkpoint, and completes the existing intake stage. `actionsForRun` exposes collection only for the retryable unresolved legacy blocker.

- [ ] **Step 5: Run recovery and durability tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts`

Expected: PASS, including existing blocker diagnostic and resume tests.

- [ ] **Step 6: Commit same-Run recovery**

```bash
git add src/workflow/workflow-contracts.ts src/application/workflow-service.ts tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts
git commit -m "feat: resume legacy intake with runtime evidence"
```

### Task 7: Require source-to-target origin and transport bindings

**Files:**
- Modify: `src/workflow/workflow-contracts.ts:750-930`
- Modify: `src/application/workflow-service.ts:4150-4405`
- Modify: `src/application/workflow-service.ts:2490-2590`
- Modify: `tests/unit/workflow-contracts.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/unit/workflow-report-renderer.test.ts`

**Interfaces:**
- Produces: `legacyBindings` in API-ready evidence and endpoint-aware exact coverage validation.

- [ ] **Step 1: Write failing migration binding tests**

```ts
it("rejects legacy API-ready evidence that drops an origin or transport variant", async () => {
  const started = await startShopLegacyRun();
  await passLegacyContracts(started.runId);

  await expect(
    service.submit({
      runId: started.runId,
      submission: apiReadySubmission({ legacyBindings: [] }),
    }),
  ).rejects.toThrow(/legacy endpoint bindings must exactly match/i);
});

it("accepts explicit V1 V2 LOUNGE and authenticated default mappings", async () => {
  const submission = apiReadySubmission({
    legacyBindings: shopBindings({
      origins: ["VUE_APP_API_GW_V1_URL", "VUE_APP_API_GW_V2_URL", "VUE_APP_API_GW_LOUNGE_API"],
      transports: ["httpService", "defaultHttpService"],
    }),
  });
  await expect(service.submit({ runId, submission })).resolves.toMatchObject({ runId });
});
```

- [ ] **Step 2: Run binding tests and verify RED**

Run: `pnpm exec vitest run tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts -t "origin|transport|binding"`

Expected: FAIL because `legacyBindings` is not part of the contract.

- [ ] **Step 3: Add binding schemas and endpoint-aware validation**

```ts
const LegacyApiMigrationBindingSchema = z.object({
  endpointKey: z.string().trim().min(1),
  sourceCandidateKeys: z.array(z.string().trim().min(1)).min(1).max(100),
  sourceOriginRefs: z.array(z.string().trim().min(1)).max(20).default([]),
  targetOriginRef: z.string().trim().min(1).max(500),
  sourceTransportRefs: z.array(z.string().trim().min(1)).max(20).default([]),
  targetClientSymbols: z.array(z.string().trim().min(1)).min(1).max(50),
  sourceCallSiteKeys: z.array(z.string().trim().min(1)).min(1).max(100),
}).strict();
```

Add `legacyBindings` to API-ready submissions with a default empty array for non-legacy modes. For legacy API delivery, compare endpoint identities exactly and require every source origin, transport, candidate, and call site from the pinned v3 inventory to appear once. Implementation API coverage also compares `endpointKey ?? operationKey`, while report display continues to use `operationKey`.

- [ ] **Step 4: Run contract, workflow, and report tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts tests/unit/workflow-report-renderer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit migration binding enforcement**

```bash
git add src/workflow/workflow-contracts.ts src/application/workflow-service.ts tests/unit/workflow-contracts.test.ts tests/integration/workflow-service.test.ts tests/unit/workflow-report-renderer.test.ts
git commit -m "feat: prove legacy transport mappings"
```

### Task 8: Update host policy, generated artifacts, and user documentation

**Files:**
- Modify: `skills/spec-to-pr/SKILL.md`
- Modify: `skills/intake-contracts/SKILL.md`
- Modify: `skills/implement/SKILL.md`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `website/docs/usage/legacy.mdx`
- Modify: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/legacy.mdx`
- Modify: `website/docs/troubleshooting.md`
- Modify: generated files under `schemas/runtime/`, `packages/codex-sdk/dist/`, and `dist/mcp/`
- Modify: policy/documentation tests under `tests/plugin/` and `tests/unit/codex-sdk-workflow-policy.test.ts`

**Interfaces:**
- Consumes: final v3 workflow contract.
- Produces: synchronized SDK/plugin instructions, runtime schemas, bundles, and Korean/English guides.

- [ ] **Step 1: Write failing policy and documentation assertions**

```ts
expect(legacyInstructions).toContain("collect-legacy-network-evidence");
expect(legacyInstructions).toContain("origin and transport mappings");
expect(legacyInstructions).toContain("supporting dependency");
expect(legacyInstructions).toContain("OpenAPI and HAR never expand legacy scope");
expect(legacyInstructions).not.toContain("restart intake");
```

- [ ] **Step 2: Run policy tests and verify RED**

Run: `pnpm exec vitest run tests/plugin/documentation-v2.test.ts tests/plugin/layout.test.ts tests/unit/codex-sdk-workflow-policy.test.ts`

Expected: FAIL because current instructions still describe terminal blockers and flat API coverage.

- [ ] **Step 3: Update instructions and guides**

Document the unchanged minimal prompt, feature-versus-dependency boundary, preserved env/client provenance, same-Run collection action, correlated OpenAPI/HAR behavior, early truncation, `no-api-detected`, and source-to-target bindings. Include a Shop example showing eight paths, three origins, and two transports without displaying environment values.

- [ ] **Step 4: Regenerate schemas and bundles**

Run:

```bash
pnpm policy:sync
pnpm schemas:build
pnpm sdk:build
pnpm build
```

Expected: generated runtime schemas, SDK dist, and MCP bundle reflect the additive action/submission/contracts.

- [ ] **Step 5: Run policy and generated-file checks and verify GREEN**

Run:

```bash
pnpm policy:check
pnpm schemas:check
pnpm sdk:check-dist
pnpm bundle:check-dist
pnpm exec vitest run tests/plugin/documentation-v2.test.ts tests/plugin/layout.test.ts tests/unit/codex-sdk-workflow-policy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit synchronized public surfaces**

```bash
git add skills packages/codex-sdk/src packages/codex-sdk/dist website schemas/runtime dist/mcp tests/plugin tests/unit/codex-sdk-workflow-policy.test.ts
git commit -m "docs: explain semantic legacy intake"
```

### Task 9: Run final verification and prepare the implementation handoff

**Files:**
- Modify only if a verification command exposes a defect in Tasks 1-8.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified working tree and a concise evidence summary.

- [ ] **Step 1: Run focused legacy suites**

Run:

```bash
pnpm exec vitest run \
  tests/unit/legacy-api-contracts.test.ts \
  tests/unit/legacy-source-graph.test.ts \
  tests/unit/legacy-api-discovery.test.ts \
  tests/unit/legacy-api-resolution.test.ts \
  tests/unit/legacy-inventory.test.ts \
  tests/unit/openapi-inventory.test.ts \
  tests/integration/workflow-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository-wide verification**

Run: `pnpm check`

Expected: PASS for SDK typecheck/build/dist, formatting, TypeScript, schemas, MCP bundle, and the complete Vitest suite.

- [ ] **Step 3: Validate both plugin layouts**

Run: `pnpm plugin:validate`

Expected: PASS for Claude and Codex plugin validation.

- [ ] **Step 4: Verify the release package without publishing**

Run: `pnpm release:verify`

Expected: PASS without tagging, pushing, or publishing.

- [ ] **Step 5: Confirm the real Shop inventory**

Run the v3 inventory directly against the read-only Shop root:

```bash
pnpm exec tsx -e 'import { buildLegacyInventory } from "./src/legacy/legacy-inventory.ts"; const inventory = await buildLegacyInventory("/Users/dhp94d/Desktop/project/sandbox_new/src/modules/shop"); const candidates = inventory.apiCandidates; const origins = new Set(candidates.flatMap((item) => item.originRef?.kind === "environment" ? [item.originRef.name] : [])); const transports = new Set(candidates.flatMap((item) => item.callSites.flatMap((site) => site.transportRef === undefined ? [] : [site.transportRef]))); const info = candidates.find((item) => item.operationKey === "GET /shop/{rgnNo}"); const unresolved = candidates.filter((item) => item.method === "UNKNOWN" || item.pathTemplate === undefined); const outside = inventory.entries.filter((item) => item.sourcePath.startsWith("../") || item.sourcePath.startsWith("/")); process.stdout.write(JSON.stringify({ logicalOperations: candidates.length, environmentOrigins: origins.size, transportRefs: transports.size, infoCallSites: info?.callSites.length ?? 0, unresolvedCandidates: unresolved.length, outOfRootFeatureKeys: outside.length }, null, 2));'
```

Expected:

```json
{
  "logicalOperations": 8,
  "environmentOrigins": 3,
  "transportRefs": 2,
  "infoCallSites": 2,
  "unresolvedCandidates": 0,
  "outOfRootFeatureKeys": 0
}
```

Do not write to the legacy tree or persist its environment values.

- [ ] **Step 6: Commit verification-only fixes if needed**

If Steps 1-5 required code changes, repeat the failing command after each fix, stage only those files, and commit:

```bash
git commit -m "fix: complete semantic legacy verification"
```

If no files changed, do not create an empty commit.

## Self-review results

- Spec coverage: Tasks 1-7 cover the complete accepted legacy semantic intake design; Task 8 covers synchronized public surfaces; Task 9 covers all required verification.
- Deferred scope: Figma/visual and authenticated-source/performance/publication work remain intentionally outside this plan and require their own designs.
- Type consistency: `endpointKey`, `operationKey`, `candidateKey`, `originRef`, `callSites`, and `legacyBindings` retain the same names across discovery, resolution, workflow, and coverage tasks.
- Placeholder scan: the plan contains no deferred implementation markers; each production step names concrete files, interfaces, tests, commands, expected failures, and commits.
