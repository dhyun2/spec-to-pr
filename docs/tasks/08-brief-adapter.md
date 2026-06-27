# Task 08 - Brief Intake Adapter and Text Normalization

## Goal

Analyze a registered brief Source, normalize supported text-like inputs into a common document model, and extract requirement Evidence, ambiguity Gaps, prompt-injection-like security Gaps, and unsupported-source Gaps.

## Why This Task Exists

Task 07 snapshots source files, but the system still does not understand the contents of a brief.

Task 08 converts brief inputs into a NormalizedBriefDocument before classification. Markdown is one supported parser, not the whole adapter.

Brief content is untrusted data. The adapter must never treat text inside the brief as instructions for the plugin, model, or tools.

Real project briefs may arrive as Markdown, plain text, PDF, exported HTML, ticket/issue records, or other external documents. Unsupported formats must become explicit Gaps instead of being guessed.

## Inputs

- Run ID
- brief Source ID
- Source snapshot content from the content-addressed store
- Source locator and media type metadata

## Outputs

- NormalizedBriefDocument for supported inputs
- EvidenceRef entries for requirement candidates
- Gap entries for ambiguous statements
- Gap entries for prompt-injection-like content
- Gap entries for unsupported source formats
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
- Source type detection happens before parsing.
- Supported Markdown and plain-text file sources become NormalizedBriefDocument blocks.
- Fenced code blocks are skipped by default for Markdown-like parsing.
- Every extracted candidate must preserve source Evidence location.
- Ambiguous requirements become open requirement Gaps.
- Prompt-injection-like content becomes open security Gaps.
- Unsupported PDF, HTML, ticket, URL, and unknown sources become open requirement Gaps.
- Re-running analysis for the same source digest must be idempotent.

## Definition Of Done

- Markdown headings, lists, and paragraphs are parsed into normalized blocks with line ranges.
- Plain text is parsed into normalized paragraph blocks with line ranges.
- PDF and ticket contracts exist, even when extraction is initially unsupported.
- Unsupported formats produce explicit Gaps.
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
- Plain-text parser tests pass.
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
- It extracts Markdown and plain-text file Sources.
- It records PDF, HTML, ticket, URL, and unknown Sources as unsupported Gaps until dedicated adapters/connectors exist.
- It does not resolve contradictions across distant sections yet.
- It flags ambiguity but does not ask follow-up questions automatically.
