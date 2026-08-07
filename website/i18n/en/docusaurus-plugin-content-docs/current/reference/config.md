---
sidebar_position: 2
title: Configuration · CLI · environment
---

# Configuration · CLI · environment

## Delivery profile

Mode selects delivery/evidence behavior; sources compose independently.

| Field                       | Value                                                               | Meaning                                             |
| --------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `mode`                      | `auto`, `brief`, `legacy`, `feature`, `figma`                       | Delivery/evidence profile                           |
| `changeKind`                | `auto`, `feature`, `fix`, `refactor`, `migration`, `design`, `docs` | Change classification                               |
| `publication`               | `draft`, `none`                                                     | Draft publication intent                            |
| `modelRouting`              | `adaptive-verified`, `pinned`, `custom`                             | Host-local `fast`/`build`/`expert` model roles      |
| `briefPath`                 | project-relative path                                               | One brief source                                    |
| `legacyProjectRoot`         | absolute directory                                                  | Separate read-only legacy source                    |
| `legacyNetworkEvidencePath` | project-relative HAR/JSON                                           | Optional runtime evidence for ambiguous legacy APIs |
| `figmaUrl`                  | URL                                                                 | One Figma source                                    |
| `docsPaths`                 | project-relative path array                                         | Supporting docs, maximum 20                         |
| `openApiPaths`              | project-relative path array                                         | OpenAPI documents, maximum 20                       |
| `openApiUrls`               | HTTPS URL array                                                     | OpenAPI/Swagger UI URLs, maximum 20                 |
| `guidancePaths`             | project-relative path array                                         | Explicit project guidance, maximum 20               |
| `discoveredGuidancePaths`   | normalized project-relative paths                                   | Runtime-discovered guidance recorded in the profile |
| `skillHints`                | installed skill names                                               | Optional availability checks, maximum 20            |

`brief` and `feature` require brief + Figma + OpenAPI. `legacy` requires a separate exact `legacyProjectRoot` and running-legacy baseline. Its semantic inventory preserves terminal API candidates, environment `originRef`, transport/callsites, and confidence; constructors and local facades are not duplicate operations, while optional OpenAPI only enriches candidates. An ambiguous method/path is an open API Gap: optional runtime HAR/request JSON can resolve it, but it does not stop confirmed implementation and uncertain writes are not invented. `figma` requires a digest-bound deterministic mock manifest and fixtures. Only feature adds `targetedFeatureE2E` and `featureVideo`. Every UI capture repeats its target route/state/viewport/device scale/fixture and records provider, ISO capture time, PNG path, and digest. Runtime rejects target drift or digest mismatch without consuming an attempt, enforces the fixed 92% review ratio and no more than 20% masking, and runs three valid comparisons automatically. A failed or not-run comparison remains a merge-blocking Gap but can appear in a Draft; focused UI assertions remain independent gates. Machine `pr-report-v2.1` data remains available, while the default PR body is exactly one concise Legacy, Brief, Feature, or Figma template with Gaps first.

### Model routing

Core stores `fast`, `build`, and `expert` roles rather than provider model names. Codex defaults to Luna/Terra/Sol and Claude to Haiku/Sonnet/Opus; `adaptive-verified` is the default. `pinned` keeps one user-selected model for every stage and independent review, while `custom` supplies all three role models. A Run never auto-mixes hosts. If a higher role is unavailable, confirmed development continues and the requested/actual model and impact become a quality Gap.

### Bounded guidance discovery

Runtime checks only these root-relative candidates without recursive scanning:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/etc/folder-structure.md`

Explicit paths must exist. Missing automatic candidates and optional skills are ignored. Sources must be regular files no larger than 1 MB inside the canonical project root, with at most 20 per role.

Precedence is: current user request → explicit `guidancePaths` → automatically discovered project guidance → applicable installed skills → SpecToPR defaults. `skillHints` are names to check for availability and applicability, not skill bodies or arbitrary file paths.

## SDK runner CLI

```bash
node packages/codex-sdk/dist/cli.js \
  --cwd /path/to/app \
  --mode feature \
  --change-kind feature \
  --prompt "Add saved-address selection" \
  --publish
```

| Option                       | Description                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `--cwd <path>`               | Target repository, required                                                |
| `--prompt <text>`            | Change request and constraints                                             |
| `--mode <mode>`              | Delivery mode                                                              |
| `--change-kind <kind>`       | Change classification                                                      |
| `--brief <path>`             | Brief/spec input                                                           |
| `--legacy-project <p>`       | Separate legacy project root                                               |
| `--legacy-network <p>`       | Project-local bounded HAR/request JSON                                     |
| `--docs <path>`              | Repeatable supporting document                                             |
| `--figma <url>`              | Figma file/node URL                                                        |
| `--openapi <path>`           | Repeatable OpenAPI input                                                   |
| `--openapi-url <url>`        | Repeatable HTTPS OpenAPI URL                                               |
| `--guidance <path>`          | Repeatable explicit guidance                                               |
| `--skill <name>`             | Repeatable optional skill hint                                             |
| `--publish`                  | Publish a draft when ready                                                 |
| `--no-publish`               | Stop after implementation/review evidence                                  |
| `--resume <task-id>`         | Resume an existing Codex task                                              |
| `--model <model>`            | Model override                                                             |
| `--max-turns <n>`            | Action-group turn limit, default 12                                        |
| `--turn-timeout-seconds <n>` | Stop and return a resumable state when one turn exceeds this duration      |
| `--run-timeout-seconds <n>`  | Stop and return a resumable state when the full Run exceeds this duration  |
| `--usage-history <p>`        | Numeric-only calibration JSONL path                                        |
| `--no-usage-calibration`     | Disable calibration reads/writes                                           |
| `--no-review-agents`         | Keep required review evidence in the current task instead of delegating it |

Without an explicit mode, a legacy root selects `legacy`, brief path selects `brief`, Figma URL selects `figma`, and all other requests use `auto`. Unless `--no-publish` is present, all four explicit modes request draft publication.

The SDK uses the workload-class default maximum as its automatic hard limit. Users do not specify a numeric limit, and calibration does not change it. Contract refinement updates runtime estimates and the complete `requiredValidations` list at the next boundary. At the first completed action turn at or above 80%, the SDK starts a compact fresh thread. At the hard limit it always returns `split-required`; missing usage returns `usage-unavailable`. Calibration adjusts only the displayed estimate and excludes samples recorded under a different hard limit.

The SDK defaults to a 10-minute action-turn budget and a 45-minute total Run budget. `turn-timeout` or `run-timeout` never marks validation as passed; it returns the existing thread and the latest durable workflow state so the task can be resumed after the dependency is addressed. Inspect `budget.elapsedMs`, `budget.actionTurns`, and `budget.formatTurn` to identify the wait, and use the explicit timeout CLI options only when a larger budget is justified.

`--resume <task-id>` recovers the latest Run ID from task history and calls `workflow_status` first. It continues from `resumeContext` without repeating intake or creating another Run.

## Environment variables

| Variable                                | Default/interpretation                                | Use                                |
| --------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| `SPEC_TO_PR_DATA_DIR`                   | host plugin data or temp path                         | Durable Run/evidence storage       |
| `GITHUB_TOKEN` / `GH_TOKEN`             | fallback to `gh auth token`                           | GitHub API auth                    |
| `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN` | fallback to `glab config get token --host <hostname>` | GitLab API auth                    |
| `SPEC_TO_PR_GIT_HOST`                   | detected from remote                                  | Self-hosted GitHub/GitLab override |
| `SPEC_TO_PR_API_BASE_URL`               | host-derived default                                  | Self-hosted API endpoint           |
| `SPEC_TO_PR_WEB_BASE_URL`               | host-derived default                                  | Review-request URL base            |

For self-hosted GitLab or GitHub, set `SPEC_TO_PR_GIT_HOST`, `SPEC_TO_PR_WEB_BASE_URL`, and `SPEC_TO_PR_API_BASE_URL` together in the runtime environment. Every URL must use HTTPS on the exact remote hostname; the plugin manifest never hardcodes a particular instance as a default.

The default SDK calibration file is `~/.codex/spec-to-pr/usage-history.jsonl`, outside the target repository. It stores only mode/workload and numeric counters—never prompts, code, diffs, repository paths, tool output, or final responses. Only new, non-resume completed Runs with complete usage become samples. Resume invocations with unknown whole-Run usage neither read mode history nor append a sample. I/O is best-effort; failures mark only `usageCalibration` as unavailable. Use `--usage-history` to relocate it or `--no-usage-calibration` to disable it.

An enabled history path or symlink inside the target repository, or an existing hard-linked history file, is rejected because it can dirty publication state. Relative paths resolve from `--cwd`.

Programmatic `outputSchema` status appears in `outputFormatting`. `budget-skipped` or `usage-unavailable` means the terminal workflow completed but the optional formatting turn did not run. `failed` means only that formatting turn failed; the workflow response and evidence remain valid. Unknown formatting-turn usage makes aggregate usage partial and skips calibration.

Without a token, required publish evidence cannot be completed, so publication reports a blocker. Tokens are never printed in logs or reports.

## MCP server

The Claude plugin launches the bundled local stdio server:

```json
{
  "mcpServers": {
    "spec_to_pr": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"],
      "env": {
        "SPEC_TO_PR_DATA_DIR": "${CLAUDE_PLUGIN_DATA}"
      }
    }
  }
}
```

Codex may normalize names to `mcp__spec_to_pr__*`. Every host exposes the same 7 public tools and contract version `2.0.0`.

## Default gates

- normal code: available format/lint, typecheck, build, and focused functional tests
- UI: applicable visual/interaction/accessibility evidence and design review
- targeted security/performance: only when in scope
- observability: opt-in
- full matrix and archive/package/cross-host verification: release-only

An unavailable optional script is `not-applicable`. A required check that was not run, skipped, or failed never becomes passed.
