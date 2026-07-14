---
name: intake-contracts
description: Use when a v2 workflow requests intake or contract preparation from a brief, OpenAPI evidence, Figma evidence, or repository context.
---

# Intake and Contracts

Start with `workflow_status`, then use `workflow_advance` to confirm the `prepare-contracts` action.

Read `deliveryProfile` and collect only supplied or repository-backed requirements:

- `brief`: read the declared `briefPath` and preserve its acceptance criteria and gaps.
- `legacy`: capture focused current-behavior evidence for the requested delta; do not inventory the whole repository. Submit `legacyBaseline` with a bounded `scope`, `evidencePaths`, and one or more `checks` containing the actual `command`, `resultPath`, and `status`. Every result path must be baseline and contract evidence, and passed contracts require passed checks.
- `figma`: use the host's connected Figma capability to fetch real nodes, screenshots, variables, assets, and component context. Before contracts, submit exactly one `kind: figma-bundle` with `provider: host-connected-figma`, ISO `capturedAt`, `fileUrl` exactly matching the delivery profile, nonempty `nodeIds`, a declared JSON `manifestPath`, and project-local `artifactPaths` containing that manifest plus one or more actual PNG files. The strict manifest repeats `provider`, `capturedAt`, `fileUrl`, and `nodeIds`, and its `visualPaths` exactly list the PNG paths. Do not use URL-only claims, repeat the bundle, poll, or add runtime Figma micro-tools.
- `feature` and `auto`: normalize requirements without adding mode-specific artifacts at intake.

Resolve applicable scope, acceptance criteria, API operations and schemas, design evidence, and explicit gaps. Never invent undocumented API or UI behavior.

Submit `contracts` with `passed`, `failed`, or `blocked`, a compact summary, artifact paths, and a nonempty `requirementManifest` when passed. Each requirement has a stable `id`, title, and concrete `acceptanceCriteria`; reviewers reference these IDs. Include structured `legacyBaseline` when the profile requires it. When the change surface is known, also submit non-negative numeric `workloadSignals` with at least one observed field besides uncertainty: requirements, relevant files, API operations, UI surfaces, Figma nodes, test targets, workspace packages, and remaining uncertainty. Counts refine the existing `XS`–`XL` display range; do not include prompt/source text or create another tool/stage. Use `blocked` when required evidence is absent. Advance only after the accepted submission and refined workload are visible in `workflow_status`.
