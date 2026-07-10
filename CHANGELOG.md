# Changelog

All notable changes to spec-to-pr are documented in this file.

The project follows semantic versioning for Claude Code and Codex plugin releases. Release tags
use the plugin tag format, for example `spec-to-pr--v0.1.0`.

## Unreleased

## 0.1.0 - 2026-07-10

### Added

- Established the first public SpecToPR plugin release for Claude Code and Codex with aligned root
  package metadata, plugin manifests, marketplace metadata, Codex SDK runner metadata, and release
  tag naming.
- Added the bundled stdio MCP runtime, durable Run ledger, source registry, evidence graph,
  traceability matrix, OpenSpec generation, Gherkin generation, API contract pipeline, design
  contract generation, agent lane orchestration, integration flow, quality gates, review scorecard,
  PR/MR report generation, review publishing, archive workflow, and release verification pipeline.
- Added legacy migration evidence support for route/component/store/API/native bridge/URL open/
  analytics/environment/query/hash inventory, feature coverage matrices, blocker gap tracking, and
  legacy screenshot visual baselines.
- Added a Docusaurus documentation site under `website/`, published to GitHub Pages at
  https://dhyun2.github.io/spec-to-pr/, with full-text search (Korean + English), dark mode,
  and a GitHub Actions deploy workflow (`.github/workflows/deploy-docs.yml`).
- Added a getting-started track (prerequisites checklist, Claude Code/Codex installation tabs,
  end-to-end quickstart to the first draft PR) and a usage cookbook with nine copy-paste prompt
  recipes covering brief+Figma+OpenAPI intake, legacy-project-as-spec migration, hybrid intake,
  publish/gate policies, partial skill runs, and run resumption.
- Added concept pages for the 26-stage pipeline, subagent lanes (worktree isolation, context
  packs, review council), the 9-dimension review scorecard with the bounded loop model, and the
  SQLite/MCP storage architecture.
- Added reference pages for all 27 skills, host-specific agent surfaces, environment
  variables, the T01–T33 dependency graph, a 40-plus-entry glossary, and a troubleshooting FAQ.
- Added host-parity documentation defining equivalence as shared requirements, evidence, gates,
  structured results, and publish decisions rather than byte-identical generated code.

### Changed

- Rewrote all 33 task documents in `docs/tasks/` onto a unified template (purpose, inputs,
  outputs, predecessor/parallel tasks, flow, definition of done, verification, known limits) with
  code-verified details, including the API drift definition (T16), integration repair budget of 2
  attempts (T23), Core Web Vitals thresholds (T28), redaction rule examples (T29), and the
  two-layer review-council re-review bound (T22). Task docs now double as the docs-site source.
- Replaced the single-file HTML guide (`docs/guide/index.html`) with the Docusaurus site and
  pointed both READMEs at the hosted documentation URL.
- Aligned Claude and Codex workflow instructions for architecture gates, evidence contracts, agent
  outputs, integration ordering, and Review Council behavior.
- Simplified reviewer-facing PR/MR bodies by removing internal Run metadata while keeping the full
  audit report in local artifacts.
- Kept side-by-side Figma/legacy baseline, target, and diff previews in PR/MR reports without
  exposing internal artifact IDs.
- Standardized the public product name as `SpecToPR`; repository, package, marketplace, and command
  identifiers remain `spec-to-pr`.
- Made the documentation footer read the root package version so the website cannot drift from the
  released plugin version.
- Added root/global stylesheet discovery for legacy projects so migration inventories include CSS,
  SCSS, Sass, and Less files that influence the target project even when those styles sit above or
  outside the provided legacy project path.
- Added scorecard safeguards for stale feature coverage matrices, missing official visual
  comparison reports, publish body synchronization, resource contracts, API contracts, visual
  parity, implementation evidence, Gherkin coverage, and TDD evidence.

### Fixed

- Normalized review scorecard `minimumScore` thresholds so `0.85` is interpreted as `8.5/10`, not
  `0.85/10`.
- Reused existing open legacy coverage blocker gaps when rebuilding coverage matrices for the same
  legacy feature.
- Merged repeated traceability rows before rendering OpenSpec requirements so duplicate rows do not
  create duplicate requirements.
- Kept the bundled MCP server id on `spec_to_pr` so Codex derives the stable
  `mcp__spec_to_pr__*` callable namespace.
- Corrected documentation that overstated fixed Claude model tiers and clarified semantic
  Claude/Codex parity guarantees.
- Corrected the `tdd-evidence` documentation to describe executable automated-test evidence rather
  than claiming that red-to-green history is directly verified.
- Removed the legacy `s→` documentation navbar mark so the only public-facing product brand is
  `SpecToPR`; `spec-to-pr` remains only as the repository, package, marketplace, and command ID.

### Verified

- `pnpm check`
- `pnpm plugin:validate`
- `pnpm --dir packages/codex-sdk typecheck && pnpm --dir packages/codex-sdk build`
- `pnpm --dir website typecheck && pnpm --dir website build`
- `pnpm release:build 0.1.0 --dry-run`
