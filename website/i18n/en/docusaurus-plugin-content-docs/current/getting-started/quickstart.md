---
sidebar_position: 3
title: Quickstart — first draft PR
hide_title: true
---

import GuideHero from "@site/src/components/guide/GuideHero";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="First evidence-backed draft"
title="Quickstart — first draft PR"
summary="Verify installation, copy one complete request, and see what is validated before the draft PR arrives—all in about five minutes."
primary={{ label: "See the complete guide", href: "/usage/brief" }}
secondary={{ label: "Choose my case first", href: "/usage/" }}
/>

## 1. Verify installation

```text
/spec-to-pr:doctor
```

The result should show contract `2.0.0`, 7 tools, 8 stages, and 2 reviewers.

## 2. Request delivery

Put the brief and API contract in the target repository:

```text
my-app/
├── docs/checkout.md
├── docs/openapi.yaml
├── package.json
└── src/...
```

Ask Claude Code or Codex:

```text
/spec-to-pr /absolute/path/to/my-app
mode: brief
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiPaths: [docs/openapi.yaml]
Implement the API and UI, verify the Figma ratio, API gaps, and Web Vitals, then create a draft PR.
```

## 3. Flow

<RunPipeline locale="en" mode="brief" />

The host advances to each external action with `workflow_advance` and submits actual artifacts with `workflow_submit`. Runtime owns state transitions and resume data.

Immediately after intake, `workflow_status` shows `XS`–`XL`, the estimated token range, and confidence. The SDK aggregates usage per action group and continues from a compact fresh thread at 80% of the hard limit. At the hard limit it returns `split-required` without removing required checks.

For API-backed scope, one implementation context follows this order:

1. Write types, schemas, client or wrapper.
2. Create mocks and contract-test evidence.
3. Submit `kind: api-ready` with physically distinct non-empty files—not path, symlink, or hard-link aliases—a passing contract-test JSON, and one `implementationContextId`.
4. Implement UI and UI evidence with the same context ID.

API and UI are not split across separate writers.

When a draft is requested, use a non-target `codex/*` source branch before implementation. Before publication, commit only intended files, leave the working tree clean, and ensure the source is at least one commit ahead of target.

## 4. Reviews and result

The independent `functional-reviewer` checks contracts, diff, focused tests, and required gates. For UI, the independent `design-reviewer` separately checks visual fidelity, interaction, design-system usage, and accessibility. The orchestrator freezes the `workflow_status` snapshot plus contracts/diff/evidence paths; reviewers return verdict payloads without calling workflow tools.

After required evidence passes, SpecToPR creates or updates a draft PR/MR. Humans retain merge, approve, and ready authority.

## Other modes

- Legacy migration: `mode: legacy` plus a separate `legacyProjectRoot` and explicit scope; add project-local `legacyNetworkEvidencePath` only when source method/path evidence is ambiguous
- User-facing feature: `mode: feature`, one changed-feature E2E, and exactly one video
- Figma implementation: `mode: figma`, `figmaUrl`, and the host-connected Figma capability

Start with [Brief → draft PR](/usage/brief) for copyable prompts, process details, and an expected PR example for each case.

<NextStep
eyebrow="Now use real inputs"
title="See the complete PR example for brief delivery"
description="Continue into required inputs, Gap handling, visual/API/performance evidence, and reviewer-first PR bodies."
href="/usage/brief"
label="Open brief usage"
secondary={{ label: "Compare all four cases", href: "/usage/" }}
/>
