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
    expect(markdown).toContain(`인벤토리 해시: ${inventoryDigest}`);
    expect(markdown).toContain("source-fetch-literal, source-request-config");
    expect(markdown).toContain("탐지된 API 항목이 없습니다.");
    expect(markdown).not.toContain("## 1. Decision and review packet");

    const blockedWithApiGap = PrReportV2Schema.parse({
      ...report,
      api: {
        ...report.api,
        gaps: ["GET /shops/{id} 실행 증거 누락"],
      },
    });
    const blockedWithApiGapMarkdown = renderPrReportV2Markdown(blockedWithApiGap);
    expect(blockedWithApiGapMarkdown).toContain(
      "API 0개를 사용·검증했고, 0개는 범위에서 제외했으며, 1개는 미해결로 남았습니다.",
    );
    expect(blockedWithApiGapMarkdown).toContain("| 1 | 0 | 0 | 1 |");

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
    const blockedVisual = PrReportV2Schema.parse({
      ...ready,
      decision: "blocked",
      sectionStatuses: {
        ...ready.sectionStatuses,
        visual: "blocked",
        "functional-review": "not-run",
        "design-review": "not-run",
      },
      visual: {
        ...ready.visual,
        status: "failed",
        results: ready.visual.results.map((result) => ({
          ...result,
          status: "failed" as const,
          metrics: {
            ...result.metrics,
            reviewMatchRatio: 0.91,
            threshold: 0.92,
          },
        })),
      },
      reviews: [],
      blockers: ["implementation/VISUAL_REVIEW_THRESHOLD_NOT_MET: 92% 기준 미달"],
      unrunValidations: ["functional-review", "design-review"],
    });
    const blockedVisualMarkdown = renderPrReportV2Markdown(blockedVisual);
    const headings = (markdown: string) =>
      markdown
        .split("\n")
        .filter((line) => line.startsWith("## "))
        .filter((line) => line !== "## 확인 필요");
    const readyHeadings = headings(readyMarkdown);
    const blockedHeadings = headings(blockedVisualMarkdown);

    expect(blockedHeadings).toEqual(readyHeadings);
    expect(blockedVisual.sectionStatuses).toMatchObject({
      visual: "blocked",
      "functional-review": "not-run",
      "design-review": "not-run",
    });
    expect(blockedVisualMarkdown).toContain(
      "| Shop detail | /shop/&#35;/main/1 · initial detail viewport | 390×844 @1x | 91.00% | 94.00% | 92.00% | 실패 |",
    );
    expect(blockedVisualMarkdown).toContain("| 기능 리뷰 | 미실행 | 미실행 |");
    expect(blockedVisualMarkdown).toContain("| 디자인·접근성 | 미실행 | 미실행 |");

    expect(readyMarkdown).toContain("**레거시 이관 결과**");
    expect(readyMarkdown).not.toContain("SpecToPR legacy delivery");
    expect(readyMarkdown).not.toContain("Completed the legacy Shop migration.");
    expect(readyMarkdown).toContain("| 요구사항 | 리뷰 |");
    expect(readyMarkdown).not.toContain("| 요구사항 | 구현 파일 | 리뷰 |");
    expect(readyMarkdown).toContain("| Shop MPA entry and route parity | 승인 |");
    expect(readyMarkdown).not.toContain("legacy_shop_main");
    expect(readyMarkdown).toContain("| 상태 | 요구사항 | 이관 내용 |");
    expect(readyMarkdown).toContain("| 이관 | REQ-SHOP-ROUTING | Shop 메인 화면을 이관했습니다. |");
    expect(readyMarkdown).toContain(
      "| 화면 | 경로 · 상태 | 화면 크기 | 검토 일치율 | 픽셀 일치율 | 기준 | 결과 |",
    );
    expect(readyMarkdown).toContain(
      "| Shop detail | /shop/&#35;/main/1 · initial detail viewport | 390×844 @1x | 99.12% | 94.00% | 98.00% | 통과 |",
    );
    expect(readyMarkdown).not.toContain("shop.main");
    expect(readyMarkdown).toContain("| 기능 리뷰 | 승인 | 1/1 통과 | 0건 |");
    expect(readyMarkdown).toContain("| LCP | 364ms |");
    expect(readyMarkdown).toContain(
      "<summary>실행 정보, 입력 출처, 변경 파일, 검증 자료 보기</summary>",
    );
    expect(readyMarkdown).toContain("### 변경 파일 1개");
    expect(readyMarkdown).toContain("## 실행 메타데이터");
    expect(readyMarkdown).not.toContain("Unexpected migration behavior.");
    expect(readyMarkdown).not.toContain("Gates: &#91;");
    expect(readyMarkdown).not.toContain("Findings: &#91;");

    const mixedApiCoverage = PrReportV2Schema.parse({
      ...ready,
      api: {
        ...ready.api,
        operations: [
          {
            operationKey: "GET /shops/{id}",
            method: "GET",
            path: "/shops/{id}",
            status: "exercised",
            productionCallSites: ["src/api/shop.ts"],
            executableEvidencePaths: ["evidence/shop-api.json"],
            blocking: false,
          },
          {
            operationKey: "GET /shops/{id}/ranking",
            method: "GET",
            path: "/shops/{id}/ranking",
            status: "gap",
            productionCallSites: [],
            executableEvidencePaths: [],
            blocking: false,
            notes: "실행 증거가 없습니다.",
          },
          {
            operationKey: "DELETE /shops/{id}/favorite",
            method: "DELETE",
            path: "/shops/{id}/favorite",
            status: "intentionally-out-of-scope",
            productionCallSites: [],
            executableEvidencePaths: [],
            blocking: true,
            notes: "이번 이관 범위에서 제외했습니다.",
          },
        ],
        gaps: ["GET /shops/{id}/ranking 실행 증거 누락"],
      },
    });
    const mixedApiMarkdown = renderPrReportV2Markdown(mixedApiCoverage);

    expect(mixedApiMarkdown).toContain(
      "API 1개를 사용·검증했고, 1개는 범위에서 제외했으며, 1개는 미해결로 남았습니다.",
    );
    expect(mixedApiMarkdown).toContain("| 3 | 1 | 1 | 1 |");
    expect(mixedApiMarkdown).toContain("| GET /shops/{id}/ranking | 미해결 | — | — |");
    expect(mixedApiMarkdown).not.toContain("API -1개");

    const prefixCollision = PrReportV2Schema.parse({
      ...ready,
      api: {
        applicable: true,
        operations: [
          {
            operationKey: "GET /shops",
            method: "GET",
            path: "/shops",
            status: "gap",
            productionCallSites: [],
            executableEvidencePaths: [],
            blocking: true,
          },
        ],
        gaps: ["GET /shops/{id}: 별도 API 실행 증거 누락"],
      },
    });
    const prefixCollisionMarkdown = renderPrReportV2Markdown(prefixCollision);
    expect(prefixCollisionMarkdown).toContain("| 2 | 0 | 0 | 2 |");

    const translatedStatuses = PrReportV2Schema.parse({
      ...ready,
      api: {
        ...ready.api,
        operations: [
          {
            operationKey: "GET /planned",
            method: "GET",
            path: "/planned",
            status: "planned",
            productionCallSites: [],
            executableEvidencePaths: [],
            blocking: false,
          },
          {
            operationKey: "GET /blocked",
            method: "GET",
            path: "/blocked",
            status: "blocked",
            productionCallSites: [],
            executableEvidencePaths: [],
            blocking: true,
          },
        ],
        gaps: [],
      },
      legacy: {
        applicable: true,
        coverage: [
          {
            featureKey: "opaque-feature-key",
            requirementIds: ["REQ-SHOP-ROUTING"],
            status: "planned",
            targetFiles: [],
            executableEvidencePaths: [],
            rationale: "아직 이관하지 않았습니다.",
          },
        ],
      },
    });
    const translatedStatusesMarkdown = renderPrReportV2Markdown(translatedStatuses);
    expect(translatedStatusesMarkdown).toContain("| GET /planned | 계획 | — | — |");
    expect(translatedStatusesMarkdown).toContain("| GET /blocked | 차단 | — | — |");
    expect(translatedStatusesMarkdown).toContain(
      "| 계획 | REQ-SHOP-ROUTING | 아직 이관하지 않았습니다. |",
    );

    const reviewerFirst = PrReportV2Schema.parse({
      ...ready,
      template: "legacy-migration",
      gapDetails: [
        {
          id: `gap_${"a".repeat(32)}`,
          category: "api",
          severity: "major",
          status: "open",
          title: "POST /shops/{id}/favorite contract is unresolved",
          impact: "The favorite action must not send an invented request body.",
          reviewerDecision: "Confirm the write contract before merge.",
        },
      ],
    });
    const reviewerFirstMarkdown = renderPrReportV2Markdown(reviewerFirst);
    expect(reviewerFirstMarkdown).toContain("# 레거시 이관");
    expect(reviewerFirstMarkdown).toContain("## 먼저 확인할 Gap");
    expect(reviewerFirstMarkdown).toContain("Confirm the write contract before merge.");
    expect(reviewerFirstMarkdown).toContain("## 화면 비교");
    expect(reviewerFirstMarkdown).toContain("## 레거시 이관 범위");
    expect(reviewerFirstMarkdown).toContain("| 이관 | REQ-SHOP-ROUTING | src/pages/shop/App.vue |");
    expect(reviewerFirstMarkdown).not.toContain("## 원본 → 대상");
    expect(reviewerFirstMarkdown).toContain("## 검증");
    expect(reviewerFirstMarkdown).not.toContain("## API Gap");
    expect(reviewerFirstMarkdown).not.toContain("실행 메타데이터");
    expect(reviewerFirstMarkdown).not.toContain("run_");
    expect(reviewerFirstMarkdown).not.toContain("검증 자료 목록");

    const conciseFileMarkdown = renderPrReportV2Markdown(
      PrReportV2Schema.parse({
        ...reviewerFirst,
        changedFiles: Array.from({ length: 10 }, (_, index) => `src/module-${index}.ts`),
      }),
    );
    expect(conciseFileMarkdown).toContain("주요 변경 모듈:");
    expect(conciseFileMarkdown).toContain("외 2개");
    expect(conciseFileMarkdown).not.toContain("src/module-9.ts");

    const apiGapMarkdown = renderPrReportV2Markdown(
      PrReportV2Schema.parse({
        ...reviewerFirst,
        api: { ...reviewerFirst.api, gaps: ["POST /shops write payload is unresolved"] },
      }),
    );
    expect(apiGapMarkdown).toContain("## API Gap");
    expect(apiGapMarkdown).toContain("POST /shops write payload is unresolved");
    expect(apiGapMarkdown).not.toContain("## API 상태");

    const briefMarkdown = renderPrReportV2Markdown(
      PrReportV2Schema.parse({
        ...ready,
        template: "brief-delivery",
        summary: { ...ready.summary, exclusions: ["관리자 설정은 이번 범위에서 제외"] },
      }),
    );
    expect(briefMarkdown).toContain("## 요구사항 충족");
    expect(briefMarkdown).toContain("## 제외 범위");

    const featureMarkdown = renderPrReportV2Markdown(
      PrReportV2Schema.parse({ ...ready, template: "feature-flow" }),
    );
    expect(featureMarkdown).toContain("## 변경 전후 동작");
    expect(featureMarkdown).toContain("## 회귀 검증");
    expect(featureMarkdown).toContain("## 사용자 흐름 영상");

    const figmaMarkdown = renderPrReportV2Markdown(
      PrReportV2Schema.parse({ ...ready, template: "figma-ui" }),
    );
    expect(figmaMarkdown).toContain("## Figma 상태 매핑");
    expect(figmaMarkdown).toContain("## 디자인·접근성 검증");
  });

  it("rejects a visual report reference without a canonical packet binding", () => {
    const parsed = PrReportV2Schema.safeParse({
      schemaVersion: "pr-report-v2.1",
      runId: `run_${"a".repeat(32)}`,
      generatedAt: "2026-07-20T00:00:00.000Z",
      decision: "blocked",
      mode: "figma",
      sectionStatuses: {
        api: "not-applicable",
        legacy: "not-applicable",
        visual: "blocked",
        "functional-review": "not-run",
        "design-review": "not-run",
        performance: "not-run",
        "feature-evidence": "not-applicable",
      },
      summary: { title: "Blocked visual delivery", bullets: [], exclusions: [] },
      sources: [],
      skills: { hints: [], applied: [] },
      requirements: [],
      changedFiles: [],
      implementationNotes: [],
      api: { applicable: false, operations: [], gaps: [] },
      legacy: { applicable: false, coverage: [] },
      visual: {
        applicable: true,
        reportArtifactId: `art_${"b".repeat(32)}`,
        attempt: 3,
        status: "failed",
        results: [],
      },
      reviews: [],
      performance: { applicable: false },
      gaps: [],
      blockers: ["VISUAL_REVIEW_THRESHOLD_NOT_MET"],
      unrunValidations: ["functional-review", "design-review"],
      risks: [],
      rollback: {
        trigger: "Visual threshold failure.",
        strategy: "Start a new run.",
        steps: ["Inspect the failed comparison."],
        dataImpact: "None.",
        postChecks: ["Repeat visual review."],
      },
      evidencePaths: [],
      artifactIds: [`art_${"b".repeat(32)}`],
    });

    expect(parsed.success).toBe(false);
  });
});
