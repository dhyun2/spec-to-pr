# Task 14 — OpenSpec Change Generator

## Goal

Generate OpenSpec change artifacts from the Evidence Graph and Traceability Matrix.

## Why this task exists

Task 13 connects brief, Figma, OpenAPI, and gap evidence. That graph is machine-readable but not review-friendly.

Task 14 turns it into a human-reviewable OpenSpec change folder:

- proposal.md
- design.md
- tasks.md
- specs/<area>/spec.md
- artifacts/evidence-summary.md
- artifacts/traceability-matrix.md
- artifacts/gap-summary.md
- artifacts/change-manifest.json

## Inputs

- Run ID
- Evidence Graph artifact
- Traceability Matrix artifact
- change name
- target spec areas

## Outputs

- OpenSpec change folder under projectRoot
- OpenSpec ArtifactRefs in Run
- OpenSpec change manifest
- optional validation result

## Non-goals

- No OpenSpec archive
- No OpenSpec apply
- No code implementation
- No Gherkin generation
- No acceptance tests
- No PR publishing

## Rules

- Do not create requirements without source evidence.
- Do not hide gaps.
- Do not overwrite existing OpenSpec files unless explicitly forced.
- Write only inside projectRoot.
- Record generated files as ArtifactRefs.
- Generated specs must include traceability comments or links.

## Definition of Done

- Change name is validated.
- OpenSpec directory structure is created.
- proposal.md, design.md, tasks.md are generated.
- at least one specs/<area>/spec.md is generated when requirements exist.
- artifacts include evidence summary, traceability matrix, gap summary, and manifest.
- repeated generation is idempotent when content is unchanged.
- conflicting existing files are detected.
- MCP tool works through stdio integration tests.

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

- OpenSpec path tests pass.
- OpenSpec model builder tests pass.
- Markdown renderer tests pass.
- repository writer conflict tests pass.
- OpenSpecChangeService tests pass.
- MCP stdio integration can call `generate_openspec_change`.

## Known limitations

- OpenSpec CLI validation is optional in Task 14.
- Generated requirements are conservative.
- No Gherkin is generated here.
- No code implementation is performed.
- Existing conflicting files require force overwrite.
- Human review may refine proposal and design wording.
