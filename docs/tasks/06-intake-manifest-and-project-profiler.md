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
