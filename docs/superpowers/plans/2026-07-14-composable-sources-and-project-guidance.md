# Composable Sources and Project Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded composable sources, project-guidance discovery, optional installed-skill routing, and a correct zero-to-100 feature guide.

**Architecture:** Extend the existing v2 delivery profile instead of adding modes or stages. `WorkflowService.start` reads bounded project-local source files, records each through the existing intake service, excludes general guidance from scope inference, and stores normalized paths/hints in the delivery profile. SDK/CLI and skills expose the same contract, while reviewers and the PR report consume only compact path/hint traceability.

**Tech Stack:** TypeScript, Zod, Vitest, Codex SDK runner, Markdown/Docusaurus.

## Global Constraints

- Keep exactly seven public MCP tools, eight workflow stages, nine SpecToPR skills, and two reviewer roles.
- Do not recursively scan project docs or installed skills.
- Resolve every supplied file inside the canonical project root and cap each file at 1 MB.
- Keep API and UI in one implementation context.
- Feature mode alone requires focused E2E and one video; any supplied Figma URL requires a real Figma bundle.
- Preserve legacy `briefPath`, `figmaUrl`, `docsPath`, and `openApiPath` inputs while adding repeatable inputs.

---

### Task 1: Runtime source and guidance contract

**Files:**

- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/workflow/delivery-policy.ts`
- Modify: `src/application/workflow-service.ts`
- Test: `tests/unit/workflow-contracts.test.ts`
- Test: `tests/unit/delivery-policy.test.ts`
- Test: `tests/integration/workflow-service.test.ts`

**Interfaces:**

- Consumes: existing `WorkflowStartInputSchema`, `DeliveryProfileSchema`, and `readProjectTextFile` safety boundary.
- Produces: normalized `docsPaths`, `openApiPaths`, `guidancePaths`, `skillHints`, and `discoveredGuidancePaths` on the delivery profile.

```ts
type ComposableSourceInput = {
  docsPaths: string[];
  openApiPaths: string[];
  guidancePaths: string[];
  skillHints: string[];
};

type GuidanceTrace = {
  explicit: string[];
  discovered: string[];
  skillHints: string[];
};
```

- [ ] Add failing schema and integration tests for bounded arrays, missing explicit guidance, common guidance discovery, feature+brief+Figma composition, and guidance that does not activate unrelated gates.
- [ ] Run `pnpm vitest run tests/unit/workflow-contracts.test.ts tests/unit/delivery-policy.test.ts tests/integration/workflow-service.test.ts` and confirm the new assertions fail for missing fields/behavior.
- [ ] Implement fixed-candidate discovery, canonical root/regular-file/1 MB validation, deduplication, durable intake artifacts, and source-aware scope/workload classification.
- [ ] Make `figmaBundle` depend on a supplied Figma URL rather than only `mode: figma`.
- [ ] Require passed contracts to report every applied guidance path and keep optional skill hints traceable.
- [ ] Re-run the focused tests and require all to pass.

### Task 2: SDK and repeatable CLI sources

**Files:**

- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `packages/codex-sdk/src/cli.ts`
- Modify: generated `packages/codex-sdk/dist/**`
- Test: `tests/unit/codex-sdk-workflow-policy.test.ts`
- Test: `tests/unit/codex-sdk-budget.test.ts`

**Interfaces:**

- Consumes: Task 1 delivery fields.
- Produces: `docsPaths`, `openApiPaths`, `guidancePaths`, and `skillHints` SDK inputs plus repeatable `--docs`, `--openapi`, `--guidance`, and `--skill` flags.

```ts
type SpecToPrCodexRunInput = {
  docsPath?: string;
  docsPaths?: string[];
  openApiPath?: string;
  openApiPaths?: string[];
  guidancePaths?: string[];
  skillHints?: string[];
};
```

- [ ] Add failing prompt/CLI tests proving all repeated values are preserved, feature+brief resolves to feature when explicitly selected, and skill hints are optional availability checks rather than assumed capabilities.
- [ ] Run the focused SDK tests and confirm RED.
- [ ] Normalize legacy singular inputs with the new arrays, render all sources in the prompt and `workflow_start` fields, and state the project-guidance precedence rules.
- [ ] Rebuild SDK dist with `pnpm sdk:build` and re-run the focused tests.

### Task 3: Skills, reviewers, PR traceability, and public guide

**Files:**

- Modify: `skills/spec-to-pr/SKILL.md`
- Modify: `skills/intake-contracts/SKILL.md`
- Modify: `skills/implement/SKILL.md`
- Modify: `skills/review-functional/SKILL.md`
- Modify: `skills/review-design/SKILL.md`
- Modify: `agents/functional-reviewer.md`
- Modify: `agents/design-reviewer.md`
- Modify: `.codex/agents/spec-to-pr-functional-reviewer.toml`
- Modify: `.codex/agents/spec-to-pr-design-reviewer.toml`
- Modify: `README.md`, `README.ko.md`, `packages/codex-sdk/README.md`
- Modify: `website/docs/usage/recipes.md`, `website/docs/reference/config.md`, `website/docs/reference/skills.md`, `website/docs/concepts/pipeline.md`, `website/docs/troubleshooting.md`
- Modify: `src/application/workflow-service.ts`
- Test: `tests/plugin/documentation-v2.test.ts`
- Test: `tests/plugin/layout.test.ts`

**Interfaces:**

- Consumes: normalized delivery profile and contracts guidance traceability from Tasks 1-2.
- Produces: reviewer-verifiable guidance/skill sections in the PR report and a complete zero-to-100 recipe.

```text
mode: feature
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiPaths: [docs/openapi.yaml]
docsPaths: [docs/business-rules.md, docs/error-cases.md]
guidancePaths: [docs/architecture/ARCHITECTURE.md, docs/etc/folder-structure.md]
skillHints: [react-best-practices, next-best-practices, design-system, api-generator]
```

- [ ] Add failing documentation/layout/report assertions for source-vs-mode wording, the zero-to-100 example, project guidance precedence, optional skill fallback, and PR guidance traceability.
- [ ] Run the focused plugin/workflow tests and confirm RED.
- [ ] Update the nine-skill workflow without adding a tenth skill, keep Markdown/TOML reviewer parity, and document how React/Next/design/API skills are selected only when available.
- [ ] Update all maintained guides and generated PR Markdown.
- [ ] Re-run focused tests, plugin validation, website typecheck, and website build.

### Task 4: Integration and release safety

**Files:**

- Verify: `packages/codex-sdk/dist/**`
- Verify: `schemas/runtime/**`
- Verify: `dist/mcp/server.js`
- Verify: `artifacts/releases/spec-to-pr-0.2.0.zip`

**Interfaces:**

- Consumes: Tasks 1-3.
- Produces: a clean, generated-output-synchronized commit.

- [ ] Run `pnpm sdk:build`, `pnpm schemas:build`, and `pnpm build`.
- [ ] Run `pnpm check`, `pnpm plugin:validate`, `pnpm --dir website typecheck`, and `pnpm --dir website build`.
- [ ] Commit the complete implementation, rerun `pnpm check` from the clean commit, and run `pnpm release:build 0.2.0 --dry-run` only as archive regression evidence; do not retag or republish 0.2.0.
