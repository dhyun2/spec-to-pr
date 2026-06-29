# Changelog

All notable changes to spec-to-pr are documented in this file.

The project follows semantic versioning for Claude Code plugin releases. Release tags should use
the Claude plugin tag format, for example `spec-to-pr--v0.1.0`.

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
- The package currently declares `UNLICENSED`; choose a public license before broad public
  redistribution.
