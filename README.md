# SpecToPR Lite

SpecToPR Lite is a small Codex and Claude Code skill that turns one of four delivery cases into a Korean draft pull request:

- `brief` — prepare and review OpenSpec change documents from the brief and supplied API/Figma sources; optionally use its acceptance scenarios for TDD
- `feature` — prepare and review OpenSpec change documents from the feature request and supplied sources; optionally use TDD, then record targeted E2E and one user-flow video
- `figma` — implement from a Figma screen with design-system components
- `legacy` — migrate an explicitly supplied legacy feature and screen

It has no MCP server, database, Run ID, workflow state machine, or background process. Each invocation works from the current Git diff. If interrupted, run it again and continue from the worktree.

## Draft PR contents

Every Draft PR uses one Korean template with:

1. implemented user-facing features
2. Figma or legacy visual match ratios and diff assets
3. APIs actually used by the change
4. gaps, impact, and next actions
5. commands that were run for verification
6. for `feature`, one targeted E2E result and one user-flow video

When visual comparison is below 92%, inspect the diff, repair the implementation, and compare again under the same conditions, up to three valid comparisons including the first. A third miss, unavailable screenshots, failed tests, and uncertain APIs stay visible as a Gap. They do not hide completed work or stop a Draft PR.

## Install

### Codex

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

### Claude Code

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

## Input

```text
case: figma
projectRoot: /absolute/path/to/project
request: Implement the checkout payment method screen.
source: https://www.figma.com/design/FILE/checkout?node-id=12-345
targetBranch: main
```

`brief` requires a brief path, `figma` requires a Figma URL, and `legacy` requires a separate legacy project path. `feature` can start from the request alone. `brief` and `feature` both prepare and review OpenSpec documents before implementation. Their optional `test: on | off` defaults to `off`; `on` uses OpenSpec acceptance scenarios for test-first development, while `off` creates and runs no unit or integration tests for the change. Feature E2E and video evidence remain separate from this switch.

## Visual comparison

The bundled `compare-images.cjs` compares two same-size PNGs and writes a diff asset.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline spec-to-pr-evidence/checkout/baseline.png \
  --actual spec-to-pr-evidence/checkout/actual.png \
  --diff spec-to-pr-evidence/checkout/diff.png
```

Commit the resulting evidence under `spec-to-pr-evidence/<change>/` so the Draft PR can link to it.

## GitLab Draft MR preflight

For a GitLab remote, SpecToPR first performs a read-only check of the remote, `glab` authentication, project and MR API access, and an available Developer-or-higher role value. A blocked result stops work before code changes and returns Korean setup steps. GitLab has no Draft MR creation dry-run, so the final confirmation is a successful `glab mr create --draft` (or update of an existing Draft) and its MR URL.

```bash
node /absolute/path/to/check-gitlab-mr.cjs \
  --project-root /absolute/path/to/project \
  --remote origin
```

See the [Korean GitLab preflight guide](https://dhyun2.github.io/spec-to-pr/getting-started/gitlab) for setup and recovery.

## Deliberate non-goals

- persisted workflow state or automatic resumption
- independent reviewers and durable stage transitions
- mandatory OpenSpec documents or TDD for `figma` and `legacy`, mandatory video for every case, or performance evidence
- a custom GitHub/GitLab publishing server
- exhaustive runtime parsing of APIs or legacy projects
