# Task 21 — Design/UI Agent Lane

## Goal

Enable the Design/UI Agent to implement UI changes in an isolated worktree using Figma evidence, design-system inventory, design contract, OpenSpec, Gherkin, API wrapper contracts, and FSD ownership policy.

## Why this task exists

Figma evidence and design contracts are not enough by themselves. A dedicated UI agent must consume them under strict implementation rules.

The agent must:

- use the target repository's design system
- preserve FSD boundaries
- avoid direct generated client or fetch imports from UI
- implement loading/empty/error/success states when evidence supports them
- record unsupported or missing design evidence as gaps
- return a structured AgentResult

## Non-goals

- No visual regression scoring
- No review council
- No integration merge
- No automatic repair loop
- No PR publishing

## Inputs

- Run ID
- OpenSpec change name
- design contract artifact
- Figma design inventory artifact
- API wrapper contract artifact
- Gherkin/test matrix artifact
- project profile
- FSD ownership policy
- agent runtime worktree

## Outputs

- Design/UI agent context pack
- UI implementation plan artifact
- allowed/forbidden file policy
- structured Design/UI AgentResult
- changed UI/component/test/fixture files in design-ui worktree

## Skill

The user invokes:

```text
/spec-to-pr:run-design-ui <run-id> <change-name>
```

The Skill prepares the context pack and instructs the `design-ui` subagent to perform UI implementation only inside the assigned worktree.

## Agent

The plugin provides:

```text
agents/design-ui.md
```

This agent reads the context pack and writes UI code according to the policy.

## Definition of Done

- Design/UI subagent descriptor exists.
- Skill exists and explains exact workflow.
- Context pack builder emits design contract, Figma inventory, OpenSpec, Gherkin, API wrapper policy, ownership policy.
- File ownership policy restricts writes to allowed UI paths.
- Result recorder rejects forbidden changed files.
- MCP tools are available:
  - prepare_design_ui_agent
  - get_design_ui_agent_context
  - record_design_ui_agent_result
- Tests cover context pack generation and result validation.
