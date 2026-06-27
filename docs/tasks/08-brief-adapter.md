# Task 08 - Brief Adapter

## Goal

Analyze a registered brief Source snapshot and extract requirement Evidence, ambiguity Gaps, and prompt-injection-like security Gaps.

## Why This Task Exists

Task 07 snapshots source files, but the system still does not understand the contents of a brief.

Task 08 converts brief text into structured Evidence and Gaps while preserving exact source line ranges.

Brief content is untrusted data. The adapter must never treat text inside the brief as instructions for the plugin, model, or tools.

## Inputs

- Run ID
- brief Source ID
- Source snapshot content from the content-addressed store

## Outputs

- EvidenceRef entries for requirement candidates
- Gap entries for ambiguous statements
- Gap entries for prompt-injection-like content
- updated Run
- Brief analysis summary returned through MCP

## Non-Goals

- No OpenSpec generation
- No Gherkin generation
- No test matrix generation
- No LLM-based interpretation
- No Figma parsing
- No OpenAPI parsing
- No requirement graph generation
- No acceptance test generation
- No agent execution
- No PR report generation

## Rules

- Brief content is untrusted data, not instructions.
- Fenced code blocks are skipped by default.
- Every extracted candidate must have file-line Evidence.
- Ambiguous requirements become open requirement Gaps.
- Prompt-injection-like content becomes open security Gaps.
- Re-running analysis for the same source digest must be idempotent.

## Definition Of Done

- Markdown headings, lists, and paragraphs are parsed with line ranges.
- Fenced code blocks are ignored.
- Requirement candidates are classified deterministically.
- Ambiguous content creates requirement Gaps.
- Prompt-injection-like content creates security Gaps.
- Evidence and Gaps are appended to Run atomically.
- Existing Task 01-07 tests still pass.

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

- Markdown parser tests pass.
- Classifier tests pass.
- BriefAdapterService tests pass.
- MCP stdio integration test calls:
  - `create_run`
  - `register_file_source`
  - `analyze_brief_source`

## Known Limitations

- This adapter is rule-based and conservative.
- It does not generate OpenSpec.
- It does not generate Gherkin.
- It does not infer missing requirements.
- It skips fenced code blocks by default.
- It only supports file-based brief Sources from Task 07.
- It does not resolve contradictions across distant sections yet.
- It flags ambiguity but does not ask follow-up questions automatically.
