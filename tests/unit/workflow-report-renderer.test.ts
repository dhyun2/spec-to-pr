import { describe, expect, it } from "vitest";

import {
  PrReportV2Schema,
  WorkflowReportMetadataSchema,
  assertCurrentPrReportV2,
} from "../../src/pr-report/pr-report-model.js";
import {
  renderPrReportV2Markdown,
  renderReadyWorkflowReport,
} from "../../src/pr-report/workflow-report-renderer.js";

const READY_REPORT_GOLDEN = `# SpecToPR Run run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

## Decision

Ready for draft review.

## Review packet

- ID: packet_checkout_01
- Revision: 7
- Base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- Head: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
- Evidence digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
- Diff digest: sha256:2222222222222222222222222222222222222222222222222222222222222222

## Project guidance

### Explicit

- docs/architecture/ARCHITECTURE.md

### Automatically discovered

- AGENTS.md

## Applied optional skills

- react-best-practices
- api-generator

## Requirement traceability

| Requirement | Acceptance criteria | Review verdict |
| --- | --- | --- |
| checkout-submit: Submit checkout | The order is submitted. | accepted, accepted |

## Focused legacy baseline

- Scope: checkout parser
- passed: \`pnpm test\` → test-results/legacy.json

## Changed files

- src/checkout.tsx
- tests/checkout.test.tsx

## Evidence

- contracts/requirements.json
- test-results/checkout.json
- visual/diff.png

## Validation gates

- functional-review/functional: passed (test-results/checkout.json)
- design-review/accessibility: passed (visual/diff.png)

## Risks

- minor: Keep an eye on narrow viewports

## Feature E2E video

- test-results/checkout.mp4
`;

describe("workflow report renderer", () => {
  it("preserves the ready workflow report byte-for-byte", () => {
    const report = renderReadyWorkflowReport({
      runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reviewPacket: {
        id: "packet_checkout_01",
        revision: 7,
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        evidenceDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        diffDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        changedFiles: ["src/checkout.tsx", "tests/checkout.test.tsx"],
      },
      guidanceTrace: {
        explicit: ["docs/architecture/ARCHITECTURE.md"],
        discovered: ["AGENTS.md"],
        skillHints: ["react-best-practices"],
        appliedSkills: ["api-generator", "react-best-practices"],
      },
      requirementManifest: [
        {
          id: "checkout-submit",
          title: "Submit checkout",
          acceptanceCriteria: ["The order is submitted."],
        },
      ],
      legacyBaseline: {
        scope: "checkout parser",
        checks: [
          {
            status: "passed",
            command: "pnpm test",
            resultPath: "test-results/legacy.json",
          },
        ],
      },
      evidencePaths: [
        "contracts/requirements.json",
        "test-results/checkout.json",
        "visual/diff.png",
      ],
      reviews: [
        {
          kind: "functional-review",
          requirements: [{ id: "checkout-submit", verdict: "accepted" }],
          gateResults: [
            {
              id: "functional",
              status: "passed",
              evidencePaths: ["test-results/checkout.json"],
            },
          ],
          findings: [],
        },
        {
          kind: "design-review",
          requirements: [{ id: "checkout-submit", verdict: "accepted" }],
          gateResults: [
            {
              id: "accessibility",
              status: "passed",
              evidencePaths: ["visual/diff.png"],
            },
          ],
          findings: [{ severity: "minor", title: "Keep an eye on narrow viewports" }],
        },
      ],
      featureVideoPath: "test-results/checkout.mp4",
    });

    expect(report).toBe(READY_REPORT_GOLDEN);
  });

  it("keeps workflow report intent and decision metadata consistent", () => {
    expect(
      WorkflowReportMetadataSchema.parse({
        reportKind: "pr-body-markdown",
        reportIntent: "ready",
        decision: "ready",
      }),
    ).toEqual({
      reportKind: "pr-body-markdown",
      reportIntent: "ready",
      decision: "ready",
    });
    expect(
      WorkflowReportMetadataSchema.parse({
        reportKind: "pr-body-markdown",
        reportIntent: "blocked-diagnostic",
        decision: "blocked",
      }),
    ).toEqual({
      reportKind: "pr-body-markdown",
      reportIntent: "blocked-diagnostic",
      decision: "blocked",
    });
    expect(
      WorkflowReportMetadataSchema.safeParse({
        reportKind: "pr-body-markdown",
        reportIntent: "blocked-diagnostic",
        decision: "ready",
      }).success,
    ).toBe(false);
  });

  it("binds a zero-operation legacy API section to its inventory digest", () => {
    const inventoryDigest = `sha256:${"a".repeat(64)}`;
    const report = PrReportV2Schema.parse({
      schemaVersion: "pr-report-v2.1",
      runId: `run_${"a".repeat(32)}`,
      generatedAt: "2026-07-20T00:00:00.000Z",
      decision: "blocked",
      mode: "legacy",
      sectionStatuses: {
        api: "complete",
        legacy: "blocked",
        visual: "not-run",
        "functional-review": "not-run",
        "design-review": "not-run",
        performance: "not-run",
        "feature-evidence": "not-applicable",
      },
      summary: { title: "Legacy migration", bullets: [], exclusions: [] },
      sources: [],
      skills: { hints: [], applied: [] },
      requirements: [],
      changedFiles: [],
      implementationNotes: [],
      api: {
        applicable: true,
        inventoryDigest,
        discoveryAdapters: ["source-fetch-literal", "source-request-config"],
        operations: [],
        gaps: [],
      },
      legacy: { applicable: true, coverage: [] },
      visual: { applicable: true, attempt: 0, status: "not-run", results: [] },
      reviews: [],
      performance: { applicable: true },
      gaps: [],
      blockers: ["Implementation blocked."],
      unrunValidations: ["functional"],
      risks: [],
      rollback: {
        trigger: "Unexpected migration behavior.",
        strategy: "Revert the migration.",
        steps: ["Revert the change."],
        dataImpact: "None expected.",
        postChecks: ["Run the legacy regression."],
      },
      evidencePaths: [],
      artifactIds: [],
    });

    const markdown = renderPrReportV2Markdown(report);
    expect(() => assertCurrentPrReportV2(report)).not.toThrow();
    expect(report.api.inventoryDigest).toBe(inventoryDigest);
    expect(markdown).toContain(`- Inventory digest: ${inventoryDigest}`);
    expect(markdown).toContain("source-fetch-literal, source-request-config");
    expect(markdown).toContain("No API operations detected");

    const historical = PrReportV2Schema.parse({
      ...report,
      api: { applicable: true, operations: [], gaps: [] },
    });
    expect(historical.api.inventoryDigest).toBeUndefined();
    expect(() => assertCurrentPrReportV2(historical)).toThrow(/inventory digest/i);
  });
});
