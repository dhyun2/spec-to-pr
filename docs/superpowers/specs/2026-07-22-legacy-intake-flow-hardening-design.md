# Legacy Intake Flow Hardening Design

## Problem

Legacy delivery currently conflates three boundaries:

1. `legacyProjectRoot` is both the executable application root and the inventory scan root.
2. source API literals, OpenAPI templates, and runtime HAR paths are compared as exact strings.
3. an unresolved legacy API permanently blocks intake before the workflow can request runtime evidence.

The observed failure exposed two more gaps:

4. after an intake blocker, generic repository search can leave the declared migration scope and treat a keyword-similar module as the requested source;
5. API discovery treats local imports whose names or paths contain `api`, `service`, or `client` as generated API clients, so ordinary store wrappers and transport constructors become duplicate or `UNKNOWN` operations.

The fourth gap must not be fixed with a blanket prohibition on reading outside the selected feature directory. A real application keeps aliases, build configuration, environment declarations, shared HTTP transports, utilities, styles, and workspace libraries outside a feature module. The workflow needs a bounded dependency closure, not an isolated directory scan and not an unbounded repository search.

## Goals

- Keep `legacyProjectRoot` as the immutable executable application root, while making feature ownership an independent explicit boundary.
- Let callers select one or more migration directories below that root and follow only their proven dependency closure.
- Allow explicitly pinned, read-only dependency roots for workspace libraries outside the application root.
- Resolve local wrappers to terminal network calls so one legacy HTTP operation is inventoried once.
- Resolve safe environment-base URL templates against structurally equivalent OpenAPI and HAR paths without reading environment values or evaluating source code.
- Turn `LEGACY_API_METHOD_UNKNOWN` into a typed same-Run evidence-collection action when no runtime network evidence was pinned at start.
- Preserve the seven public workflow tools and eight durable stages.
- Preserve existing legacy starts when the new scope field is omitted.
- Keep raw HAR headers, cookies, bodies, queries, credentials, and tokens out of durable artifacts and reports.

## Non-goals

- Infer a filesystem scope from arbitrary natural language.
- Use global keyword search outside the selected migration scope to infer a different feature when a requested phrase is absent.
- Treat an arbitrary file elsewhere in the repository or filesystem as a dependency without an import, alias, manifest, configuration, asset, or runtime provenance edge.
- Treat a local function call or transport constructor as an API operation merely because its identifier or import path contains `api`, `client`, `http`, `service`, or `sdk`.
- Automatically decide that a target file is semantically correct from filename or keyword similarity.
- Evaluate JavaScript, persist environment values, fetch discovered URLs, or decode path segments during static inventory.
- Support replacing already pinned runtime evidence in the first recovery implementation.
- Add a public MCP tool, durable stage, or reviewer role.

## Considered approaches

### 1. Skills and documentation only

Add an immutable-boundary prohibition and correct the copyable prompt example. This prevents the observed agent fallback when instructions are followed, but it does not fix whole-root inventory, template URL resolution, or permanent intake blocking.

### 2. Preflight and a new Run

Collect network evidence before `workflow_start`, or require a new Run after a blocker. This is the smallest runtime change, but it contradicts the intended “start once” experience and leaves the first Run as avoidable diagnostic debris.

### 3. Scoped ownership, dependency closure, structural API resolution, and same-Run recovery

Add backward-compatible scope and dependency-root fields, a bounded dependency graph, a pure API resolver, and one action/submission pair on the existing intake stage. This has the largest change surface, but directly fixes the runtime causes while retaining the public facade and provenance guarantees.

The selected design is approach 3, with approach 1 retained as defense in depth.

## Architecture

### Three bounded legacy boundaries

`workflow_start` distinguishes three boundaries:

1. `legacyProjectRoot` is the full application/runtime root. It contains the package manifest, build configuration, route entry points, environment files, and launch context. For the observed project this is `../sandbox_new`, not `../sandbox_new/src/modules/shop`.
2. optional `legacyScopePaths: string[]` selects feature-owned migration directories relative to the application root. For the observed project it is `["src/modules/shop"]`.
3. optional `legacyDependencyRoots: string[]` pins additional read-only roots for declared workspace/source dependencies outside the application root. It defaults to `[]` and never expands feature ownership.

- Scope paths are POSIX-style, relative to the canonical `legacyProjectRoot`, unique, and directory-only.
- Scope real paths must remain inside `legacyProjectRoot`; symlinks, traversal, absolute paths, control characters, and overlapping ancestor/descendant selections are rejected.
- Dependency roots are canonical directories, read-only, non-overlapping with the target project, and pinned into source provenance. They grant dependency resolution only; they cannot contribute routes, screens, state, or other feature keys by mere presence.
- Omission is equivalent to `["."]`, preserving existing behavior.
- `legacyProjectRoot` remains the application launch root. Feature enumeration starts only from `legacyScopePaths`.
- Inventory source paths remain relative to `legacyProjectRoot`, even when traversal starts deeper.
- External dependency paths use a redacted root identifier plus root-relative path; canonical absolute paths never appear in public provenance.
- The normalized scope and dependency-root lists are stored in `DeliveryProfile` and `LegacyInventory`, and participate in the inventory source digest.
- Freshness checks rebuild the inventory with the same pinned boundaries.

The runtime does not add `app` to a global ignore list because `app/` is valid source in several frameworks. Explicit scope is the deterministic solution to build-output ambiguity.

### Proven dependency closure

The inventory builds a bounded graph seeded by files under `legacyScopePaths`. It may read outside those paths only through a recorded edge:

- relative or absolute-in-project imports and re-exports;
- aliases resolved from `tsconfig`, `jsconfig`, Vite, Webpack, Vue, Babel, or equivalent project configuration;
- package exports and workspace dependencies declared by manifests and lock/workspace metadata;
- imported styles, templates, assets, workers, and route registrations;
- referenced environment identifiers and the project-selected environment-file metadata;
- runtime requests captured while executing an in-scope route/state.

Each dependency file records its origin, digest, resolver, and parent edge. Files outside the migration scope are classified as `supporting-dependency`, not as independent legacy features. A concrete endpoint defined in a shared dependency still belongs to the in-scope call chain that reaches it, but unrelated exports and files are not inventoried.

Resolution may leave `legacyProjectRoot` only when the resulting real path is inside a pinned `legacyDependencyRoot`. An unresolved alias, dynamic import, package, or out-of-root path produces a precise dependency diagnostic; it never triggers a filesystem-wide search.

The static API resolver consumes environment variable names and references, never their values. The inventory service may hash the selected environment files or referenced bindings for freshness without exposing their contents. Environment values may be loaded normally by the legacy project's own launch command and remain process-local; they are never copied into model context, inventory artifacts, reports, or PR evidence. This allows the real app to run while keeping secrets out of durable state.

### Bounded feature discovery, not a blanket search ban

The umbrella, intake, implementation, and SDK policy instructions state a positive contract:

1. feature discovery and natural-language keyword search stay inside `legacyScopePaths`;
2. import/configuration/runtime dependency tracing may leave those paths only through the proven closure described above;
3. every migrated feature claim cites an in-scope inventory feature key, while every supporting file cites a dependency edge;
4. absence of a requested term never authorizes a repository-wide fallback search or a keyword-similar feature from another module;
5. a request to “inspect the whole project” permits relevant dependency/configuration inspection but does not expand feature ownership;
6. changing the migration scope or external dependency roots requires explicit start input rather than an inferred path.

For an explicit whole-scope migration, every feature key owned by `legacyScopePaths` is selected by default. Natural-language text may narrow that set only through explicit in-scope evidence and recorded exclusions; absence of a phrase match never silently substitutes or removes features. Runtime contracts continue to require exact coverage of the selected inventory keys.

This boundary governs legacy feature discovery. The target project may still be searched for integration points, but every selected target file must trace back to an in-scope feature key. Functional review checks those mappings and executable evidence rather than accepting keyword similarity alone.

### Call-graph API ownership and deduplication

API discovery resolves imports and calls before applying network adapters:

- A default or named import that resolves to local source is a call-graph edge, not a generated-client operation. `ghomeApi.getGhomeInfo()` in a store follows the exported function in `api/ghomeApi.js`.
- `new httpService()` and `new defaultHttpService()` are transport construction, never request operations.
- A request candidate is created only at a proven terminal network effect: `fetch`, a recognized HTTP verb/config call on a traced transport, or a generated-client operation with generated provenance.
- Generated provenance requires an external/generated module declaration, generated-code metadata, or an explicit adapter. Identifier and path-name regexes are insufficient.
- A local wrapper with no proven terminal network effect is an ordinary call, not an `UNKNOWN` API candidate.
- Terminal operations are deduplicated by canonical method/path plus source/call-chain correlation. Multiple store/component callers point to the same operation instead of creating duplicate candidates.

Known source method/path is authoritative legacy evidence. OpenAPI enriches schemas and types when available, but an endpoint absent from supplied OpenAPI is not an intake blocker. HAR recovery is reserved for genuinely opaque terminal calls after dependency tracing and deduplication, not for wrapper names.

### Structural legacy API resolver

API discovery remains read-only. Resolution moves into a pure `legacy-api-resolution` module with typed source candidates and explicit correlations.

Supported source locators are:

- absolute or root-relative HTTP paths;
- an environment-base prefix using `process.env.NAME` or `import.meta.env.NAME`, where `NAME` is URL/base/host/gateway-shaped, followed by a bounded path template;
- generated-client operation IDs;
- opaque locators, which remain unresolved.

Simple `${identifier}` or `${object.member}` path expressions become one-segment parameters. Calls, operators, nested templates, encoded separators, backslashes, control characters, and dot segments remain opaque. The resolver never reads an environment variable.

Path matching is anchored and segment-based:

- literal segments match case-sensitively;
- a parameter matches one nonempty segment;
- parameter names do not affect compatibility;
- trailing and repeated slashes remain significant;
- `%2F` is never decoded.

Resolution precedence is:

1. one structurally compatible OpenAPI operation becomes canonical;
2. otherwise a resolved source path/template becomes canonical;
3. HAR requests corroborate and fold into that canonical operation;
4. a HAR request becomes standalone only when no unique template operation subsumes it.

Multiple compatible OpenAPI operations, conflicting observed methods, or opaque source locators remain unresolved. Every resolved source feature records a correlation to the canonical operation and the evidence witnesses. Runtime-network entries use a runtime evidence locator and are never labeled `external-legacy-project/...`.

### Same-Run runtime evidence recovery

If intake has unresolved API candidates and no runtime network evidence was pinned, the runtime:

- records `LEGACY_API_METHOD_UNKNOWN` as retryable;
- leaves intake blocked with its checkpoint and immutable source inventory;
- returns `status: needs-external-action`;
- emits `{kind: "collect-legacy-network-evidence", runId}`.

Only after static dependency tracing leaves a genuine terminal request opaque, the host runs the pinned legacy application at an in-scope route/state, writes a bounded project-local HAR/request JSON, and submits:

```json
{
  "kind": "legacy-network-evidence",
  "status": "passed",
  "legacyNetworkEvidencePath": "evidence/legacy-network.json",
  "capturedAt": "2026-07-22T00:00:00.000Z",
  "summary": "Captured the scoped legacy flow."
}
```

This submission is the only submission accepted before intake passes. The service handles it before generic evidence ingestion:

1. read the file from the target project with the existing safe path and size limits;
2. validate at most 1 MB and 1,000 requests;
3. verify the legacy source inventory is still fresh;
4. merge normalized requests in memory and require every candidate to resolve uniquely;
5. persist only locator, raw digest, capture time, normalized method/path rows, correlations, and a sanitized receipt;
6. append a provenance row and revised inventory artifact without deleting prior artifacts;
7. resolve the existing API gap with the revised inventory and receipt artifacts;
8. rebuild operation-dependent delivery requirements;
9. transition intake `blocked -> running -> passed` using the existing stage service.

If the evidence is malformed or incomplete, no new provenance or inventory artifact is committed and the collection action remains available. If runtime evidence was already pinned at start but remains insufficient, intake stays a durable blocker; replacing pinned evidence is intentionally unsupported in this version.

## Error behavior

- `LEGACY_SCOPE_PATH_INVALID`: a scope path is missing, non-directory, overlapping, symlinked outside the root, or non-portable.
- `LEGACY_DEPENDENCY_ROOT_INVALID`: an explicit dependency root is missing, writable through the target, overlapping, or unsafe.
- `LEGACY_DEPENDENCY_UNRESOLVED`: an in-scope file has a required import/alias/configuration edge that cannot be resolved within the pinned roots. The diagnostic names the sanitized importer and specifier; it never guesses or searches globally.
- `LEGACY_SCOPE_UNRESOLVED`: the requested behavior cannot be mapped to an in-scope feature key during contract preparation. Explicit whole-scope migration continues from the selected inventory; a genuinely narrower ambiguous request asks for correction rather than inspecting another module.
- `LEGACY_API_METHOD_UNKNOWN`: a proven terminal network effect remains opaque after call-graph and structural resolution and needs the typed network-evidence action or a unique OpenAPI/runtime match. Local wrappers, constructors, and known source method/path calls cannot raise this error.
- `LEGACY_RUNTIME_EVIDENCE_INCOMPLETE`: submitted runtime evidence does not uniquely resolve every candidate; the same action remains pending.
- Existing `LEGACY_SOURCE_CHANGED` and `LEGACY_RUNTIME_EVIDENCE_CHANGED` checks continue to fail closed.

A known source method/path that is absent from supplied OpenAPI is retained as a source-backed operation with an API-schema gap; it does not block intake.

All blocker diagnostics remain redacted and use project-relative evidence names.

## Compatibility

- Existing callers omit `legacyScopePaths` and receive `["."]` behavior.
- Existing callers omit `legacyDependencyRoots` and receive `[]` behavior.
- Existing starts that supply `legacyNetworkEvidencePath` continue through the current start path.
- The action and submission additions are additive to the existing seven-tool facade.
- Old inventory artifacts parse with a default scope of `["."]` and no external dependency roots; new artifacts record all three boundaries and the dependency graph explicitly.
- Stable keys for legacy files remain based on category, normalized key, and root-relative source path. Optional OpenAPI/HAR enrichment does not change them.
- The SDK, generated schemas, MCP declarations, plugin documentation, and English/Korean guides are updated together.

## Security and trust boundaries

- Never persist raw HAR payloads or authentication material.
- Never expose environment values while resolving source templates; freshness stores only a digest and sanitized key provenance.
- Never follow a migration-scope path outside its canonical application root.
- Never resolve a dependency outside the application root or an explicitly pinned read-only dependency root.
- Never create a feature key from a supporting dependency unless it is explicitly added to the migration scope.
- Never treat a target-project evidence path as a legacy source path.
- Never accept caller-supplied API correlations when the runtime can compute them.
- Keep the legacy tree read-only and recheck its digest before recovery and all downstream legacy submissions.

## Testing strategy

Implementation follows red-green-refactor in four slices.

1. Boundary and dependency tests prove safe canonicalization, default compatibility, root-relative feature paths, redacted external paths, alias/import/config traversal, no sibling discovery, and freshness over only the pinned closure.
2. Call-graph tests reproduce the Shop tree and prove exactly eight terminal operations: no `operation:getGhomeInfo`, `operation:getTournamentList`, `operation:getShopRanking`, `operation:httpService`, or `operation:defaultHttpService` rows; a keyword-named non-network object produces no candidate; and a neutrally named traced transport does.
3. Resolver tests prove the exact environment-base example, structural OpenAPI/HAR folding, parameter-name independence, ambiguity blocking, case/trailing-slash behavior, and hostile/opaque interpolation rejection.
4. Workflow tests prove source-backed operations can proceed without matching OpenAPI, action emission occurs only for genuinely opaque terminals, pre-intake submission isolation, redacted persistence, incomplete-evidence atomicity, gap resolution, rebuilt API requirements, same-Run continuation, and already-pinned-evidence blocking.

Policy and skill tests use the observed pressure scenario: a requested term is absent inside a Shop scope, the user says to inspect the project, another module contains a keyword match, and Shop imports shared utilities outside its directory. The baseline behavior searches the sibling module. The revised skill must ignore that keyword match, follow only Shop's import/configuration closure, and either continue the explicit whole-scope migration or report an in-scope request mismatch.

The final verification runs focused unit/integration tests, SDK and TypeScript type checks, schema/policy generation checks, plugin validation, formatting checks, the complete Vitest suite, and the release verification command.

## Acceptance criteria

- `legacyProjectRoot: ../sandbox_new` with `legacyScopePaths: ["src/modules/shop"]` creates feature keys only from Shop while recording the reachable aliases, shared transports, utilities, assets, configuration, and environment metadata as supporting dependencies.
- A dependency outside `legacyProjectRoot` is read only when reached through the graph and contained by a pinned `legacyDependencyRoot`; it never becomes an unrelated feature.
- The observed `stores/ghome.js` plus `api/ghomeApi.js` tree yields exactly the eight concrete legacy transport operations and no generated-client or constructor duplicates.
- Source-known v1 tournament/ranking and GRX image operations remain authoritative even when the supplied v2 OpenAPI documents do not contain them.
- `${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}`, OpenAPI `/shop/{rgnNo}`, and HAR `/shop/123` produce exactly one canonical `GET /shop/{rgnNo}` operation.
- Only a genuinely opaque terminal API with no pinned runtime evidence yields `collect-legacy-network-evidence`, not a terminal Run.
- Valid bounded evidence advances the same Run without a second `workflow_start`.
- Raw environment values, credentials, and HAR payload fields do not appear in the Run, artifacts, report, or status.
- A missing term inside the pinned scope never triggers feature discovery in a sibling module, while legitimate dependency tracing outside the scope remains available.
- Existing legacy callers without `legacyScopePaths` remain valid.
