---
name: intake-contracts
description: Use when the current v2 external action requests intake or contract preparation from supplied sources and repository context.
---

# Intake and Contracts

Start with `workflow_status`, then use `workflow_advance` to confirm the `prepare-contracts` action.

Read `deliveryProfile`. Accept only `auto | ui | non-ui | docs` as `scope`. Require `scope: ui` for all four explicit delivery modes: `brief`, `legacy`, `feature`, and `figma`. Treat mode as the delivery/evidence policy and collect composable sources independently:

- Read any `briefPath`, `docsPaths`, local `openApiPaths`, and fetched HTTPS `openApiUrls`; preserve acceptance criteria, API operations and schemas, contradictions, raw/resolved locators, capture timestamps, and digests. Treat `deliveryProfile.sourceProvenance` and the complete runtime-generated `openApiOperations` inventory as immutable pinned input evidence.
- Read explicit `guidancePaths` and `discoveredGuidancePaths` as durable project instructions. Block on a missing explicit path; ignore missing automatic candidates. Exclude project guidance from scope classification.
- `legacy`: use the read-only, separate `legacyProjectRoot` and the bounded `workflow_status.legacyInventory`. Treat them as the immutable feature boundary, not a dependency visibility boundary. Resolve each requested feature against that inventory; when no feature key matches, report an in-bound scope mismatch. A sibling, parent, or keyword-similar module requires an explicit replacement `legacyProjectRoot` and is never inferred from repository-wide search. Inspect directly referenced dependency evidence outside the root only when an explicit in-root import or configuration edge requires it: HTTP client/alias configuration, environment-name schemas/examples, package metadata/type declarations, and enclosing build/start metadata. Keep that traversal bounded; do not scan dependency trees or build output broadly, read secret values, or promote dependency evidence into unrelated feature keys, routes, screens, or API candidates. Use `legacyInventory.apiCandidates` as the API authority: terminal HTTP calls carry method/path, `originRef`, transport, and callsites; constructors and local facade calls are never separate operations. Map environment origins and authenticated/default transport semantics onto the target project's existing configuration and client conventions. Do not reduce an environment-based URL to a path-only implementation. If `legacyNetworkEvidencePath` is present, treat its project-local bounded HAR/request JSON, source-provenance digest, and `runtime-network-har` adapter as pinned evidence. Never infer a method missing from both source and runtime/OpenAPI evidence. When intake returns `collect-legacy-network-evidence`, capture only in-bound runtime requests and submit `kind: legacy-network-evidence` with `evidencePath`; remain in the same Run and then continue to contracts. Run both projects and submit `legacyBaseline` with a bounded scope, running legacy screenshots, evidence paths, and passed checks. Declare each running legacy screenshot as a `visualTargets` item with `baselineKind: legacy-screenshot`, route, state, fixture, viewport, scale, and justified masks. In contracts, map every in-scope stable inventory key through `legacyCoverage` as `planned` or intentionally out of scope; never claim migrated files or executable evidence before implementation.
- When `deliveryProfile.draftEvidenceBundle` is present, treat it as the exact stable review-artifact location. Keep production code and test source in the target project's normal feature locations; write only concise final review evidence under the bundle's `contractsRoot`, `evidenceRoot`, `visualRoot`, and `reportRoot`. Never put a run ID in a directory name. For a legacy migration, also create `openspec/changes/<changeName>/proposal.md`, at least one delta `spec.md`, and `tasks.md`; include those paths, the bundle manifest, and `draftBundle` `{ manifestPath, changeName, proposalPath, specPaths, tasksPath }` in the passed contracts submission. Do not copy raw browser logs, credentials, headers, full HAR files, or intermediate captures into the bundle.

  Create `draftEvidenceBundle.manifestPath` using the public `schemas/runtime/draft-evidence-manifest.schema.json` contract. Replace the placeholders in this exact-shape example. The manifest accepts no additional fields:

  ```json
  {
    "schemaVersion": "draft-evidence-manifest-v1",
    "runId": "run_<32 lowercase hex characters>",
    "runRevision": 0,
    "phase": "pre-implementation",
    "legacyRootDigest": "sha256:<64 lowercase hex characters>",
    "requirementIds": ["REQ-SHOP-ROUTING"],
    "openSpec": {
      "changeName": "shop-migration",
      "proposal": {
        "path": "openspec/changes/shop-migration/proposal.md",
        "digest": "sha256:<64 lowercase hex characters>"
      },
      "specs": [
        {
          "path": "openspec/changes/shop-migration/specs/shop/spec.md",
          "digest": "sha256:<64 lowercase hex characters>"
        }
      ],
      "tasks": {
        "path": "openspec/changes/shop-migration/tasks.md",
        "digest": "sha256:<64 lowercase hex characters>"
      }
    }
  }
  ```

  Copy `runId` and `runRevision` from the latest `workflow_status`, and copy `legacyRootDigest` from the bounded legacy inventory. `requirementIds` must be the unique IDs in the submitted requirement manifest. Each artifact `digest` is the SHA-256 of the exact file bytes at its project-relative `path`, written as `sha256:` followed by 64 lowercase hexadecimal characters.

- Legacy OpenAPI is optional enrichment, not an applicability switch. Derive API candidates from the bounded inventory. Preserve the zero-candidate inventory digest so the final API section can be `complete` with no operations; when candidates exist, require exact operation-aware `api-ready` and `apiCoverage` evidence.
- For any supplied `figmaUrl`/`figmaUrls`, use the host's connected Figma capability to fetch real nodes, screenshots, variables, assets, and component context for every normalized URL. Before contracts, submit exactly one `kind: figma-bundle` with `provider: host-connected-figma`, ISO `capturedAt`, compatibility `fileUrl`, complete `fileUrls`, nonempty `nodeIds`, captured component references, a strict `designMapping`, a declared JSON `manifestPath`, and project-local `artifactPaths` containing that manifest plus one or more actual PNG files. The manifest repeats that provenance and exactly lists its PNG `visualPaths`. Each Figma `visualTargets` entry declares node ID, capture kind, logical frame size, export scale, bitmap size, and sRGB color space. A downscaled host thumbnail is an export bitmap, never the browser viewport. Map every captured component exactly once to a verifiable installed design-system export, digest-bound canonical asset, or explicit exception; include package/version, fonts, and tokens. Add one target per required URL/route/state and use a stable named fixture ID. Do not use URL-only claims, repeat the bundle, poll, or add runtime Figma micro-tools.
- Treat `skillHints` as optional names. Ask the host to use a hint only when that skill is available and applicable. Missing optional skills do not block the Run.

Use `deliveryProfile.recommendedSkills` as the deterministic candidate list produced by intake. Verify this fixed routing and do not infer extra recommendations:

- `figmaUrl` -> `figma`, `design-system`
- `figmaUrls` -> `figma`, `design-system`
- `openApiPaths` or `openApiUrls` -> `api-generator`
- React package evidence -> `react-best-practices`
- Next.js package evidence -> `next-best-practices`
- feature UI -> `playwright`

Combine recommendations with user hints, but apply a candidate only when it is installed and applicable. Record only actually applied names in `guidanceTrace.appliedSkills`; never copy the full candidate list into applied evidence.

Resolve applicable scope, acceptance criteria, API operations and schemas, design evidence, and explicit gaps. Never invent undocumented API or UI behavior.

Apply instruction precedence exactly: current user request; explicit `guidancePaths`; automatically discovered project guidance; applicable installed skills; SpecToPR defaults. Project guidance overrides generic skill advice.

Submit `contracts` with `passed`, `failed`, or `blocked`, compact artifact paths, and a nonempty `requirementManifest` when passed. Each requirement has a stable ID, title, and concrete acceptance criteria. Include `guidanceTrace`, structured `legacyBaseline` and planned `legacyCoverage` when required, and scope each legacy row with `legacyScopeKeys`. Preserve the intake `sourceProvenance` and authoritative OpenAPI operation inventory; do not replace them with human claims. When the change surface is known, submit numeric `workloadSignals` with at least one observed field besides uncertainty. Use `blocked` when a mode-required source is absent: brief and feature require brief/Figma/OpenAPI; legacy requires its running baseline and inventory mapping but not a supplied OpenAPI document; figma requires Figma. Advance only after the accepted submission and refined workload are visible in `workflow_status`.

Every `artifactPaths`, manifest, baseline, and check-result path must be a portable project-relative, `/`-separated safe name. Reject absolute, traversal, control-character, backslash/non-portable, or secret-shaped paths, and never embed token, password, secret, or credential values. `token-validation.json` is valid when it is only a descriptive filename, not a credential value.
