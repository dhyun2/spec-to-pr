---
sidebar_position: 1
title: Prerequisites
---

import NextStep from "@site/src/components/guide/NextStep";

# Prerequisites

## Always required

| Item           | Requirement             | Check                                  |
| -------------- | ----------------------- | -------------------------------------- |
| Node.js        | `>=22`                  | `node --version`                       |
| Git repository | Repository to implement | `git -C <repo> status`                 |
| Host           | Claude Code or Codex    | `claude --version` / `codex --version` |

`pnpm` and Corepack are required only when building the plugin from source.

## Feature-specific setup

| Feature          | Setup                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| GitHub draft PR  | `GITHUB_TOKEN`, `GH_TOKEN`, or authenticated `gh`                                                |
| GitLab draft MR  | `GITLAB_TOKEN`, `GITLAB_PRIVATE_TOKEN`, or authenticated `glab`                                  |
| Brief/Feature    | Brief file, accessible Figma URL, and a local or HTTPS OpenAPI source                            |
| Legacy migration | A separate legacy project absolute path and runnable environments for both projects              |
| Figma mode       | An accessible Figma URL and an environment that can run deterministic mock states                |
| Feature video    | A browser E2E environment such as Playwright that can select and record only the changed feature |

## Figma connection policy

SpecToPR does not run or poll its own Figma provider. It uses the Figma capability already connected to Claude Code or Codex. Follow your host and provider documentation to connect it.

For a Run:

1. Read the URL's real node/frame context through the host capability.
2. Save available screenshots, variables, assets, and component context as project-local evidence.
3. Record `provider: host-connected-figma`, ISO `capturedAt`, the matching `fileUrl`, non-empty `nodeIds`, and a JSON `manifestPath`.
4. Put the same provenance plus PNG `visualPaths` in the strict manifest, then submit exactly one typed `figma-bundle` containing that manifest and at least one actual PNG in `artifactPaths`.
5. Do not resubmit the bundle in the same Run.
6. A URL-only claim cannot satisfy contracts.

For one frame, use a copied URL that includes the selected frame's `node-id`.

## Feature video policy

Video is required only for user-facing `feature` mode:

- Select only the changed feature by test path, tag, or project.
- Record one unchained Playwright command that receives the selector as a real argument.
- Write strict project-local JSON containing only `status: passed`, the exact selector, the same `implementationContextId`, and a positive `testCount`.
- Produce exactly one structurally valid WebM/MP4 with non-zero duration, no larger than 25 MB.

Full-project E2E and multiple PR videos are not the default delivery policy.

<NextStep
eyebrow="Setup ready"
title="Install SpecToPR in your host"
description="Choose Claude Code or Codex, then install from the marketplace or a local path."
href="/getting-started/installation"
label="See installation"
secondary={{ label: "Compare the four inputs", href: "/usage/" }}
/>
