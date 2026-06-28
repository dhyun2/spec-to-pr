# Task 33 - Evals, Hardening and Release

## Goal

Evaluate, harden, package, and prepare a release candidate for the spec-to-pr plugin.

## Why This Task Exists

The plugin must be release-ready, not merely implemented.

Release readiness requires:

- eval fixtures
- malicious input tests
- security hardening reports
- deterministic release package
- SHA-256 checksums
- release manifest
- release notes
- plugin validation
- verified, implemented, scaffolded, and planned feature status

## Non-Goals

- No npm publish
- No marketplace submission
- No GitHub Release upload
- No production deployment
- No external credential use

## Tooling

- `list_eval_suites`
- `run_eval_suite`
- `run_security_hardening_suite`
- `build_release_package`
- `verify_release_package`
- `generate_release_notes`

## Skill

`/spec-to-pr:prepare-release`

The Skill is user-triggered and has `disable-model-invocation: true`.

## Release Package Rules

The release package is allowlist-based. It includes only:

- `.claude-plugin/plugin.json`
- `.mcp.json`
- `dist/mcp/server.js`
- `dist/mcp/server.js.map`
- `package.json`
- `README.md` when present
- `LICENSE` when present
- `skills/**`
- `agents/**`
- `schemas/runtime/**`

It excludes:

- `node_modules/`
- `.git/`
- `__MACOSX/`
- `.env` files
- SQLite and DB files
- coverage output
- temp output
- runtime artifacts

## Definition of Done

- Default eval suite passes or records blockers.
- Security hardening suite passes or records blockers.
- Release package contains only allowed files.
- Release package excludes `node_modules`, `.git`, `__MACOSX`, env files, and DB files.
- SHA-256 checksums are generated.
- Release manifest is generated.
- Release notes are generated.
- Release reviewer agent can review release artifacts.
- MCP stdio exposes release readiness tools.

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
pnpm release:build 0.1.0 --dry-run
claude plugin validate . --strict
```

If `claude` CLI is unavailable, record:

```text
SKIPPED: claude CLI not available
```

## Release Checklist

- [ ] node_modules excluded
- [ ] .git excluded
- [ ] __MACOSX excluded
- [ ] env files excluded
- [ ] sqlite/db files excluded
- [ ] dist/mcp/server.js included
- [ ] .claude-plugin/plugin.json included
- [ ] .mcp.json included
- [ ] skills included
- [ ] agents included
- [ ] runtime schemas included
- [ ] package.json included
- [ ] release manifest generated
- [ ] SHA-256 checksums generated
- [ ] eval suite report generated
- [ ] security hardening report generated
- [ ] release notes generated
- [ ] plugin validate passed or skipped with reason

## Still Manual

Task 33 prepares a release candidate only. It does not publish to npm, upload a GitHub Release, submit to a marketplace, or perform customer rollout.
