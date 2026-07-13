# SpecToPR

An evidence-first Claude Code and Codex plugin for turning product briefs, docs, Figma designs, and OpenAPI contracts into a verified draft PR/MR.

Korean version: [README.ko.md](README.ko.md)

## What It Does

`SpecToPR` is not just a code-writing prompt pack. It gives Claude Code or Codex a fast, evidence-backed delivery workflow with a seven-tool MCP facade, shared skills, artifact storage, and two independent reviewer roles.

At a high level, it can:

- capture a product brief, documentation, Figma URL, OpenAPI file, and repository context as source evidence;
- generate requirements, OpenSpec/Gherkin, API, mock, and design contracts from the intake evidence;
- keep API and UI implementation in one context, with the `api-ready` checkpoint completed before UI completion evidence is accepted;
- run a `functional-reviewer` for code scope and add an independent `design-reviewer` only when UI scope applies;
- select fast, scope-aware gates instead of running every specialist gate on every change;
- generate an evidence-backed report and publish it as a draft GitHub PR or GitLab MR when required evidence is approved.

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

In Codex, MCP tools are exposed under the normalized `mcp__spec_to_pr__*` namespace. The public facade is exactly `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, and `workflow_archive`. If a task loads the skills but cannot see these tools, start a new task or ask Codex to search for `spec-to-pr workflow_info workflow_start` before running Doctor.

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

1. **Intake** captures the request and classifies code, API, UI, and release applicability.
2. **Contracts** generate the required requirements, OpenSpec/Gherkin, API, mock, and design evidence.
3. **Implementation** stays in one context. API types, schemas, wrappers, mocks, and contract-test evidence must reach `api-ready` before UI completion.
4. **Functional review** checks requirement fidelity, contracts, tests, architecture, security, and unresolved functional gaps for code scope.
5. **Design review** independently checks visual fidelity, design-system use, interaction states, and accessibility only for applicable UI scope; otherwise it is not applicable.
6. **Report** summarizes the canonical gate and reviewer decisions.
7. **Publish** safely creates or updates a draft PR/MR when required evidence is approved.
8. **Archive** remains an explicit post-merge action backed by merge evidence.

## Fast Gates And Release Gates

The default workflow is intentionally fast and scope-aware. Code changes run available lint/format, typecheck, build, and one relevant functional test. OpenSpec validation, architecture boundaries, targeted security checks, visual comparison, interaction accessibility, and performance checks run only when the classified scope makes them applicable. Observability is opt-in. A missing optional script is not applicable; missing or failed required evidence blocks.

Release verification is separate. Full test matrices, hardening suites, package verification, and cross-host manifest validation are release-only gates and run only for an explicit release workflow. They are not added to every feature or bug-fix run.

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
