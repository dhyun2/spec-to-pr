# SpecToPR

Turn a brief, a legacy application, a feature request, or a Figma design into an evidence-backed draft PR.

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

| Use case             | What you provide                                     | What arrives                                                                         | Guide                                                                |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Full delivery        | Brief/PDF/MD, Figma URL, and OpenAPI                 | Implemented API/UI, visual comparison, API gaps, Web Vitals, and a draft PR          | [Brief → PR](https://dhyun2.github.io/spec-to-pr/en/usage/brief)     |
| Legacy migration     | Target repository and a separate legacy project path | Migration based on the running legacy application, visual comparison, and a draft PR | [Legacy → PR](https://dhyun2.github.io/spec-to-pr/en/usage/legacy)   |
| Feature delivery     | Brief, Figma, and API sources for one feature        | Full verification plus targeted E2E, one video, and a draft PR                       | [Feature → PR](https://dhyun2.github.io/spec-to-pr/en/usage/feature) |
| Figma implementation | Figma URL and target repository                      | Mock-backed UI, measured Figma comparison, and a draft PR                            | [Figma → PR](https://dhyun2.github.io/spec-to-pr/en/usage/figma)     |

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

Legacy intake preserves the selected feature boundary while following only its direct imports and configuration edges. Concrete source HTTP calls are authoritative; constructors and local facades are not API operations. Environment origins and transport callsites remain in `legacyInventory`. A genuinely dynamic unresolved call returns `collect-legacy-network-evidence`, so a bounded HAR can resume the same Run instead of forcing another start.

Legacy draft review material is gathered by feature under `.spec-to-pr/<feature>/`: `contracts`, `evidence`, side-by-side legacy/current `visual`, reviewer-facing `report`, and an integrity `manifest.json`. The same change records its proposal, delta spec, and tasks in `openspec/changes/`. A Run ID stays inside the manifest, so a reviewer never needs to interpret internal feature keys.

The status surface includes `requiredValidations`, `resumeContext`, and `blockerDetails`. Reports use `pr-report-v2.1`; visual targets are submitted through `visualTargets` and `compare-visuals`, with runtime-computed similarity requiring at least 98%. If a GitLab project upload fails transiently, only verified baseline/current PNGs may fall back to raw URLs at the exact review commit. Digest mismatch, a changed worktree, and synthetic diff/overlay/video never fall back. Blocked draft runs may publish a local blocked report using `intent: blocked-diagnostic`; a `status: blocked` diagnostic can be updated on the same draft PR. Common local blockers include `PUBLISH_NO_DELTA` and `BROWSER_NOT_RUN`.

## Documentation

**https://dhyun2.github.io/spec-to-pr/en/**
