# SpecToPR

An evidence-first Claude Code and Codex plugin for turning product briefs, docs, Figma designs, and OpenAPI contracts into a verified draft PR/MR.

Korean version: [README.ko.md](README.ko.md)

## What It Does

`SpecToPR` is not just a code-writing prompt pack. It gives Claude Code or Codex a structured delivery pipeline with a local MCP kernel, shared skills, review agents, artifact storage, and quality gates.

At a high level, it can:

- capture a product brief, documentation, Figma URL, OpenAPI file, and repository context as source evidence;
- build a traceability graph from requirements to implementation and verification artifacts;
- generate OpenSpec proposals, Gherkin scenarios, API pipeline artifacts, and design contracts;
- run implementation lanes for Spec/BDD, API Contract, and Design/UI work;
- run review lanes for architecture, quality gates, visual regression, accessibility, performance, observability, PR reporting, publishing, and release readiness;
- compare Figma/browser or legacy/target screenshots and run a bounded visual repair loop;
- generate a review scorecard across brief fidelity, legacy coverage, Gherkin completeness, TDD evidence, design-system usage, visual parity, resource contracts, API contracts, and publish sync;
- turn Figma nodes into component contracts and require component-level visual evidence so local UI drift is not hidden inside a whole-page score;
- create a legacy feature inventory for migrations and block on a feature coverage matrix when routes, components, APIs, native bridges, URLs, analytics, root/global CSS effects, or query/hash behavior are missing;
- generate an evidence-backed PR report while separating reviewer-facing PR/MR body content from internal audit details;
- publish the report as a draft GitHub PR or GitLab MR when blockers are clear, and optionally update an existing draft with a blocked failure report body.

Publishing creates or updates the review request body. It does not merge, approve, close, or mark a PR/MR ready for review.

## Requirements

- Node.js `>=22`
- `pnpm`
- Git
- Claude Code or Codex, depending on the host you want to use
- Optional for publishing: authenticated `gh` or `glab`, or `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN`
- Optional for visual capture: Playwright Chromium installed in the target project environment

## Download And Build

```bash
git clone https://github.com/dhyun2/spec-to-pr.git
cd spec-to-pr
corepack enable
pnpm install
pnpm build
```

Useful checks while developing the plugin:

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm plugin:validate
```

## Install In Claude Code

Claude Code installs plugins from marketplaces. This repository includes a Claude marketplace manifest at `.claude-plugin/marketplace.json`.

From Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

For local development, add the cloned repository path as the marketplace instead:

```text
/plugin marketplace add /absolute/path/to/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

After installation, verify that the plugin and local MCP kernel are reachable:

```text
/spec-to-pr:doctor
```

## Install In Codex

Codex support has two surfaces:

- `.codex-plugin/plugin.json` exposes the installable Codex plugin.
- `packages/codex-sdk` provides a programmatic runner for CI and internal automation.

For another machine or a fresh Codex environment, prefer the Git marketplace install path:

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

To update that install:

```bash
codex plugin marketplace upgrade spec-to-pr
codex plugin add spec-to-pr@spec-to-pr
```

For local plugin testing, add the cloned repository as a Codex marketplace source:

```bash
codex plugin marketplace add .
codex plugin add spec-to-pr@spec-to-pr
```

Then restart Codex, open `/plugins`, select the `SpecToPR` marketplace, and confirm `spec-to-pr` is installed.

In Codex, MCP tools are exposed under the normalized `mcp__spec_to_pr__*` namespace. If a thread loads the skills but cannot see the tools, start a new thread or ask Codex to search for `spec-to-pr kernel_info create_run` tools before running Doctor.

Do not validate an installed plugin by importing `@modelcontextprotocol/sdk` from the plugin cache with `pnpm exec node`. Installed release packages intentionally exclude `node_modules`; Doctor should exercise the bundled `node ./dist/mcp/server.js` through the host-exposed MCP tools.

### Codex SDK Runner

Use the SDK runner when another process should start Codex, provide the inputs, and collect the final response or thread ID.

```bash
cd packages/codex-sdk
pnpm install
pnpm build
node dist/cli.js \
  --cwd /path/to/app \
  --brief docs/plan.md \
  --docs docs \
  --figma https://figma.com/file/... \
  --openapi docs/openapi.yaml \
  --min-visual-score 0.98 \
  --max-repair-attempts 3
```

See [docs/codex/README.md](docs/codex/README.md) for Codex-specific details.

## Basic Workflow

1. **Doctor** checks that the plugin, MCP server, runtime, and tool list are reachable.
2. **Intake** captures the original request and records brief/docs/Figma/OpenAPI/repository inputs as evidence.
3. **Profiling** inspects the target project, package manager, framework, scripts, and workspace boundaries.
4. **Legacy inventory** can extract migration feature coverage from routes, components, stores, APIs, native bridges, URLs, analytics, root/global CSS selectors, and query/hash parameters.
5. **Traceability** connects requirements to source evidence and identifies gaps. Legacy coverage rebuilds reuse existing open gaps for the same legacy feature instead of duplicating blockers.
6. **Contracts** generate OpenSpec, Gherkin, API, design-system mapping, and component-contract artifacts. Repeated traceability rows for the same requirement are merged before OpenSpec rendering.
7. **Agent lanes** prepare and run Spec/BDD, API Contract, and Design/UI work.
8. **Review council** aggregates lane results, legacy feature coverage, and component contract coverage to block unsafe or incomplete work.
9. **Integration** applies approved changes in a controlled order.
10. **Gates** run quality, architecture, visual, accessibility, performance, and observability checks.
11. **Review scorecard** scores the run across brief fidelity, legacy coverage, Gherkin completeness, TDD evidence, design-system usage, visual parity, resource contracts, API contracts, and publish sync. Missing scorecards or any dimension below the normalized minimum, usually 8/10, block publishable reports; ratio-style inputs such as `0.85` are normalized to `8.5/10`.
12. **PR report** summarizes evidence, scorecard rows, diffs, risks, grouped gaps, and decisions while separating internal audit detail from the PR/MR body.
13. **Publish** creates or updates a draft PR/MR when the report decision is not blocked and the generated body plus required visual previews are synchronized. Existing drafts may still receive a blocked failure report body update.
14. **Archive/release** can record merge evidence and prepare release-readiness artifacts.

## Typical Inputs

You can provide one or more of:

- product brief: `docs/plan.md`, Markdown, or plain text;
- docs directory: `docs/`;
- Figma URL;
- OpenAPI YAML/JSON;
- target repository path;
- source and target branches;
- validation commands or quality-gate requirements.

Example prompt after installing the plugin:

```text
Run spec-to-pr for /path/to/app.
Use docs/plan.md as the brief, docs/openapi.yaml as OpenAPI input,
and this Figma URL: https://figma.com/file/...
Generate an evidence-backed draft PR report and publish a draft review request only if it is not blocked.
```

## Documentation Site

Full documentation — installation, quickstart, prompt recipes, pipeline concepts, scoring/loop
engineering, task specs (T01–T33), and troubleshooting — lives at:

**https://dhyun2.github.io/spec-to-pr/**

To run the docs site locally:

```bash
pnpm --dir website install
pnpm --dir website start
```

## Release And Local Marketplace Updates

Release verification:

```bash
pnpm release:verify
```

Dry-run the publish plan:

```bash
pnpm release:publish:dry-run
```

Update local Claude/Codex marketplace installs without pushing or tagging:

```bash
pnpm release:update:local
```

Target one host:

```bash
pnpm release:update:claude
pnpm release:update:codex
```

Release scripts prepare and validate plugin packages. They do not merge downstream PRs/MRs.
