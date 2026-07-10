# Host Parity and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce Codex/Claude workflow parity for required architecture checks and document the actual guarantees, deployment path, and host-specific behavior.

**Architecture:** Keep the MCP kernel and shared skills as the parity boundary. Add repository-surface tests for host aliases and agent invariants, then align the main skill and Codex agent prompts to those checks. Update the Docusaurus documentation to describe semantic, not byte-level, parity.

**Tech Stack:** TypeScript, Vitest, Zod, Markdown/MDX, Docusaurus 3, pnpm.

## Global Constraints

- Parity means equivalent inputs, evidence, required gates, structured results, and publish decisions; it never means byte-identical generated code.
- The main target-project workflow requires architecture, quality, and conditional visual/accessibility/performance/observability evidence before a publishable report.
- Release hardening remains a separate plugin-release workflow.
- Website content remains Korean-first.
- Root README stays user-focused; deployment details belong in `website/README.md`.

---

### Task 1: Add host-parity regression tests

**Files:**

- Modify: `tests/plugin/layout.test.ts`
- Test: `tests/plugin/layout.test.ts`

**Interfaces:**

- Consumes: shipped `skills/*/SKILL.md`, `agents/*.md`, `.codex/agents/*.toml`
- Produces: a regression guard that rejects missing aliases, architecture steps, or host agent coverage

- [ ] **Step 1: Add failing assertions for architecture aliases and procedure text**

```ts
for (const toolName of ["analyze_architecture_boundaries", "generate_source_guard_tests"]) {
  expect(contents).toContain(`mcp__spec-to-pr__${toolName}`);
  expect(contents).toContain(`mcp__spec_to_pr__${toolName}`);
}
expect(contents).toContain("Run the architecture gate after integration");
```

- [ ] **Step 2: Add failing agent-pair coverage assertions**

```ts
const claudeAgents = readdirSync(path.join(root, "agents"))
  .filter((file) => file.endsWith(".md"))
  .map((file) => file.replace(/\.md$/, ""));

for (const agent of claudeAgents) {
  expect(existsSync(path.join(root, ".codex", "agents", `spec-to-pr-${agent}.toml`))).toBe(true);
}
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `pnpm vitest run tests/plugin/layout.test.ts`

Expected: FAIL because `SpecToPR` does not yet expose the two architecture tools or the architecture-gate procedure.

- [ ] **Step 4: Add role-specific Codex invariants that protect output contracts**

```ts
const codexAgentInvariants = {
  "api-contract": ["documented API evidence", "structured AgentResult"],
  "design-ui": ["Modify only allowed files", "structured AgentResult"],
  "review-council": ["Do not approve missing evidence", "structured findings"],
} as const;
```

- [ ] **Step 5: Re-run the focused test and retain expected RED failures**

Run: `pnpm vitest run tests/plugin/layout.test.ts`

Expected: FAIL only for missing implementation invariants, not syntax or test setup errors.

### Task 2: Make the executable workflow meet the contract

**Files:**

- Modify: `skills/spec-to-pr/SKILL.md`
- Modify: `.codex/agents/spec-to-pr-api-contract.toml`
- Modify: `.codex/agents/spec-to-pr-design-ui.toml`
- Modify: `.codex/agents/spec-to-pr-review-council.toml`
- Test: `tests/plugin/layout.test.ts`

**Interfaces:**

- Consumes: `mcp__spec-to-pr__*` and `mcp__spec_to_pr__*` host aliases
- Produces: mandatory architecture evidence before final reporting and Codex prompts with the protected AgentResult semantics

- [ ] **Step 1: Extend the main skill allowlist with both architecture tool namespaces**

Add these exact alias pairs to `allowed-tools`:

```yaml
mcp__spec-to-pr__analyze_architecture_boundaries mcp__spec_to_pr__analyze_architecture_boundaries
mcp__spec-to-pr__generate_source_guard_tests mcp__spec_to_pr__generate_source_guard_tests
```

- [ ] **Step 2: Add the architecture-gate procedure after integration**

```md
Run the architecture gate after integration and before final reporting:

- Call `analyze_architecture_boundaries` and `generate_source_guard_tests`.
- Record architecture evidence and run the generated source guards when the target project supports them.
- If architecture violations or source-guard checks remain unresolved, keep the PR report blocked.
```

- [ ] **Step 3: Align the three Codex agent prompts with contract-critical language**

Add only these requirements:

- API Contract: do not invent endpoints/fields/errors; include changed files, checks, gaps, and evidence in its `AgentResult`.
- Design/UI: do not call raw `fetch` or generated clients; do not claim tests/visual checks passed without `CheckResult` evidence.
- Review Council: include blockers, major, minor, and info in structured findings; do not approve skipped checks described as passed.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run tests/plugin/layout.test.ts`

Expected: PASS with every plugin-layout and host-parity assertion green.

### Task 3: Update parity, model, and pipeline documentation

**Files:**

- Create: `website/docs/concepts/host-parity.md`
- Modify: `website/sidebars.ts`
- Modify: `website/docs/getting-started/installation.mdx`
- Modify: `website/docs/reference/agents.md`
- Modify: `website/docs/concepts/subagents.md`
- Modify: `website/docs/getting-started/quickstart.md`

**Interfaces:**

- Consumes: actual shared skill count, runtime stage list, host agent files, and MCP namespaces
- Produces: explicit semantic-parity guarantees and accurate model/dependency wording

- [ ] **Step 1: Add a Korean host-parity page**

The page must include this matrix and a non-guarantee statement:

```md
| 영역                          | 두 호스트에서 동일      | 달라질 수 있는 것     |
| ----------------------------- | ----------------------- | --------------------- |
| 증거·Run 스키마·스테이지 규칙 | 동일 MCP kernel         | tool namespace 표기   |
| 필수 gate·발행 차단           | 동일 판정 정책          | 명령 로그 형식        |
| AgentResult 계약              | 동일 검증기             | 추론 과정·설명 문장   |
| 구현 코드                     | 동일 요구사항·검증 기준 | 정확한 코드·커밋 해시 |
```

- [ ] **Step 2: Link the page from concepts navigation and installation**

Add `"concepts/host-parity"` after `"concepts/subagents"` in the guide sidebar and link it from the installation page's host description.

- [ ] **Step 3: Correct model claims**

Replace claims of fixed Sonnet/Opus/Haiku allocation with: Claude agents without `model` inherit the active session model; Codex agents currently request high reasoning effort; both hosts enforce the same result and gate contracts.

- [ ] **Step 4: Correct pipeline language**

State that there are 27 callable skills and 26 persisted runtime stages; Figma-dependent visual steps and legacy coverage are conditional branches. Include architecture in the quickstart gate summary.

### Task 4: Eliminate version and deployment-document drift

**Files:**

- Modify: `website/docusaurus.config.ts`
- Modify: `website/README.md`

**Interfaces:**

- Consumes: root `package.json` version and `.github/workflows/deploy-docs.yml`
- Produces: footer version from package metadata and CI-first maintainer deployment instructions

- [ ] **Step 1: Load the root package version into Docusaurus config**

```ts
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
```

Use `${version}` in the footer copyright string.

- [ ] **Step 2: Replace ambiguous manual deployment copy**

Document the `deploy-docs.yml` triggers, Pages build/deploy flow, and local `pnpm build` / `pnpm serve` verification. Do not present `pnpm deploy` as the repository's standard deployment command.

- [ ] **Step 3: Run a website type check**

Run: `pnpm --dir website typecheck`

Expected: PASS after website dependencies are installed from the existing lockfile.

### Task 5: Verify the integrated change

**Files:**

- Verify: changed files from Tasks 1–4

- [ ] **Step 1: Format changed files**

Run: `pnpm exec prettier --write tests/plugin/layout.test.ts skills/spec-to-pr/SKILL.md .codex/agents/*.toml website/docusaurus.config.ts website/docs/**/*.md website/docs/**/*.mdx website/README.md`

- [ ] **Step 2: Run root checks**

Run: `pnpm format:check && pnpm typecheck && pnpm test && ./node_modules/.bin/tsx scripts/validate-codex-plugin.ts`

Expected: all commands exit 0.

- [ ] **Step 3: Install website dependencies and build production docs**

Run: `pnpm --dir website install --frozen-lockfile && pnpm --dir website build`

Expected: Docusaurus build exits 0 with no broken links.

- [ ] **Step 4: Inspect final diff and report verified limitations**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; report that exact generated code remains intentionally non-deterministic across hosts.
