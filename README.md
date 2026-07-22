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

## Documentation

**https://dhyun2.github.io/spec-to-pr/en/**
