# Composable Sources and Project Guidance Design

**Approved:** 2026-07-14

## Goal

Make zero-to-100 feature delivery consume a brief, Figma, OpenAPI, supporting documents, project architecture guidance, and relevant installed skills without turning every Run into a repository-wide scan.

## Problem

The current workflow treats `brief` and `figma` as modes even though they are also input sources. A `brief` Run may include a Figma URL and API docs, but the public recipe does not show that composition. `workflow_start` exposes only one brief and one Figma field, while the SDK hides supporting docs and OpenAPI paths inside its prompt. Project-specific rules such as `AGENTS.md`, `CLAUDE.md`, `docs/architecture/ARCHITECTURE.md`, and `docs/etc/folder-structure.md` are not represented in the durable delivery profile. Optional installed skills such as React, Next.js, design-system, Figma, and API-generation guidance are also not routed explicitly.

## Decisions

### Delivery mode and sources

Delivery mode describes the evidence and publication behavior. Sources are composable inputs.

- `feature` is the zero-to-100 user-facing feature profile. It requires the focused E2E and one video regardless of whether its sources include a brief.
- `brief` remains the lighter brief-to-PR profile and does not automatically add feature video cost.
- `figma` remains valid when Figma is the primary or only source.
- Any supplied Figma URL requires real Figma bundle evidence, including in `feature` mode.

`workflow_start` keeps `briefPath` and `figmaUrl` for compatibility and adds bounded arrays for supporting documents, OpenAPI files, project guidance files, and optional installed-skill hints. The SDK and CLI expose the same concepts and allow repeatable source flags.

### Bounded project-guidance discovery

The runtime checks only a fixed root-relative candidate set plus explicit `guidancePaths`:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/etc/folder-structure.md`

It does not recursively scan `docs/` or every installed skill. Explicit paths must exist; missing automatic candidates are ignored. Every accepted path must resolve inside the project root to a regular file no larger than 1 MB. Inputs are deduplicated and capped before reads.

Guidance content is ingested as durable instruction evidence but is excluded from scope classification so a general architecture document cannot incorrectly activate UI, API, or security gates. Briefs, supporting docs, and OpenAPI sources do participate in scope and workload classification.

### Optional installed-skill routing

`skillHints` are names, not filesystem paths and not copied skill contents. The orchestrator asks the host to use a named installed skill only when it is available and applicable. Missing optional skills do not block the Run; required project guidance still does. Recommended hints for a React/Next.js API-backed UI are `react-best-practices`, `next-best-practices`, `frontend-patterns`, `design-system`, and `api-generator`.

Project guidance wins over generic skill advice when they conflict. The precedence order is:

1. current user request;
2. explicit `guidancePaths`;
3. automatically discovered project guidance;
4. applicable installed skills;
5. SpecToPR defaults.

### Traceability

The delivery profile exposes the normalized source and guidance paths plus skill hints. Passed contracts report which guidance paths and skill hints were applied. The PR report includes those lists so functional and design reviewers can verify that implementation follows project-local structure, design-system, and API conventions.

## Safety and weight limits

- No recursive project-document inventory.
- No reading arbitrary files outside the canonical project root.
- Maximum 20 entries per supporting/guidance source class and 20 skill hints.
- Maximum 1 MB per text source.
- No prompt, source body, or installed skill body is copied into workload calibration.
- Missing required source or explicit guidance is a blocker, not permission to invent behavior.

## Documentation

The maintained guide will include a zero-to-100 feature recipe with `mode: feature`, brief, Figma, OpenAPI, supporting docs, project guidance, skill hints, focused E2E, one video, independent functional/design review, and draft publication. Configuration and troubleshooting pages will document discovery, precedence, optional-skill fallback, and the difference between a delivery mode and an input source.

## Verification

- Unit contracts reject over-limit, duplicate-conflict, outside-root, missing explicit, and invalid hint inputs.
- Integration tests prove feature+brief+Figma+OpenAPI+guidance ingestion, Figma bundle applicability, and guidance exclusion from false gate classification.
- SDK tests prove repeatable sources and skill hints appear in prompts without forcing unavailable skills.
- Plugin documentation/layout tests keep skills and the guide synchronized.
- Full build, tests, plugin validation, website typecheck/build, and release archive dry-run remain green.
