# Task 06 - Intake Manifest and Project Profiler

## Goal

Normalize user inputs into an IntakeManifest and inspect the target repository into a ProjectProfile.

## Why This Task Exists

Implementation agents must follow the target repository's existing conventions.

Before generating OpenSpec, API wrappers, Figma UI, or tests, the plugin must know:

- Git root
- package manager
- workspace layout
- framework
- build tool
- test runner
- TypeScript setup
- FSD structure
- design-system candidates
- API generator candidates
- generated client locations
- available scripts

## Non-Goals

- No source content snapshot
- No SHA-256 digest calculation
- No brief parsing
- No Figma MCP call
- No OpenAPI parsing
- No package installation
- No test/build command execution
- No agent execution
- No PR publishing

## Outputs

- IntakeManifest
- ProjectProfile
- ProfileFinding
- MCP tools:
  - `create_intake_manifest`
  - `inspect_project`
  - `get_project_profile`
  - `list_project_profiles`

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

Expected:

- IntakeManifest contract exists.
- ProjectProfile contract exists.
- safe ProjectProbe exists.
- Git detector exists.
- package manager detector exists.
- workspace detector exists.
- framework/tooling detector exists.
- FSD detector exists.
- design-system detector exists.
- API generation detector exists.
- ProjectProfileService exists.
- `create_intake_manifest` MCP tool exists.
- `inspect_project` MCP tool exists.
- `get_project_profile` MCP tool exists.
- `list_project_profiles` MCP tool exists.
- fixture based profiler test passes.
- MCP stdio integration test passes.

## Known Limitations

- No source content snapshot yet.
- No SHA-256 digest calculation yet.
- No brief requirement extraction.
- No Figma node analysis.
- No OpenAPI parsing or bundling.
- No OpenSpec or Gherkin generation.
- No API wrapper or UI implementation.
- No agent execution.
