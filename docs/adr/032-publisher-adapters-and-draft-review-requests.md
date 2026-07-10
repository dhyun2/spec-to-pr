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

Publish success requires the generated body to be synchronized and, when visual previews are expected, the preview assets to be synchronized as well. A host-created URL without body and preview sync is not treated as plugin publish success.

## Consequences

Good:

- Publishing is explicit and auditable.
- Host-specific API details stay isolated.
- Tokens are not handled by LLM agents.
- PR/MR URL is recorded as evidence.
- Partial publish effects are explicit instead of being reported as success.

Tradeoffs:

- Users must configure tokens.
- Self-hosted instances require host config.
- Draft/label/reviewer behavior differs between GitHub and GitLab.
