---
slug: /
sidebar_position: 1
title: SpecToPR
hide_title: true
description: The shortest path from a brief, legacy app, feature, or Figma design to an evidence-backed draft PR
---

import GuideHero from "@site/src/components/guide/GuideHero";
import ModeChooser from "@site/src/components/guide/ModeChooser";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="Specification to evidence-backed PR"
title="SpecToPR"
summary="Choose where you are starting—brief, legacy app, feature, or Figma—and move through implementation and independent review to a draft PR with traceable evidence."
primary={{ label: "5-minute quickstart", href: "/getting-started/quickstart" }}
secondary={{ label: "Choose a delivery", href: "/usage/" }}
/>

:::info[The version you are reading]
This site describes **Unreleased** behavior under development on package `0.2.1`. The public surface stays deliberately small: 7 MCP tools, 8 durable stages, 8 skills, and 2 independent reviewers.
:::

## Choose the input; keep one Run

The four cases are not four pipelines. Their inputs and required evidence differ, while contracts → implementation → functional and design review → draft publication stays the same.

<ModeChooser locale="en" />

## Follow one change into a PR

Select a stage to see what it receives and what it leaves behind. One implementation writer owns API and UI in the same `implementationContextId`. Only after implementation do the read-only functional reviewer and UI-only design reviewer inspect the immutable packet independently.

<RunPipeline locale="en" />

## Evidence comes before “done”

- Briefs, Figma, and OpenAPI are pinned through `sourceProvenance` and accepted contracts.
- Figma or a running legacy screen is captured at the same route, state, viewport, and fixture; `compare-visuals` performs the comparison.
- Ready and blocked outcomes share the 15-section `pr-report-v2.1`, so a stopped Run still shows completed work, unrun checks, and the exact resume action.
- SpecToPR only creates or updates drafts. People retain approval, ready, and merge authority.

<NextStep
eyebrow="Your first Run"
title="See the whole path with one small example"
description="The quickstart covers installation checks, a copyable prompt, and the expected draft PR in about five minutes."
href="/getting-started/quickstart"
label="Open the quickstart"
secondary={{ label: "Compare all four cases", href: "/usage/" }}
/>
