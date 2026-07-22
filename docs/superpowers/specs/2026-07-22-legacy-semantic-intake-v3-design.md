# Legacy Semantic Intake v3 Design

## Purpose

Make `legacy` delivery migrate the feature under the supplied `legacyProjectRoot` without either:

- blocking before implementation because a heuristic scanner invented an API; or
- passing intake after discarding the environment, gateway, authentication client, call-site, and dependency evidence needed to reproduce the legacy behavior.

This is the first of three independent hardening projects identified by the flow audit:

1. **This design:** legacy feature/dependency boundaries, semantic API inventory, scoped OpenAPI/HAR correlation, and same-Run intake recovery.
2. **Follow-up:** Figma prerequisite actions and review-packet-safe visual artifacts.
3. **Follow-up:** authenticated remote sources, performance policy, and real publication preflight.

Splitting these projects keeps the first release focused on the failure that prevented the Shop migration.

## Confirmed failure modes

The current v2 inventory flattens a source request to `METHOD path` and stores that value as both the normalized key and API symbol. In the observed Shop module this loses:

- `VUE_APP_API_GW_V1_URL`, `VUE_APP_API_GW_V2_URL`, and `VUE_APP_API_GW_LOUNGE_API` as three distinct service origins;
- `axiosInstance` versus `defaultAxiosInstance` as authenticated and default transports;
- the app/non-app branch that calls the same `GET /shop/{rgnNo}` through two transports;
- query parameters, request configuration, response transformations, and wrapper-to-terminal call chains.

Other confirmed failures are:

- one low-confidence symbolic candidate blocks all of intake;
- `fetch(dynamicUrl)`, relative client paths, and generated operations cannot be resolved by the HAR action named in the blocker message;
- supplied OpenAPI documents and HAR files expand the migration contract to unrelated operations;
- direct dependencies outside the feature directory are allowed by policy text but invisible to the runtime scanner;
- regular source, comments, strings, SDK utilities, and nearby `fetch` options can be misclassified by regex;
- a truncated inventory can pass intake and fail only after contract work;
- “no API detected” is treated as “no API exists.”

## Goals

- Keep the caller-provided `legacyProjectRoot` as the immutable **feature ownership boundary**.
- Discover the enclosing legacy application configuration without changing the requested feature boundary or requiring a different prompt.
- Follow only explicit import, alias, manifest, environment-reference, style/asset, and runtime edges needed by an in-root feature.
- Represent legacy API behavior as structured endpoint, origin, transport, call-site, and request/response evidence.
- Derive exactly the API operations used by the selected legacy feature; use OpenAPI and HAR as corroborating evidence rather than scope expansion.
- Let genuinely opaque API candidates request evidence and continue in the same Run.
- Preserve secret redaction, bounded evidence, read-only legacy access, source freshness, and exact downstream coverage.
- Parse existing v2 inventory artifacts while writing v3 artifacts for new Runs.

## Non-goals

- Search sibling features by keyword when a requested term is absent.
- Treat every file in the enclosing application or workspace as migration scope.
- Copy a legacy `.env` file or persist tokens, cookies, passwords, or credential-bearing URLs.
- Inline an old environment-specific host into target production code.
- Implement every operation in a supplied service-wide OpenAPI document.
- Build a complete whole-program JavaScript interpreter.
- Fix Figma, visual packet, performance, or publication behavior in this change.

## Considered approaches

### 1. Continue patching the regex scanner

Add exclusions for constructors, SDK utilities, comments, and known wrappers. This is small but preserves the core defect: new syntax produces new false positives, and normalized strings still cannot retain transport or dependency context.

### 2. Scan the complete enclosing application

Treat the nearest package root as the source boundary and run semantic analysis over everything. This resolves aliases and shared clients, but recreates the original scope leak: unrelated booking, checkout, and sibling modules become candidate features.

### 3. Bounded semantic dependency closure

Keep feature ownership under the supplied root, find the enclosing application only for configuration, then follow explicit dependency edges from in-root files. Build structured API candidates at proven terminal network effects and correlate them with OpenAPI/HAR evidence.

This design selects approach 3. It resolves the Shop case without making the feature root either isolated or porous.

## Boundary model

### Feature boundary

`legacyProjectRoot` remains the only source of route, screen, state, persistence, analytics, and other migratable feature keys. A missing term can produce an in-bound scope mismatch, but cannot trigger a sibling or repository-wide keyword search.

The existing prompt remains valid:

```text
legacyProjectRoot: ../sandbox_new/src/modules/shop
```

No `legacyScopePaths` input is required for this project.

### Application context

The runtime locates the nearest enclosing application root by walking ancestors from `legacyProjectRoot` until it finds a supported package/build boundary. The walk is bounded, read-only, and stops at the containing Git/workspace root.

Application-context files may provide:

- package/workspace metadata and start commands;
- `tsconfig`/`jsconfig`, Vite, Webpack, Vue, Babel, and equivalent alias configuration;
- environment schemas and examples;
- imported HTTP transports, utilities, styles, assets, workers, and type declarations.

Application-context files do not create feature keys merely because they exist.

### Dependency closure

Inventory starts from source files inside `legacyProjectRoot`. It may read another file only through a recorded edge from the current closure:

- static import, export, or require;
- a resolved configured alias;
- a declared workspace/package export;
- imported style, asset, worker, template, or type;
- a referenced environment identifier;
- a terminal runtime request correlated to an in-root call chain.

Each supporting file records a redacted path, digest, resolver kind, importer, and specifier. Unrelated exports in the same supporting module do not become feature candidates unless reached by the call graph.

## Environment handling

Normalization must not erase environment provenance.

For every referenced environment binding, inventory records:

```ts
type LegacyOriginRef =
  | {
      kind: "environment";
      runtime: "process.env" | "import.meta.env";
      name: string;
      sanitizedOrigin?: string;
    }
  | { kind: "literal"; sanitizedOrigin: string }
  | { kind: "openapi-server"; sourceLocator: string; serverIndex: number }
  | { kind: "runtime-origin"; sanitizedOrigin: string };
```

Rules:

- The environment name and source expression are always preserved.
- URL-shaped, non-secret bindings may be read one key at a time from the selected runtime/configuration context when needed to resolve a service origin.
- Persisted `sanitizedOrigin` contains only scheme, host, port, and safe base path. Userinfo, query, fragment, and secret-shaped values are rejected or removed.
- Secret-shaped bindings retain only their name and runtime reference. Their values never enter model context, durable artifacts, logs, reports, or commits.
- Target implementation maps the source origin reference to an existing target client/environment binding. If none exists, it adds a target environment schema/example entry, never a committed secret value.

The normalized route template remains a separate field and never replaces `originRef`.

## Semantic API inventory

### Data model

Legacy inventory v3 adds a separate `apiCandidates` collection rather than overloading generic feature entries:

```ts
type LegacyApiCandidate = {
  candidateKey: string;
  endpointKey: string;
  operationKey: string;
  method: HttpMethod | "UNKNOWN";
  pathTemplate?: string;
  originRef?: LegacyOriginRef;
  confidence: "high" | "medium" | "low";
  terminalKind: "fetch" | "http-client" | "request-config" | "generated-client";
  callSites: LegacyApiCallSite[];
  requestEvidence: LegacyRequestEvidence;
  responseEvidence: LegacyResponseEvidence;
  witnesses: LegacyApiWitness[];
};
```

`operationKey` remains the display/OpenAPI identity `METHOD pathTemplate`. `endpointKey` includes the service/origin namespace so two services with `GET /health` do not collide. `candidateKey` remains stable across OpenAPI/HAR enrichment.

Each call site preserves:

- in-root owner feature key;
- terminal and wrapper source locations;
- receiver/local binding and resolved transport definition;
- branch or guard summary when statically identifiable;
- request parameter/body/config references;
- response selection or transformation such as `return data`.

Multiple callers and multiple transports append to `callSites`; they are never first-wins deduplicated.

### Parser and call graph

JavaScript and TypeScript use the TypeScript compiler parser already available in the workspace. Vue and Svelte files expose their script blocks to the same parser. CSS and JSON remain available for feature/resource discovery but are never searched as JavaScript API source.

The first implementation recognizes:

- `fetch`, including `Request` objects and inline/options-variable methods when statically resolvable;
- verb methods and request-config calls on transports reached through imports, construction, or assignment;
- generated clients only when a generated header, manifest, OpenAPI/codegen metadata, or explicit generated adapter proves provenance;
- local wrappers by following their exports to a terminal network effect.

Comments and string contents are excluded by the parser. Optional chaining, bracket property access, direct axios calls, template literals, and string concatenation use AST nodes rather than regular-expression slices.

A local wrapper or constructor without a terminal network effect is not an API candidate. A truly opaque terminal call is a candidate with the unresolved expression and low confidence.

### Template normalization

Path normalization produces an anchored segment template:

- simple identifier/member interpolations become `{parameter}` segments;
- parameter names do not affect structural compatibility;
- literal segments remain case-sensitive;
- a runtime concrete segment may match one template parameter;
- calls, operators, encoded separators, backslashes, control characters, and dot segments remain opaque;
- base URL and path joining obey URL/base-path semantics rather than string prefix removal.

`/shop/{rgnNo}`, `/shop/{regionId}`, and runtime `/shop/123` are structurally compatible. They are not compatible with `/shop/123/notices`.

## OpenAPI and HAR correlation

### OpenAPI

In `legacy` mode, supplied OpenAPI documents are a lookup index and schema source. Only operations correlated to legacy candidates become authoritative `deliveryProfile.openApiOperations`.

Unmatched OpenAPI operations remain in source provenance but do not require API-ready rows, exclusions, mocks, or implementation coverage. Brief and feature modes retain their existing whole-contract policy.

Operations from different specs or `servers` entries use distinct service references, so identical `METHOD path` values do not fail global duplicate validation.

### Runtime network evidence

HAR/request evidence never promotes every browser request into the contract. It may:

- resolve or corroborate an existing source candidate;
- bind a concrete runtime path to one compatible path template;
- supply method/origin evidence for one opaque terminal call when the correlation is unique.

Static resources, document navigation, analytics, preflight, and unrelated origins are ignored unless explicitly correlated to a source candidate. Multiple concrete IDs fold into one template operation.

Raw HAR headers, bodies, cookies, query values, and response payloads are not persisted.

## Intake and same-Run recovery

The runtime classifies unresolved candidates after feature ownership and dependency closure are known.

- A high-confidence concrete source method/path proceeds without OpenAPI.
- A low-confidence non-terminal heuristic cannot block intake because it is not a candidate.
- A genuinely opaque terminal call becomes a typed unresolved candidate.
- Inventory truncation blocks immediately during intake with a precise limit diagnostic.
- Zero candidates produce `no-api-detected`, not `no-api-confirmed`; contracts must explicitly confirm the in-scope flow is network-free or supply runtime evidence.

When opaque candidates exist and no runtime evidence is pinned, status exposes:

```json
{
  "kind": "collect-legacy-network-evidence",
  "runId": "run_..."
}
```

The blocker is retryable and resumable. A `legacy-network-evidence` submission is accepted before intake passes. Validation and correlation occur atomically; incomplete evidence leaves the action available without writing a partial replacement inventory.

Successful evidence:

1. verifies the legacy source and dependency closure are fresh;
2. writes sanitized provenance and a new inventory artifact;
3. resolves the existing API gap;
4. rebuilds only the correlated legacy API operation profile;
5. transitions the same intake stage to passed;
6. exposes `prepare-contracts` without a second `workflow_start`.

The status contract must never report `resumable: true` while exposing no valid resume action.

## Target migration contract

API-ready and implementation coverage for legacy mode bind source endpoint evidence to target architecture:

- source `endpointKey` and call-site feature keys;
- target client symbol and transport source path;
- source-to-target origin/environment mapping;
- production call sites, request/response types when known, mocks, and executable evidence;
- explicit gaps only for missing schema detail, not for source-known method/path.

This proves that `VUE_APP_API_GW_V1_URL` calls did not accidentally move to the V2 or LOUNGE client and that authenticated/default transport branches remain intentional.

## Error behavior

- `LEGACY_APPLICATION_CONTEXT_UNRESOLVED`: enclosing build/alias context needed by an in-root dependency cannot be located.
- `LEGACY_DEPENDENCY_UNRESOLVED`: an explicit in-root edge cannot be resolved within the bounded application/workspace context.
- `LEGACY_INVENTORY_TRUNCATED`: a configured inventory limit was reached; emitted during intake, with the exact limit and path category.
- `LEGACY_API_METHOD_UNKNOWN`: a proven terminal network effect remains opaque and needs same-Run evidence.
- `LEGACY_RUNTIME_EVIDENCE_INCOMPLETE`: evidence did not uniquely resolve the candidate; collection remains actionable.
- Existing source/evidence freshness errors continue to fail closed.

Known source endpoints absent from OpenAPI become non-blocking schema gaps. Wrapper names, constructors, comments, SDK utilities, and unrelated HAR/OpenAPI rows cannot raise `LEGACY_API_METHOD_UNKNOWN`.

## Compatibility and rollout

- `legacyProjectRoot` input semantics remain backward compatible and require no new prompt fields.
- Existing v2 artifacts parse through a compatibility adapter. New Runs emit inventory v3.
- Existing public workflow tools and eight stages remain unchanged; action and submission variants are additive.
- Legacy operation coverage keys migrate from global `METHOD path` to namespaced endpoint identity while retaining `operationKey` for display.
- Brief/feature OpenAPI policy does not change in this project.
- Generated schemas, MCP declarations, SDK runtime, skills, docs, Korean/English guide content, and release bundles update together.

## Testing strategy

Implementation follows test-driven slices:

1. **Boundary and dependency closure:** the Shop root resolves `@/api/httpService` and enclosing aliases without discovering booking or checkout features.
2. **Semantic adapters:** comments, strings, SDK utilities, `fetch(new Request())`, optional/bracket calls, direct axios, options variables, and string concatenation reproduce the audited cases.
3. **Shop provenance:** exactly eight logical paths, three environment origins, two transports, and two call sites for `GET /shop/{rgnNo}`.
4. **Service identity:** two origins/specs with `GET /health` remain distinct.
5. **Correlation:** environment templates, OpenAPI parameter-name variants, and concrete HAR paths fold structurally.
6. **Scope control:** a 100-operation OpenAPI and noisy HAR yield only correlated legacy operations.
7. **Recovery:** opaque calls expose the collection action and valid evidence advances the same Run atomically.
8. **Failure timing:** truncation blocks at intake and `no-api-detected` requires explicit confirmation.
9. **Migration coverage:** source origin/transport variants must map to target clients and evidence.
10. **Compatibility/security:** v2 artifacts parse, new artifacts redact secrets, and source freshness includes the dependency closure.

Focused tests run red-green for each slice, followed by typecheck, SDK/schema/policy generation checks, the complete Vitest suite, plugin validation, bundle checks, and release verification.

## Acceptance criteria

- The original prompt with `legacyProjectRoot: ../sandbox_new/src/modules/shop` remains sufficient.
- No feature outside that root can be inferred or migrated without a replacement root.
- Directly referenced aliases, HTTP transports, environment declarations, package metadata, styles, assets, and types remain visible as supporting dependencies.
- Shop produces eight logical API paths while preserving three origins, two transports, and both `GET /shop/{rgnNo}` call sites.
- Source-known V1, V2, and LOUNGE endpoints proceed without matching OpenAPI operations.
- A service-wide OpenAPI or noisy HAR does not expand the legacy contract beyond correlated endpoints.
- Dynamic terminal evidence can advance the same Run; a second `workflow_start` is unnecessary.
- Generated utilities, constructors, comments, and local wrappers cannot create API blockers.
- Inventory truncation cannot pass intake.
- Target coverage proves origin and transport mappings, not only method/path counts.
- Raw environment secrets, cookies, authorization data, and HAR payloads never appear in durable or public evidence.

## Deferred designs

After this project is accepted and implemented, create separate designs for:

1. `collect-figma-bundle` ordering, bundle replacement before contracts, and Run-owned visual capture storage that cannot stale Git review packets.
2. One-time authenticated OpenAPI fetch with redacted provenance, project/legacy-relative performance budgets, remote publication connectivity preflight, and explicit blocked-diagnostic publication policy.
