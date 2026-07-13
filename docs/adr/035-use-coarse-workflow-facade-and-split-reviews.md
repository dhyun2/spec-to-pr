# ADR 035: Use a Coarse Workflow Facade and Split Reviews

- Status: Accepted
- Date: 2026-07-13
- Supersedes: ADR 019, ADR 021, ADR 022, ADR 023, ADR 024

## Context

SpecToPR v1 exposes 111 MCP tools and asks the model to coordinate 27 stages, separate Spec/BDD, API, and Design/UI lanes, an integration lane, Review Council retries, and multiple specialist reviewers. The advertised tool schemas alone are about 411 KB. The repository's deterministic checks are fast; model context and protocol round trips dominate latency.

The separate API and UI lanes also invert a useful dependency: API wrappers and mocks should be ready before UI states are implemented and visually verified.

## Decision

Keep local stdio MCP as the host boundary, but expose only seven coarse workflow tools. Move deterministic sequencing and stage transitions into an application orchestrator.

Use one implementation context. Within it, complete API types, schemas, wrappers, mocks, and contract tests before feature and UI work. Do not create separate API and Design/UI implementation agents or an integration worktree lane.

After implementation, use two independent reviews:

- functional review, always for code scope;
- design review, only for applicable UI scope.

Remove Review Council aggregation and specialist reviewer cascades. Derive scorecards and PR readiness from one canonical gate decision.

## Consequences

The public MCP surface and normal call count shrink by more than 90% and roughly 75%, respectively. Agent context becomes smaller, UI validation can rely on completed API mocks, and conditional work no longer blocks unrelated changes.

This intentionally breaks v1 MCP, skill, agent, and incomplete-Run compatibility. Existing domain services and durable artifacts remain reusable behind the orchestrator.
