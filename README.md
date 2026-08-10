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

## Current release (1.0.0)

SpecToPR exposes 7 MCP tools, 8 durable stages, 8 skills, and 2 independent reviewers. The four reviewer-facing Draft templates are `legacy-migration`, `brief-delivery`, `feature-flow`, and `figma-ui`.

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

Legacy analysis stays inside the exact requested feature boundary and follows direct imports and configuration references needed to understand it. An explicit external `legacyProjectRoot` is read-only. API, auth, certificate, or dynamic-request uncertainty is recorded as a Gap: confirmed UI, route, state, type, and read behavior can continue, while an unconfirmed write interaction is never invented.

Every UI scope attempts a runtime-owned visual comparison. A failed or unavailable comparison is visible as a merge-blocking Gap, but it does not hide the Draft PR or erase completed work. `feature-flow` additionally requires a review-packet-bound user-flow video. OpenSpec is optional post-merge integration, not an implementation or publication prerequisite.

The PR body is deliberately concise: status, any top-level Gaps with impact and a reviewer decision, what changed, visual-comparison results, Feature video when applicable, and validation verdicts. It excludes Run IDs, raw logs, internal schema/digest dumps, and empty checklists.

Model routing is role-based and host-local: the core uses `fast`, `build`, and `expert`; Codex maps them to Luna/Terra/Sol and Claude maps them to Haiku/Sonnet/Opus. The default is `adaptive-verified`. `pinned` keeps one user-selected model through every stage and independent review, while `custom` supplies all three role models. A Run never auto-mixes hosts, and an unavailable higher role becomes a visible quality Gap rather than a weaker hidden verification.

If GitHub or GitLab authentication, TLS, or host access prevents publication, SpecToPR keeps a local diagnostic report and records a publication Gap; after recovery it updates the same draft PR rather than creating a replacement Run.

### Self-hosted GitLab

Configure the exact remote host and API base before starting a self-hosted GitLab publication. The publisher verifies `GET /user` through the same TLS transport before it pushes a branch, creates a Draft MR, or uploads visual evidence.

```bash
export SPEC_TO_PR_GIT_HOST=gitlab
export SPEC_TO_PR_WEB_BASE_URL=https://gitlab.example.internal
export SPEC_TO_PR_API_BASE_URL=https://gitlab.example.internal/api/v4
export SPEC_TO_PR_GITLAB_CA_FILE=/absolute/path/to/company-ca-bundle.pem
```

`SPEC_TO_PR_GITLAB_CA_FILE` is optional when the Node process already trusts the host CA. It adds an explicit CA bundle only for the GitLab publisher; it never disables certificate verification. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or a `glab` profile with `skip_tls_verify=true`.

## Documentation

**https://dhyun2.github.io/spec-to-pr/en/**
