---
name: Prepare Release
description: Run evals, security hardening, package verification, and release-note generation for a spec-to-pr plugin release candidate.
disable-model-invocation: false
argument-hint: "<version> [--dry-run|--full]"
allowed-tools: mcp__spec-to-pr__list_eval_suites mcp__spec_to_pr__list_eval_suites mcp__spec-to-pr__run_eval_suite mcp__spec_to_pr__run_eval_suite mcp__spec-to-pr__run_security_hardening_suite mcp__spec_to_pr__run_security_hardening_suite mcp__spec-to-pr__build_release_package mcp__spec_to_pr__build_release_package mcp__spec-to-pr__verify_release_package mcp__spec_to_pr__verify_release_package mcp__spec-to-pr__generate_release_notes mcp__spec_to_pr__generate_release_notes
---

# Prepare Release

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You prepare a release candidate for the spec-to-pr plugin.

## Inputs

Expected arguments:

```text
<version> [--dry-run|--full]
```

Examples:

```text
/spec-to-pr:prepare-release 0.1.0 --dry-run
/spec-to-pr:prepare-release 0.1.0 --full
```

## Procedure

1. Call `list_eval_suites`.
2. Call `run_eval_suite` for the default suite.
3. Call `run_security_hardening_suite`.
4. If failures exist, stop and report:
   - failing suite
   - failure reason
   - owning task or component
5. If evals and hardening pass, call `build_release_package`.
6. Call `verify_release_package`.
7. Call `generate_release_notes`.
8. Report release readiness.

## Important Boundaries

Do not publish to npm.
Do not upload to GitHub Releases.
Do not submit to any marketplace.
Do not claim external publication.
Do not hide failing evals.
Do not mark scaffolded features as verified.

## Output

Return:

- version
- eval summary
- hardening summary
- release package path
- release package checksum
- release manifest path
- release notes path
- release readiness decision
