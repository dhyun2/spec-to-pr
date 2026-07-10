# Host Parity and Documentation Accuracy Design

## Goal

Make the public documentation and the executable `SpecToPR` workflow describe and enforce the same behavior, while defining Codex/Claude parity as equivalent requirements, evidence, gates, and publish decisions rather than byte-identical generated code.

## Current Findings

- Both hosts load the same 27 shared skills and use the same bundled MCP kernel, schemas, artifact store, and deterministic services.
- Claude and Codex use different agent definition formats. Claude agents are detailed Markdown prompts under `agents/`; Codex agents are shorter TOML prompts under `.codex/agents/`.
- The main `skills/spec-to-pr/SKILL.md` describes architecture checks in the product documentation but does not allow or explicitly call `analyze_architecture_boundaries` and `generate_source_guard_tests`.
- The website says that implementation agents use Sonnet, Review Council uses Opus, and narrow reviewers use Haiku. Most Claude agent files do not declare those models, while Codex agent files declare reasoning effort but no model. The current documentation therefore overstates model pinning.
- The documentation-site footer hard-codes a release version and can drift from the package manifest.
- `website/README.md` presents `pnpm deploy` and CI as equivalent deployment paths, but the repository has a concrete GitHub Actions Pages workflow that builds and deploys the site from `main`.
- Existing tests validate manifests, MCP aliases, and selected agent files, but do not enforce semantic host parity or the main workflow's required architecture tools.

## Parity Contract

Host parity means that the same normalized inputs must be processed through the same workflow contract:

1. The same shared skill procedure and MCP service operations are available on both hosts.
2. The same source evidence, gaps, artifact schemas, and stage-state rules are used.
3. Required gates have the same pass, blocked, and publish-decision semantics.
4. Agent lanes submit the same structured `AgentResult` shape and are checked by the same validators.
5. Both hosts preserve the same safety boundaries: no invented evidence, no success without checks, no publication from a blocked report, and no merge or approval side effects.

Parity does not promise identical prose, identical code layout, identical commit hashes, identical token usage, or identical agent reasoning. Those outputs remain model- and host-dependent.

## Implementation Design

### 1. Main workflow correctness

Extend the main `SpecToPR` skill's host-aliased tool allowlist with `analyze_architecture_boundaries` and `generate_source_guard_tests`. Add an explicit architecture-gate step after integration and before final reporting. A failed architecture report or source-guard check must keep the report blocked in the same way as other mandatory gates.

Keep security split into two concepts:

- target-project security remains a mandatory `run_quality_gates` check;
- plugin release hardening remains part of the separate release workflow.

This avoids incorrectly inserting the plugin's release hardening suite into every target-project run.

### 2. Automated host-parity validation

Add tests around the repository's shipped plugin surfaces. The tests will verify:

- all shared skills that reference Claude MCP names also include the Codex alias;
- the main workflow includes both host aliases for every required architecture tool;
- every Claude agent has a corresponding Codex agent, except the documented Codex-only Design/UI repair role;
- each agent pair preserves a small set of role-specific semantic invariants, such as required evidence, forbidden scope, and structured output expectations;
- documentation counts for skills, stages, and agent surfaces are derived from or checked against repository facts where practical.

The parity test will compare explicit invariant tokens and concepts rather than requiring identical prompt text. This allows each host format to remain idiomatic while preventing critical safety instructions from silently disappearing.

### 3. Agent-definition alignment

Expand only the Codex agent prompts that are missing safety- or output-critical rules found in their Claude counterparts. Do not attempt to make the prompts byte-identical and do not add provider-specific model names to Codex definitions.

For Claude, keep existing model declarations unchanged unless they are already explicit. Documentation will state that unspecified agents inherit the active host model and that Codex definitions currently pin reasoning effort rather than a provider-equivalent model tier.

This design favors enforceable output contracts over a misleading cross-provider model mapping.

### 4. Website documentation

Add a host-parity page under the concepts section and link it from the sidebar and relevant installation/agent pages. The page will include a compact guarantee matrix:

| Area                                | Same across hosts            | May differ                                 |
| ----------------------------------- | ---------------------------- | ------------------------------------------ |
| Inputs and evidence                 | Yes                          | Source acquisition availability can differ |
| MCP schemas and stage rules         | Yes                          | Tool namespace spelling                    |
| Required gates and publish blocking | Yes                          | Command output formatting                  |
| Agent result contract               | Yes                          | Reasoning and prose                        |
| Implemented code                    | Same requirements and checks | Exact code and commit hash                 |

Correct the existing agent-model claims, explain the 27 skills versus 26 runtime stages distinction, and make optional Figma/legacy paths explicit. Preserve the existing Korean-first site structure.

### 5. Version and deployment documentation

Read the root package version in Docusaurus configuration so the footer cannot drift from `package.json`.

Keep deployment instructions out of the root project README because plugin users do not need them. Keep a maintainer-focused deployment section in `website/README.md`, with GitHub Actions as the canonical path:

- pushes to `main` that change `website/**`, `docs/tasks/**`, or the workflow trigger a build and Pages deployment;
- `pnpm build` and `pnpm serve` are the local verification path;
- manual `pnpm deploy` is not presented as the normal repository workflow.

## Data and Control Flow

The host selects and runs the shared skill. The skill calls the host-specific MCP namespace, but both namespaces enter the same MCP server and application services. Services persist normalized evidence and structured artifacts in the same Run store. Agent outputs return through host-specific orchestration, then pass through the same result validators. Architecture, quality, visual, accessibility, performance, and observability gates feed the same scorecard and PR decision policy.

Documentation parity tests guard the outer host surfaces; runtime tests continue to guard the inner deterministic services.

## Failure Handling

- Missing MCP tools remain a Doctor blocker; the workflow must not silently replace kernel operations with manual work.
- A missing host alias or agent-pair invariant fails plugin validation/tests before release.
- Architecture violations create architecture evidence and gaps and prevent a publishable decision until resolved or explicitly handled by existing policy.
- Optional inputs, such as Figma, may skip their conditional branch but must not be described as passed.
- Website build failures block documentation deployment through the existing GitHub Actions dependency between build and deploy jobs.

## Testing Strategy

Follow test-first changes for executable behavior:

1. Add failing plugin-layout/parity assertions for architecture aliases, required procedure text, and agent-pair invariants.
2. Run the focused tests and confirm the expected failures.
3. Make the minimal skill and agent-definition changes.
4. Run the focused tests until green.
5. Update website documentation and version wiring.
6. Run formatting, type checking, the full Vitest suite, Codex plugin validation, Claude strict plugin validation when the CLI is available, and a clean Docusaurus production build.

The documentation site currently lacks installed local dependencies, so verification must install `website/pnpm-lock.yaml` with `pnpm install --frozen-lockfile` before building.

## Non-Goals

- Guaranteeing byte-identical generated code across Claude and Codex.
- Building a generator that emits both agent formats from one source.
- Pinning equivalent model families across different providers.
- Changing PR/MR publishing boundaries, merge behavior, or release semantics.
- Moving site deployment instructions into the root user README.
