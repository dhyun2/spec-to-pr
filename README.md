# SpecToPR

SpecToPR Lite is a small Codex and Claude Code skill that turns one of four delivery cases into a Korean draft pull request:

- `brief` — prepare and review OpenSpec change documents from the brief and supplied API/Figma sources; optionally use its acceptance scenarios for TDD
- `feature` — prepare and review OpenSpec change documents from the feature request and supplied sources; optionally use TDD, then record targeted E2E and one user-flow video
- `figma` — implement from a Figma screen with design-system components
- `legacy` — preserve and migrate an explicitly supplied legacy feature into the target framework

It has no MCP server, database, Run ID, workflow state machine, or background process. Each invocation works from the current Git diff. If interrupted, run it again and continue from the worktree.

## Draft PR contents

Each Draft PR uses one case-specific Korean template. It contains only reviewer-relevant evidence:

- `legacy`: source-to-target scope, complete visual matrix, baseline/actual/diff images, and API gaps
- `brief`: requirement fulfillment, excluded scope, and visual evidence
- `feature`: user-flow video, before/after behavior, regression verification, and visual evidence
- `figma`: Figma state mapping, state-level ratios, and design/accessibility verification

UI work always attempts visual comparison. Below 92%, inspect the diff, repair the implementation, and compare again under the same conditions, up to three valid comparisons including the first. A third miss, unavailable screenshots, failed tests, and uncertain APIs stay visible as a Gap. They do not hide completed work or stop a Draft PR, but they never become a verified pass.

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

`brief` requires a brief path, `figma` requires a Figma URL, and `legacy` requires a separate legacy project path plus exact `targetPaths`. `feature` can start from the request alone. OpenSpec is never a user-supplied prerequisite or a core-work blocker; the agent may prepare it for brief/feature work when useful. Their optional `test: on | off` defaults to `off`; `on` uses confirmed acceptance scenarios for test-first development. Feature E2E and video evidence remain separate from this switch.

## Visual comparison

The bundled `compare-images.cjs` compares two same-size PNGs and writes a diff asset.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline spec-to-pr-evidence/checkout/baseline.png \
  --actual spec-to-pr-evidence/checkout/actual.png \
  --diff spec-to-pr-evidence/checkout/diff.png
```

Commit and push the resulting evidence under `spec-to-pr-evidence/<change>/` so the Draft PR embeds real image links, not local paths.

## Legacy migration preserves the original UI

A `legacy` request is not a redesign. Unless the user explicitly approves redesign, preserve legacy templates/classes, CSS, sprites and image assets, visible controls, routes, and behavior. Modernize scripts, state, routing, and utilities to the target repository's Vue 3 conventions; UI preservation does not justify leaving Options API, mixins, or a Vuex compatibility layer when the target requires `<script setup lang="ts">`, Pinia, and Vue Router 4. Do not substitute `@frontend/ui` or another design system for the legacy UI.

When Computer Use is available in the host, use it first to navigate the authenticated running legacy app and capture every route/state. If it is unavailable or cannot produce the required PNGs, Browser or Playwright is an acceptable disclosed fallback: record its provider, auth state, timestamp, and reason once; fallback alone is not a Gap when equivalent images and functional verification exist. Never store cookie or token values. Then run `legacy-source-inventory.cjs` to collect bounded legacy routes and navigation plus read-only supporting imports, asset URLs, CSS selectors/breakpoints, and runtime markers such as Kakao Map or Swiper. Supporting dependencies do not expand the migration write scope. Map every item to actual target evidence. Every visual target also records a real fixture source, final URL, concrete selector/text assertions, API applicability and required API/auth results, and whether console/network diagnostics were checked plus any relevant errors. This is lightweight route proof, not a mandatory full E2E suite or video. `legacy-visual-evidence.cjs` rejects identical blank/error/loading screens, placeholder dynamic parameters, full-viewport-only critical regions, and target-code convention gaps even when pixels match. Its PR Markdown puts important Gaps first, then route proof and baseline/Vue 3 images side by side with one Diff link per state.

If plugin publication fails but a `glab` or `gh` fallback creates the Draft, record both the failure reason and fallback result in the PR body; a fallback must not erase the plugin failure.

## GitLab Draft MR preflight

For a GitLab remote, SpecToPR first performs a read-only check of the remote, `glab` authentication, project and MR API access, and an available Developer-or-higher role value. A blocked result becomes a publishing Gap; safe implementation continues. GitLab has no Draft MR creation dry-run, so the final confirmation is a successful `glab mr create --draft` (or update of an existing Draft) and its MR URL.

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
