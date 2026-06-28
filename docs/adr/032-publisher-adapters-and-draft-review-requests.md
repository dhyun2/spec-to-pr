# ADR-032: Publisher Adapters and Draft Review Requests

## Status

Accepted

## Context

The plugin must publish generated evidence reports to GitHub and GitLab.

Publishing has external side effects:

- pushing branches
- creating PRs or MRs
- notifying reviewers
- changing labels
- updating PR/MR body

This must not happen automatically.

## Decision

Use a deterministic PublisherService behind an explicit Skill.

Default publish mode is Draft.

Host-specific behavior is isolated behind Publisher adapters:

- GitHubPublisherAdapter
- GitLabPublisherAdapter

A publisher-reviewer subagent may review the publish plan and PR/MR body, but it cannot perform publishing actions.

## Consequences

Good:

- Publishing is explicit and auditable.
- Host-specific API details stay isolated.
- Tokens are not handled by LLM agents.
- PR/MR URL is recorded as evidence.

Tradeoffs:

- Users must configure tokens.
- Self-hosted instances require host config.
- Draft/label/reviewer behavior differs between GitHub and GitLab.
