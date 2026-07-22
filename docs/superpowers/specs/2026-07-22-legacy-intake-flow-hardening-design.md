# Legacy Intake Flow Hardening Design

## Problem

Legacy delivery currently conflates three boundaries:

1. `legacyProjectRoot` is both the executable application root and the inventory scan root.
2. source API literals, OpenAPI templates, and runtime HAR paths are compared as exact strings.
3. an unresolved legacy API permanently blocks intake before the workflow can request runtime evidence.

The observed failure exposed a fourth, agent-level gap: after an intake blocker, generic repository search can leave the declared legacy root and treat a keyword-similar module as the requested source. The runtime rejects downstream coverage that does not use inventory keys, but the public skills do not prohibit the out-of-bound discovery that happens before a submission.

## Goals

- Keep `legacyProjectRoot` as the immutable executable and semantic legacy boundary.
- Let callers scan one or more explicit directories below that root without copying or rewriting the legacy project.
- Resolve safe environment-base URL templates against structurally equivalent OpenAPI and HAR paths without reading environment values or evaluating source code.
- Turn `LEGACY_API_METHOD_UNKNOWN` into a typed same-Run evidence-collection action when no runtime network evidence was pinned at start.
- Preserve the seven public workflow tools and eight durable stages.
- Preserve existing legacy starts when the new scope field is omitted.
- Keep raw HAR headers, cookies, bodies, queries, credentials, and tokens out of durable artifacts and reports.

## Non-goals

- Infer a filesystem scope from arbitrary natural language.
- Search outside `legacyProjectRoot` when a requested phrase is absent.
- Automatically decide that a target file is semantically correct from filename or keyword similarity.
- Evaluate JavaScript, expand environment variables, fetch discovered URLs, or decode path segments.
- Support replacing already pinned runtime evidence in the first recovery implementation.
- Add a public MCP tool, durable stage, or reviewer role.

## Considered approaches

### 1. Skills and documentation only

Add an immutable-boundary prohibition and correct the copyable prompt example. This prevents the observed agent fallback when instructions are followed, but it does not fix whole-root inventory, template URL resolution, or permanent intake blocking.

### 2. Preflight and a new Run

Collect network evidence before `workflow_start`, or require a new Run after a blocker. This is the smallest runtime change, but it contradicts the intended “start once” experience and leaves the first Run as avoidable diagnostic debris.

### 3. Scoped inventory, structural API resolution, and same-Run recovery

Add a backward-compatible scope field, a pure resolver, and one action/submission pair on the existing intake stage. This has the largest change surface, but directly fixes all three runtime causes while retaining the public facade and provenance guarantees.

The selected design is approach 3, with approach 1 retained as defense in depth.

## Architecture

### Explicit scoped inventory

`workflow_start` accepts an optional `legacyScopePaths: string[]`.

- Paths are POSIX-style, relative to the canonical `legacyProjectRoot`, unique, and directory-only.
- Real paths must remain inside `legacyProjectRoot`; symlinks, traversal, absolute paths, control characters, and overlapping ancestor/descendant selections are rejected.
- Omission is equivalent to `["."]`, preserving existing behavior.
- `legacyProjectRoot` remains the application launch root. Only inventory traversal uses `legacyScopePaths`.
- Inventory source paths remain relative to `legacyProjectRoot`, even when traversal starts deeper.
- The normalized scope list is stored in `DeliveryProfile` and `LegacyInventory`, and participates in the inventory source digest.
- Freshness checks rebuild the inventory with the pinned scope list.

The runtime does not add `app` to a global ignore list because `app/` is valid source in several frameworks. Explicit scope is the deterministic solution to build-output ambiguity.

### Immutable agent discovery boundary

The umbrella, intake, implementation, and SDK policy instructions state a positive contract:

1. legacy discovery inputs are the pinned `legacyProjectRoot`, `legacyScopePaths`, and `workflow_status.legacyInventory`;
2. every legacy claim cites an inventory feature key;
3. absence of a requested term produces an in-bound scope conflict, never a repository-wide fallback search;
4. a user request to “search the whole project” does not mutate the pinned boundary;
5. changing the source boundary requires a new explicit start input rather than an inferred path.

Runtime contracts continue to require exact coverage of the selected inventory keys. Functional review checks that target mappings and executable evidence implement those keys rather than keyword-similar features.

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

The host runs only the pinned legacy project and scoped flow, writes a bounded project-local HAR/request JSON, and submits:

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
- `LEGACY_SCOPE_UNRESOLVED`: the requested source behavior cannot be mapped to an in-bound inventory key during contract preparation. The exact action is to correct the explicit scope or request, never to search outside the root.
- `LEGACY_API_METHOD_UNKNOWN`: unresolved candidates need the typed network-evidence action or uniquely matching OpenAPI.
- `LEGACY_RUNTIME_EVIDENCE_INCOMPLETE`: submitted runtime evidence does not uniquely resolve every candidate; the same action remains pending.
- Existing `LEGACY_SOURCE_CHANGED` and `LEGACY_RUNTIME_EVIDENCE_CHANGED` checks continue to fail closed.

All blocker diagnostics remain redacted and use project-relative evidence names.

## Compatibility

- Existing callers omit `legacyScopePaths` and receive `["."]` behavior.
- Existing starts that supply `legacyNetworkEvidencePath` continue through the current start path.
- The action and submission additions are additive to the existing seven-tool facade.
- Old inventory artifacts parse with a default scope of `["."]`; new artifacts record scope explicitly.
- Stable keys for legacy files remain based on category, normalized key, and root-relative source path. Optional OpenAPI/HAR enrichment does not change them.
- The SDK, generated schemas, MCP declarations, plugin documentation, and English/Korean guides are updated together.

## Security and trust boundaries

- Never persist raw HAR payloads or authentication material.
- Never read environment values while resolving source templates.
- Never follow a legacy scope path outside its canonical root.
- Never treat a target-project evidence path as a legacy source path.
- Never accept caller-supplied API correlations when the runtime can compute them.
- Keep the legacy tree read-only and recheck its digest before recovery and all downstream legacy submissions.

## Testing strategy

Implementation follows red-green-refactor in three slices.

1. Scoped inventory tests prove safe canonicalization, default compatibility, root-relative source paths, overlap rejection, and freshness with the pinned scope.
2. Resolver tests prove the exact environment-base example, structural OpenAPI/HAR folding, parameter-name independence, ambiguity blocking, case/trailing-slash behavior, and hostile/opaque interpolation rejection.
3. Workflow tests prove action emission, pre-intake submission isolation, redacted persistence, incomplete-evidence atomicity, gap resolution, rebuilt API requirements, same-Run continuation, and already-pinned-evidence blocking.

Policy and skill tests use the observed pressure scenario: a requested term is absent inside a Shop scope, the user says to inspect the project, and another module contains a keyword match. The baseline behavior performs a global search; the revised skill must keep all legacy discovery inside the pinned boundary and report an in-bound scope conflict.

The final verification runs focused unit/integration tests, SDK and TypeScript type checks, schema/policy generation checks, plugin validation, formatting checks, the complete Vitest suite, and the release verification command.

## Acceptance criteria

- A full executable legacy root with `legacyScopePaths: ["src/modules/shop"]` inventories no source outside that directory.
- `${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}`, OpenAPI `/shop/{rgnNo}`, and HAR `/shop/123` produce exactly one canonical `GET /shop/{rgnNo}` operation.
- An unresolved API with no pinned runtime evidence yields `collect-legacy-network-evidence`, not a terminal Run.
- Valid bounded evidence advances the same Run without a second `workflow_start`.
- Raw credentials and HAR payload fields do not appear in the Run, artifacts, report, or status.
- A missing term inside the pinned scope never triggers a legacy search outside `legacyProjectRoot` or `legacyScopePaths`.
- Existing legacy callers without `legacyScopePaths` remain valid.
