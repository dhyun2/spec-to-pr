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
    expect(markdown).toContain("# 요약");
    expect(markdown).toContain("검증이 차단되어 구현·리뷰가 완료되지 않았습니다.");
    expect(markdown).toContain("## 검증 결과");
    expect(markdown).toContain("| API | 완료 |");
    expect(markdown).toContain("<summary>API 상세</summary>");
    expect(markdown).toContain(`인벤토리 digest: ${inventoryDigest}`);
    expect(markdown).toContain("source-fetch-literal, source-request-config");
    expect(markdown).toContain("탐지된 API operation이 없습니다.");
    expect(markdown).not.toContain("## 1. Decision and review packet");

    const historical = PrReportV2Schema.parse({
      ...report,
      api: { applicable: true, operations: [], gaps: [] },
    });
    expect(historical.api.inventoryDigest).toBeUndefined();
    expect(() => assertCurrentPrReportV2(historical)).toThrow(/inventory digest/i);

    const ready = PrReportV2Schema.parse({
      ...report,
      decision: "ready",
      binding: {
        reviewPacketId: `packet_${"b".repeat(64)}`,
        revision: 8,
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        evidenceDigest: `sha256:${"c".repeat(64)}`,
        diffDigest: `sha256:${"d".repeat(64)}`,
      },
      sectionStatuses: {
        api: "complete",
        legacy: "complete",
        visual: "complete",
        "functional-review": "complete",
        "design-review": "complete",
        performance: "complete",
        "feature-evidence": "not-applicable",
      },
      summary: {
        title: "SpecToPR legacy delivery",
        bullets: ["Completed the legacy Shop migration."],
        exclusions: [],
      },
      requirements: [
        {
          id: "REQ-SHOP-ROUTING",
          title: "Shop MPA entry and route parity",
          acceptanceCriteria: ["레거시 화면과 동일하게 동작합니다."],
          implementationFiles: ["src/pages/shop/App.vue"],
          reviewVerdicts: ["approved"],
        },
      ],
      changedFiles: ["src/pages/shop/App.vue"],
      implementationNotes: ["Vue 3 composition API를 사용했습니다."],
      legacy: {
        applicable: true,
        coverage: [
          {
            featureKey: "legacy_shop_main",
            requirementIds: ["REQ-SHOP-ROUTING"],
            status: "migrated",
            targetFiles: ["src/pages/shop/App.vue"],
            executableEvidencePaths: ["evidence/shop.json"],
            rationale: "Shop 메인 화면을 이관했습니다.",
          },
        ],
      },
      visual: {
        applicable: true,
        attempt: 1,
        status: "passed",
        results: [
          {
            targetId: "shop.main",
            name: "Shop detail",
            state: "initial detail viewport",
            route: "/shop/#/main/1",
            baselineKind: "legacy-screenshot",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 1,
            fixture: "QA Shop 1",
            masks: [],
            status: "passed",
            metrics: {
              exactMatchRatio: 0.94,
              reviewMatchRatio: 0.9912,
              threshold: 0.98,
              maskedAreaRatio: 0,
            },
            baselineArtifactId: `art_${"1".repeat(32)}`,
            actualArtifactId: `art_${"2".repeat(32)}`,
            diffArtifactId: `art_${"3".repeat(32)}`,
            overlayArtifactId: `art_${"4".repeat(32)}`,
          },
        ],
      },
      reviews: [
        {
          kind: "functional-review",
          verdict: "approved",
          summary: "기능 요구사항을 충족했습니다.",
          gates: [{ id: "functional", status: "passed" }],
          findings: [],
        },
        {
          kind: "design-review",
          verdict: "approved",
          summary: "디자인과 접근성 요구사항을 충족했습니다.",
          gates: [{ id: "visual", status: "passed" }],
          findings: [],
        },
      ],
      performance: {
        applicable: true,
        evidence: {
          lab: { metrics: { lcpMs: 364, cls: 0, tbtMs: 0 } },
          field: { status: "unavailable" },
        },
      },
      blockers: [],
      unrunValidations: [],
      evidencePaths: ["evidence/shop.json"],
    });
    const readyMarkdown = renderPrReportV2Markdown(ready);

    expect(readyMarkdown).toContain("**레거시 이관 결과**");
    expect(readyMarkdown).not.toContain("SpecToPR legacy delivery");
    expect(readyMarkdown).not.toContain("Completed the legacy Shop migration.");
    expect(readyMarkdown).toContain("REQ-SHOP-ROUTING: 라우팅 및 진입점");
    expect(readyMarkdown).toContain("| 화면 | 경로 · 상태 | 뷰포트 | 일치율 | 기준 | 결과 |");
    expect(readyMarkdown).toContain(
      "| 매장 메인 | /shop/&#35;/main/1 · 초기 화면 | 390×844 @1x | 99.12% | 98.00% | 통과 |",
    );
    expect(readyMarkdown).toContain("| 기능 리뷰 | 승인 | 1/1 통과 | 0건 |");
    expect(readyMarkdown).toContain("| LCP | 364ms |");
    expect(readyMarkdown).toContain("<summary>Run, 입력 출처, 변경 파일, 증거 보기</summary>");
    expect(readyMarkdown).toContain("### 변경 파일 1개");
    expect(readyMarkdown).toContain("## 실행 메타데이터");
    expect(readyMarkdown).not.toContain("Unexpected migration behavior.");
    expect(readyMarkdown).not.toContain("Gates: &#91;");
    expect(readyMarkdown).not.toContain("Findings: &#91;");
  });
});
