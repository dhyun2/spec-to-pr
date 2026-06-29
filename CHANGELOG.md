# Changelog

All notable changes to spec-to-pr are documented in this file.

The project follows semantic versioning for Claude Code plugin releases. Release tags should use
the Claude plugin tag format, for example `spec-to-pr--v0.1.0`.

## Unreleased

### Added

- Added release publishing scripts that bundle verification, package dry-run, git push, Claude
  plugin tagging, and local Claude/Codex marketplace updates.

## 0.1.6 - 2026-06-29

### Added

- Added first-class `instruction` sources for capturing the original user request as durable Run
  evidence.
- Added `parse_intake_request` to snapshot user prompts and deterministically extract docs, Figma
  URLs, branches, validation commands, publish intent, merge boundaries, and OpenSpec archive
  policy.
- Added parsed intake request artifacts so downstream PR/MR reports can trace decisions back to the
  request that initiated the workflow.
- Added Korean PR/MR report rendering and made `generate_pr_report` default to Korean unless the
  caller explicitly requests English.
- Added localized visual evidence previews in published PR/MR bodies so Figma, browser, and diff PNG
  links render with the report language.

### Changed

- Updated the end-to-end Spec To PR skill to parse and record the original user request before
  registering derived brief, Figma, and OpenAPI sources.
- Updated Spec To PR, PR report, publish, and Codex SDK instructions to require lint, typecheck,
  build, functional, OpenSpec, accessibility, performance/Web Vitals, security, observability, and
  Figma visual comparison evidence before publishing.
- Added `security` to quality-gate planning so projects with `test:security`, `security`, or `audit`
  scripts are surfaced as required release evidence.

### Fixed

- Blocked reports with missing mandatory gate evidence instead of allowing them to appear as draft or
  ready for publish.
- Required runtime verification to include lint, typecheck, and build rather than treating any single
  runtime check as enough evidence.

## 0.1.5 - 2026-06-29

### Fixed

- Prevented `build_evidence_graph` from failing when generated traceability gap titles exceed the
  runtime 200-character title limit.
- Preserved the full long requirement label in gap metadata while using a compact title for API and
  Figma traceability gaps.

## 0.1.4 - 2026-06-29

### Fixed

- Added Codex MCP namespace aliases to shared skills so Codex can call
  `mcp__spec_to_pr__*` tools while Claude Code can continue using
  `mcp__spec-to-pr__*` tools.
- Reworded skill procedures to use host-neutral MCP tool names and avoid steering Codex toward
  Claude-only tool prefixes.
- Removed a stray `Task` token from the accessibility gate skill allowed-tools list.

### Changed

- Extended Codex plugin validation and layout tests to catch missing Codex MCP aliases before
  release.

## 0.1.3 - 2026-06-29

### Added

- Added a Codex plugin manifest and repo-local Codex marketplace catalog.
- Added a Codex SDK runner scaffold for programmatic spec-to-pr automation.
- Added Codex review-agent profiles and a bounded visual repair loop policy.
- Added a shared visual repair loop skill for repeated Design/UI repair until visual evidence passes.
- Added an end-to-end `Spec To PR` skill that publishes a draft PR/MR when the PR report is not blocked.
- Added PR/MR visual evidence previews that upload Figma, browser, and diff PNGs during publishing.
- Added Codex plugin validation to the root plugin validation script.
- Added Codex integration documentation.

### Changed

- Relaxed shared skill frontmatter so the same skills can be ingested by Codex.
- Expanded release packaging and verification to include the Codex plugin and SDK runner files.
- Clarified that publishing creates or updates a draft PR/MR from the generated PR report body, but never merges.
- Preserved local visual artifact IDs in PR/MR bodies while linking uploaded images for reviewer-friendly comparison.

## 0.1.2 - 2026-06-29

### Fixed

- Block PR reports when no quality gates are present, so incomplete runs cannot be presented as
  review-ready.
- Block Figma-backed PR reports when no visual comparison evidence is attached.
- Prevent blocked reports from being published to GitHub or GitLab while still recording the
  blocked publish attempt as an artifact.

### Changed

- Expanded PR reports with gate summaries, Figma provider capability, Figma design-system
  inventory, and explicit screenshot comparison evidence.
- Updated PR reporting and review publishing skills so agents stop before publishing blocked
  workflows.
- Aligned `plugin.json`, `marketplace.json`, and package metadata on version `0.1.2`.

### Verified

- `claude plugin validate .claude-plugin/plugin.json --strict`
- `claude plugin validate .claude-plugin/marketplace.json --strict`
- `pnpm release:build 0.1.2 --dry-run`
- `pnpm check`

## 0.1.1 - 2026-06-29

### Changed

- Licensed the Claude Code plugin release under MIT and added the repository `LICENSE` file.
- Aligned `plugin.json`, `marketplace.json`, and package metadata on version `0.1.1`.
- Kept marketplace installation on an HTTPS git source so users do not need GitHub SSH keys.

### Verified

- `claude plugin validate .claude-plugin/plugin.json --strict`
- `claude plugin validate .claude-plugin/marketplace.json --strict`
- `pnpm release:build 0.1.1 --dry-run`

## 0.1.0 - 2026-06-29

### Added

- Initial Claude Code agent plugin release for evidence-driven spec-to-pr automation.
- Added Claude plugin packaging with `skills/`, `agents/`, and a bundled stdio MCP server.
- Added 25 workflow skills covering brief intake, Figma intake, OpenAPI analysis, OpenSpec,
  Gherkin, API pipeline generation, design contracts, agent runtime preparation, quality gates,
  integration, PR reporting, publishing, release preparation, and archive workflows.
- Added 15 specialized agents for Spec-BDD, API contract, design UI, review council, integration,
  accessibility, visual regression, performance, observability, PR report, publishing, release,
  OpenSpec archive, security hardening, and eval review workflows.
- Added a bundled MCP kernel with 101 tools for run lifecycle management, project profiling,
  source registry snapshots, evidence graph construction, traceability, OpenSpec generation,
  OpenAPI intake, Figma capability recording, agent lane orchestration, quality gates, review
  publishing, release packaging, and post-merge archive support.
- Added SQLite-backed run persistence, stage state management, resumability helpers, and
  content-addressed artifact/source registry primitives.
- Added deterministic runtime schemas under `schemas/runtime/` for run manifests, summaries,
  source refs, evidence refs, artifacts, decisions, gaps, checks, and agent results.
- Added release-readiness workflows for eval fixtures, security hardening checks, deterministic
  release zip generation, checksums, manifest generation, package verification, and generated
  release notes.
- Added marketplace metadata for installing the plugin from a Claude Code plugin marketplace.

### Verified

- `claude plugin validate . --strict`
- `pnpm release:build 0.1.0 --dry-run`

### Notes

- This release prepares and validates a Claude Code plugin release candidate. Publishing to npm,
  GitHub Releases, or a hosted marketplace is still a separate maintainer action.
