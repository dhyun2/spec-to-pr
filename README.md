# SpecToPR

Take a brief, legacy application, feature request, or Figma design through implementation, verification, and an evidence-backed draft PR.

[한국어](README.ko.md) · [Documentation](https://dhyun2.github.io/spec-to-pr/en/) · [Choose a use case](https://dhyun2.github.io/spec-to-pr/en/usage/)

## Install

Requirements: Node.js 22+, Git, and Claude Code or Codex.

### Claude Code

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

### Codex

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

Restart the host, start a new task, and verify the installation:

```text
/spec-to-pr:doctor
```

[See the complete installation guide](https://dhyun2.github.io/spec-to-pr/en/getting-started/installation).

## Choose a use case

| Use case                                                                        | What you provide                                     | What you get                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Brief-based delivery](https://dhyun2.github.io/spec-to-pr/en/usage/brief)      | Brief/PDF/MD, Figma URL, and OpenAPI                 | Implemented API/UI, visual comparison, API gaps, Web Vitals, and a draft PR          |
| [Legacy migration](https://dhyun2.github.io/spec-to-pr/en/usage/legacy)         | Target repository and a separate legacy project path | Migration based on the running legacy application, visual comparison, and a draft PR |
| [Single-feature delivery](https://dhyun2.github.io/spec-to-pr/en/usage/feature) | Brief, Figma, and API sources for one feature        | Full verification, targeted E2E, one video, and a draft PR                           |
| [Figma implementation](https://dhyun2.github.io/spec-to-pr/en/usage/figma)      | Figma URL and target repository                      | Mock-backed UI, measured Figma comparison, and a draft PR                            |

Start every request with the target repository:

```text
/spec-to-pr /absolute/path/to/project
```

Then copy the prompt from the guide for your use case. The guide explains required inputs, the execution pipeline, validation evidence, blockers, and the expected draft PR.

## Current release

SpecToPR exposes 7 MCP tools, 8 durable stages, 8 skills, and 2 independent reviewers. The four strict UI modes are `brief`, `legacy`, `feature`, and `figma`.

Composable intake fields include `briefPath`, `figmaUrl`, `docsPaths`, `openApiPaths`, `openApiUrls`, `guidancePaths`, and `skillHints`. For example:

```yaml
mode: feature
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
docsPaths: []
openApiPaths:
  - docs/openapi.yaml
guidancePaths: []
skillHints: []
```

Legacy analysis stays inside the selected feature boundary and follows only direct imports and configuration references needed to understand it. Concrete HTTP calls are authoritative; constructors and local facades are not recorded as separate API operations. URL settings referenced from `.env*` are sanitized by removing user info, query, and fragments, then their variable names, origins, and HTTP-client callsites remain in `legacyInventory`. `collect-legacy-network-evidence` is requested only when static analysis and supplied OpenAPI cannot uniquely determine a method and path; submitting a scoped HAR then resumes the same Run.

Legacy review material is grouped by feature under `.spec-to-pr/<feature>/`: contracts, evidence, side-by-side legacy/current visuals, the reviewer-facing report, and an integrity manifest. The same change also records its proposal, delta spec, and task list under `openspec/changes/`. The manifest binds the current Run and revision to the legacy source digest, requirements, and OpenSpec file digests, so reviewers never need to interpret internal feature keys.

Status includes `requiredValidations`, `resumeContext`, and `blockerDetails`. Reports use `pr-report-v2.1`; `visualTargets` and `compare-visuals` measure visual similarity at runtime with a fixed 92% threshold. The initial comparison and at most two repairs run automatically; invalid acquisition consumes no attempt, while a third valid failure leaves the Run blocked. When publication preconditions allow, the blocked draft keeps the same report template with equal-size baseline/current images plus separately inspectable diff and overlay. Focused design-system, interaction, and accessibility assertions remain independent gates. If a GitLab image upload fails temporarily, verified legacy/current PNGs may use raw URLs pinned to the exact review commit. This fallback is never used for a digest mismatch, a changed worktree, or generated diffs, overlays, or video. A blocked Run can produce a local diagnostic report with `intent: blocked-diagnostic`, then update the same draft PR after recovery. Common local blockers include `PUBLISH_NO_DELTA` and `BROWSER_NOT_RUN`.

## Documentation

**https://dhyun2.github.io/spec-to-pr/en/**
