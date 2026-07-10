# Codex Integration

한국어 버전: [README.ko.md](README.ko.md)

spec-to-pr exposes two Codex surfaces:

1. **Codex plugin**: installable UX for Codex app and CLI users. It bundles the
   shared `skills/` workflows and the local stdio MCP kernel.
2. **Codex SDK runner**: programmatic automation entry point for CI, internal
   tooling, and multi-agent orchestration outside the interactive Codex UI.

Use the plugin when a person should install and invoke spec-to-pr from Codex.
Use the SDK runner when another process should start Codex, provide a brief, and
collect the final response or thread ID.

## Git Marketplace Install

For another machine or a fresh Codex environment, prefer the Git marketplace install path. It uses the repository manifest and bundled MCP server instead of relying on `node_modules` inside a plugin cache.

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

To update that install:

```bash
codex plugin marketplace upgrade spec-to-pr
codex plugin add spec-to-pr@spec-to-pr
```

Verify the install:

```bash
codex plugin marketplace list | rg spec-to-pr
codex plugin list | rg spec-to-pr
```

## Local Plugin Testing

The repo root is the plugin package. The repo-local marketplace lives at:

```text
.agents/plugins/marketplace.json
```

To test in Codex, add this repo as a marketplace source and install
`spec-to-pr` from the plugin directory:

```bash
codex plugin marketplace add .
codex plugin add spec-to-pr@spec-to-pr
```

Then restart Codex, open `/plugins`, select the `SpecToPR` marketplace,
and confirm `spec-to-pr` is installed.

In Codex, the plugin MCP tools are exposed under the normalized
`mcp__spec_to_pr__*` namespace. If a thread loads the skills but says the MCP
tools are not visible, start a new thread or ask Codex to search for
`spec-to-pr kernel_info create_run` tools before running `Doctor`.

Avoid validating an installed plugin by running ad hoc `pnpm exec node` scripts
that import `@modelcontextprotocol/sdk` from the plugin cache. Release packages
exclude `node_modules`, so Doctor checks should go through the bundled
`node ./dist/mcp/server.js` process and the host-exposed MCP tools.

## SDK Runner

The SDK runner scaffold lives in `packages/codex-sdk`. It intentionally stays
separate from the root package so the Claude/Codex plugin kernel does not take a
runtime dependency on the Codex SDK.

```bash
cd packages/codex-sdk
pnpm install
pnpm build
node dist/cli.js --cwd /path/to/app --brief docs/plan.md --figma https://figma.com/file/...
```

The runner starts or resumes a Codex thread, asks Codex to use the installed
spec-to-pr plugin when available, and keeps the same evidence-first reporting
rules as the interactive workflow.

## Review Agents And Visual Repair

Codex support includes project-scoped custom agents under `.codex/agents/` for
visual review, review council aggregation, and Design/UI repair. The SDK runner
also emits review-lane instructions so Codex can spawn subagents when the host
supports subagent workflows, or run the same lanes sequentially when it does
not.

The default visual repair policy is:

- minimum visual score: `0.98`
- maximum repair attempts: `3`
- score metric: `reviewMatchRatio`

The shared `Run Visual Repair Loop` skill calls `evaluate_visual_repair_loop`
after each visual comparison. A `retry` or `failed` decision blocks PR report
publishing until the Design/UI lane repairs the failing targets or the loop
exhausts and reports a human-review blocker.

Migration runs can use a `legacy-screenshot` baseline instead of the default
Figma-vs-browser baseline. In that mode, the visual gate compares the full
legacy screenshot against the target implementation screenshot while Figma
remains evidence for design-system intent, tokens, and component structure.
When Figma nodes produce component contracts, whole-page visual evidence is not
enough; component-level visual evidence is required as well.

## Legacy Feature Coverage

When migrating a legacy Vue2 or similar module into a Vue3/TypeScript target,
the workflow should not collapse legacy behavior into broad screen summaries.
`generate_legacy_feature_inventory` records routes, components, stores, API
calls, native bridges, URL opens, analytics, environment checks, query/hash
parameters, and root/global CSS selectors that affect the migrated screen.
`build_feature_coverage_matrix` then checks:

```text
legacy feature -> OpenSpec requirement -> Gherkin scenario -> target implementation -> test/evidence
```

Empty cells become blockers before Review Council. This is what catches behavior
that screenshots cannot prove, such as app back events, location permission
branches, radius expansion retries, reservation routing, root stylesheet effects,
call/path variants, and campaign or analytics hooks.

When the feature coverage matrix is rebuilt, open `legacy-coverage` gaps are
matched by legacy feature ID and reused. A rerun updates the matrix evidence
without creating duplicate blocker gaps for the same legacy behavior.

## OpenSpec Generation

OpenSpec generation consumes the traceability matrix conservatively. If multiple
traceability rows describe the same requirement title in the same spec area, the
rows are merged before rendering so repeated evidence does not create duplicate
OpenSpec requirements. The merged requirement keeps the strictest status and the
union of evidence IDs, gap IDs, and tags.

## Review Scorecard

Before a PR report can be treated as publishable, the workflow records a
`review-scorecard` artifact through `generate_review_scorecard`. The scorecard
uses a 0-10 scale with a default 8/10 minimum across:

- brief fidelity
- legacy coverage
- Gherkin completeness
- TDD evidence
- design-system usage
- visual parity
- resource contracts
- API contracts
- publish synchronization

If the scorecard is missing, any dimension is below the normalized minimum
threshold, or a `nextRepairTarget` is present, the PR report decision remains `blocked`. The
compact PR/MR body and internal audit report both render the scorecard so
reviewers can see which dimension drove the loop.

Scorecard thresholds are always interpreted on the 0-10 score scale. A
`minimumScore` in the 0-1 range is treated as a ratio, so `0.85` becomes
`8.5/10` rather than `0.85/10`.

## Publishing Boundary

`SpecToPR` end-to-end runs should publish the generated PR report as a draft
PR/MR when the report decision is not blocked. The publisher uses the generated
`pr-report.md` artifact as the base review request body; it must not write a new
body from memory.

A blocked decision still blocks new PR/MR creation and ready transitions. If an
existing draft PR/MR already exists and reviewers need the failure evidence, an
explicit blocked draft update path may update only the body while preserving the
blocked status and avoiding merge/approve/ready actions.

The PR/MR body is optimized for reviewers: decision, gate summary, visual
preview, and grouped gaps. Internal audit details such as Figma provider
capabilities, artifact counts, empty traceability internals, and repeated raw
gap lists are kept in separate audit artifacts.

When visual comparison PNG artifacts exist, the publisher uploads Figma,
browser, and diff images to the review host and injects a `Visual Evidence
Preview` section into the PR/MR body. GitLab uses project markdown uploads and
keeps the project-relative upload path so images render in the MR description.
GitHub publishes the images to the source branch under `.spec-to-pr/visual-assets/`;
for public repos it embeds a commit-SHA-pinned raw URL (stable after branch
deletion), and for private repos it falls back to a plain blob link because raw
URLs are not embeddable without authentication. If visual preview assets are
required by the generated report or intake policy, upload failure makes the
publish result `failed`; a PR/MR URL alone is not publish success.

Publishing means creating or updating a draft GitHub Pull Request or GitLab
Merge Request. It does not merge, approve, close, or mark the request ready for
review.

## Skill Frontmatter Compatibility

Skill files (`skills/*/SKILL.md`) use YAML frontmatter written for Claude Code.
Codex reads the skill body and ignores the Claude-specific keys:

| Frontmatter key            | Claude Code | Codex   |
| -------------------------- | ----------- | ------- |
| `name`, `description`      | used        | used    |
| `allowed-tools`            | used        | ignored |
| `disable-model-invocation` | used        | ignored |
| `argument-hint`            | used        | ignored |

The ignored keys are harmless on Codex. MCP tools are always available under the
normalized `mcp__spec_to_pr__*` namespace regardless of `allowed-tools`.

## Subagent Parity

Claude agents live in `agents/*.md`. The Codex equivalents live in
`.codex/agents/*.toml` as `spec-to-pr-<name>`, covering every implementation
lane and reviewer (spec-bdd, api-contract, design-ui, integrator,
review-council, and the gate/report/publish/release reviewers), plus the
Codex-only `spec-to-pr-design-ui-repair`.

If a host cannot spawn a named subagent, each lane/reviewer skill instructs the
model to run the same steps inline in the current thread and record results with
the same `record_*` MCP tool. No lane is skipped.

## Self-Hosted GitHub / GitLab

`github.com` and `gitlab.com` are auto-detected. For GitHub Enterprise or
self-hosted GitLab, the hostname is matched heuristically (a host containing
`gitlab`/`github`), and the API base is derived (`/api/v4` for GitLab,
`/api/v3` for GitHub Enterprise). Override detection when needed:

```bash
export SPEC_TO_PR_GIT_HOST=gitlab            # or github
export SPEC_TO_PR_API_BASE_URL=https://scm.internal/api/v4
export SPEC_TO_PR_WEB_BASE_URL=https://scm.internal
```

## Publisher Tokens

Publisher tokens are read from the environment first, then from the host CLI:

- GitHub: `GITHUB_TOKEN` / `GH_TOKEN`, else `gh auth token`.
- GitLab: `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN`, else `glab auth token`.
