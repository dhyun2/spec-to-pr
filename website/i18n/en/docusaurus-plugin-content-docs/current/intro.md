---
slug: /
sidebar_position: 1
title: Introducing SpecToPR
---

# SpecToPR

SpecToPR is a Claude Code and Codex plugin that turns a brief, a legacy change request, a user-facing feature, or a Figma design into verified implementation and, when requested, a draft PR/MR.

:::info Version labels
This site describes **Released 0.2.1** behavior from the `main` branch.
:::

## Four delivery modes

| Mode      | Input                       | Additional evidence                        | Result                         |
| --------- | --------------------------- | ------------------------------------------ | ------------------------------ |
| `brief`   | brief/spec and repository   | acceptance criteria and contracts          | draft PR/MR                    |
| `legacy`  | repository and narrow delta | focused current-behavior baseline          | draft PR/MR                    |
| `feature` | user-facing feature         | changed-feature E2E plus exactly one video | video-linked draft PR/MR       |
| `figma`   | Figma URL and repository    | real Figma context and visual evidence     | implementation; optional draft |

Only `feature` inherits the targeted Playwright E2E and exactly-one-video delivery cost. A supplied Figma URL always requires one strict `figma-bundle` from the host-connected Figma capability.

## Deliberately small surface

- 7 MCP tools
- 8 durable stages
- 8 public marketplace skills
- 2 independent, read-only reviewers

One implementation writer owns API and UI in one `implementationContextId`. Read-only scouts are workload-gated, reviewer parallelism begins only after implementation, and the publisher only creates or updates drafts. Required evidence never becomes optional because a host skill, browser, budget, or diagnostic tool is unavailable.

## Start

1. [Prerequisites](/getting-started/prerequisites)
2. [Installation](/getting-started/installation)
3. [Quickstart](/getting-started/quickstart)
4. [Brief → draft PR](/usage/brief)

Read the [pipeline](/concepts/pipeline), [skills reference](/reference/skills), and the official-source [comparison and adoption policy](/concepts/comparison).
