import type { PrReportV2 } from "./pr-report-model.js";
import {
  markdownBullet,
  markdownInline,
  markdownTableCell,
  redactSecretShapes,
} from "./markdown-safe.js";

export interface ReadyWorkflowReportInput {
  runId: string;
  reviewPacket: {
    id: string;
    revision: number;
    baseSha?: string | null;
    headSha?: string | null;
    evidenceDigest: string;
    diffDigest: string;
    changedFiles: readonly string[];
  };
  guidanceTrace: {
    explicit: readonly string[];
    discovered: readonly string[];
    skillHints: readonly string[];
    appliedSkills: readonly string[];
  };
  requirementManifest: readonly {
    id: string;
    title: string;
    acceptanceCriteria: readonly string[];
  }[];
  legacyBaseline?: {
    scope: string;
    checks: readonly {
      status: string;
      command: string;
      resultPath: string;
    }[];
  };
  evidencePaths: readonly string[];
  reviews: readonly {
    kind: "functional-review" | "design-review";
    requirements: readonly {
      id: string;
      verdict: string;
    }[];
    gateResults: readonly {
      id: string;
      status: string;
      evidencePaths: readonly string[];
    }[];
    findings: readonly {
      severity: string;
      title: string;
    }[];
  }[];
  featureVideoPath?: string;
}

export function renderReadyWorkflowReport(input: ReadyWorkflowReportInput): string {
  const verdictFor = (requirementId: string) =>
    input.reviews
      .flatMap((review) => review.requirements)
      .filter((requirement) => requirement.id === requirementId)
      .map((requirement) => requirement.verdict)
      .join(", ");
  const gateLines = input.reviews.flatMap((review) =>
    review.gateResults.map(
      (gate) => `- ${review.kind}/${gate.id}: ${gate.status} (${gate.evidencePaths.join(", ")})`,
    ),
  );
  const riskLines = input.reviews.flatMap((review) =>
    review.findings.map((finding) => `- ${finding.severity}: ${finding.title}`),
  );
  const appliedSkills = uniqueValues([
    ...input.guidanceTrace.skillHints,
    ...input.guidanceTrace.appliedSkills,
  ]);

  return [
    `# SpecToPR Run ${input.runId}`,
    "",
    "## Decision",
    "",
    "Ready for draft review.",
    "",
    "## Review packet",
    "",
    `- ID: ${input.reviewPacket.id}`,
    `- Revision: ${input.reviewPacket.revision}`,
    `- Base: ${input.reviewPacket.baseSha ?? "unavailable"}`,
    `- Head: ${input.reviewPacket.headSha ?? "unavailable"}`,
    `- Evidence digest: ${input.reviewPacket.evidenceDigest}`,
    `- Diff digest: ${input.reviewPacket.diffDigest}`,
    "",
    "## Project guidance",
    "",
    "### Explicit",
    "",
    ...(input.guidanceTrace.explicit.length === 0
      ? ["- None."]
      : input.guidanceTrace.explicit.map((guidancePath) => `- ${markdownListValue(guidancePath)}`)),
    "",
    "### Automatically discovered",
    "",
    ...(input.guidanceTrace.discovered.length === 0
      ? ["- None."]
      : input.guidanceTrace.discovered.map(
          (guidancePath) => `- ${markdownListValue(guidancePath)}`,
        )),
    "",
    "## Applied optional skills",
    "",
    ...(appliedSkills.length === 0 ? ["- None."] : appliedSkills.map((skill) => `- ${skill}`)),
    "",
    "## Requirement traceability",
    "",
    "| Requirement | Acceptance criteria | Review verdict |",
    "| --- | --- | --- |",
    ...input.requirementManifest.map(
      (requirement) =>
        `| ${markdownTableCell(`${requirement.id}: ${requirement.title}`)} | ${markdownTableCell(requirement.acceptanceCriteria.join("\n"))} | ${markdownTableCell(verdictFor(requirement.id))} |`,
    ),
    ...(input.legacyBaseline === undefined
      ? []
      : [
          "",
          "## Focused legacy baseline",
          "",
          `- Scope: ${input.legacyBaseline.scope}`,
          ...input.legacyBaseline.checks.map(
            (check) => `- ${check.status}: \`${check.command}\` → ${check.resultPath}`,
          ),
        ]),
    "",
    "## Changed files",
    "",
    ...(input.reviewPacket.changedFiles.length === 0
      ? ["- No changed files declared."]
      : input.reviewPacket.changedFiles.map((file) => `- ${file}`)),
    "",
    "## Evidence",
    "",
    ...input.evidencePaths.map((evidencePath) => `- ${evidencePath}`),
    "",
    "## Validation gates",
    "",
    ...(gateLines.length === 0 ? ["- No gates recorded."] : gateLines),
    "",
    "## Risks",
    "",
    ...(riskLines.length === 0 ? ["- No known review findings."] : riskLines),
    ...(input.featureVideoPath === undefined
      ? []
      : ["", "## Feature E2E video", "", `- ${input.featureVideoPath}`]),
    "",
  ].join("\n");
}

export function renderPrReportV2Markdown(report: PrReportV2): string {
  if (report.template !== undefined) {
    return renderReviewerFirstPrBody(report);
  }
  const apiExcluded = report.api.operations.filter((operation) =>
    /out-of-scope|excluded/i.test(operation.status),
  ).length;
  const apiUnresolvedOperations = report.api.operations.filter((operation) =>
    /^(gap|planned|blocked)$/i.test(operation.status),
  );
  const apiUnresolvedKeys = new Set(
    apiUnresolvedOperations.map((operation) => operation.operationKey),
  );
  for (const gap of report.api.gaps) {
    const matchingOperation = apiUnresolvedOperations.find((operation) =>
      gapReferencesOperation(gap, operation.operationKey),
    );
    apiUnresolvedKeys.add(matchingOperation?.operationKey ?? `gap:${normalizeGap(gap)}`);
  }
  const apiGaps = apiUnresolvedKeys.size;
  const apiVerified = report.api.operations.filter(
    (operation) => operation.status === "exercised",
  ).length;
  const apiAdditionalGapCount = [...apiUnresolvedKeys].filter((key) =>
    key.startsWith("gap:"),
  ).length;
  const apiTotal = report.api.operations.length + apiAdditionalGapCount;
  const legacyMigrated = report.legacy.coverage.filter(
    (coverage) => coverage.status === "migrated",
  ).length;
  const legacyExcluded = report.legacy.coverage.filter((coverage) =>
    /excluded|out-of-scope/i.test(coverage.status),
  ).length;
  const legacyUnresolved = report.legacy.coverage.length - legacyMigrated - legacyExcluded;
  const visualPassed = report.visual.results.filter((result) => result.status === "passed").length;
  const reviewRows = report.reviews.map((review) => {
    const passedGates = review.gates.filter((gate) => gate["status"] === "passed").length;
    return `| ${review.kind === "functional-review" ? "기능 리뷰" : "디자인·접근성 리뷰"} | ${koreanVerdict(review.verdict)} | ${passedGates}/${review.gates.length} 통과 | ${review.findings.length}건 |`;
  });
  const visualRows = report.visual.results.map(
    (result) =>
      `| ${markdownTableCell(visualDisplayName(result))} | ${markdownTableCell(`${result.route} · ${visualStateName(result.state)}`)} | ${result.viewport.width}×${result.viewport.height} @${result.deviceScaleFactor}x | ${(result.metrics.reviewMatchRatio * 100).toFixed(2)}% | ${(result.metrics.exactMatchRatio * 100).toFixed(2)}% | ${(result.metrics.threshold * 100).toFixed(2)}% | ${koreanOperationStatus(result.status)} |`,
  );
  const apiRows = report.api.operations.map(
    (operation) =>
      `| ${markdownTableCell(operation.operationKey)} | ${koreanOperationStatus(operation.status)} | ${markdownTableCell(operation.productionCallSites.join(", ") || "—")} | ${markdownTableCell(operation.executableEvidencePaths.join(", ") || "—")} |`,
  );
  const legacyRows = report.legacy.coverage.map(
    (coverage) =>
      `| ${koreanOperationStatus(coverage.status)} | ${markdownTableCell(coverage.requirementIds.join(", "))} | ${markdownTableCell(coverage.rationale)} |`,
  );
  const performanceRows = renderPerformanceRows(report.performance.evidence);
  const issueRows = [
    ...report.gaps.map((gap) => `| 미해결 | ${markdownTableCell(gap)} |`),
    ...report.blockers.map((blocker) => `| 차단 | ${markdownTableCell(blocker)} |`),
    ...report.unrunValidations.map((validation) => `| 미실행 | ${markdownTableCell(validation)} |`),
    ...(report.decision === "blocked"
      ? report.rollback.steps.map((step) => `| 재개 | ${markdownTableCell(step)} |`)
      : []),
  ];
  const feature = report.featureEvidence;
  const showApi =
    report.api.applicable &&
    (report.api.operations.length > 0 ||
      report.api.gaps.length > 0 ||
      report.api.inventoryDigest !== undefined ||
      (report.api.discoveryAdapters?.length ?? 0) > 0);
  const showLegacy =
    report.legacy.applicable && (report.mode === "legacy" || report.legacy.coverage.length > 0);
  const showVisual = report.visual.applicable;

  const rendered = [
    "# 요약",
    "",
    `**${koreanReportTitle(report.mode)}**`,
    "",
    "| 항목 | 내용 |",
    "| --- | --- |",
    `| 상태 | ${report.decision === "ready" ? "리뷰 가능" : "차단"} |`,
    `| 작업 유형 | ${koreanMode(report.mode)} |`,
    `| 변경 파일 | ${report.changedFiles.length}개 |`,
    ...(showVisual ? [`| 화면 비교 | ${visualPassed}/${report.visual.results.length} 통과 |`] : []),
    "",
    "## 변경 내용",
    "",
    "| # | 내용 |",
    "| ---: | --- |",
    ...(report.decision === "blocked"
      ? ["| 1 | 검증이 차단되어 구현·리뷰가 완료되지 않았습니다. |"]
      : report.mode === "legacy"
        ? [`| 1 | 레거시 항목 ${legacyMigrated}개를 대상 프로젝트 구조로 이관했습니다. |`]
        : ["| 1 | 요청 범위의 구현을 완료했습니다. |"]),
    ...(showApi
      ? [
          `| 2 | API ${apiVerified}개를 사용·검증했고, ${apiExcluded}개는 범위에서 제외했으며, ${apiGaps}개는 미해결로 남았습니다. |`,
        ]
      : []),
    ...(showVisual
      ? [`| 3 | 동일한 경로·상태·화면 크기에서 화면 ${visualPassed}개를 비교했습니다. |`]
      : []),
    "",
    "## 검증 결과",
    "",
    "| 검증 | 상태 | 요약 |",
    "| --- | --- | --- |",
    ...(showApi
      ? [
          `| API | ${koreanSectionStatus(reportSectionStatus(report, "api", true))} | ${report.api.operations.length}개 항목 |`,
        ]
      : []),
    ...(showLegacy
      ? [
          `| 레거시 이관 | ${koreanSectionStatus(reportSectionStatus(report, "legacy", true))} | ${legacyMigrated}/${report.legacy.coverage.length} 이관 |`,
        ]
      : []),
    ...(showVisual
      ? [
          `| 화면 일치율 | ${koreanSectionStatus(reportSectionStatus(report, "visual", true))} | ${visualPassed}/${report.visual.results.length} 통과 |`,
        ]
      : []),
    `| 기능 리뷰 | ${koreanSectionStatus(reportSectionStatus(report, "functional-review", true))} | ${reviewVerdict(report, "functional-review")} |`,
    `| 디자인·접근성 | ${koreanSectionStatus(reportSectionStatus(report, "design-review", report.visual.applicable))} | ${reviewVerdict(report, "design-review")} |`,
    `| 성능 | ${koreanSectionStatus(reportSectionStatus(report, "performance", report.performance.applicable))} | ${report.performance.applicable ? "측정 완료" : "해당 없음"} |`,
    ...(feature === undefined
      ? []
      : [
          `| 기능 E2E | ${koreanSectionStatus(reportSectionStatus(report, "feature-evidence", true))} | 증거 포함 |`,
        ]),
    "",
    "## 요구사항",
    "",
    "| 요구사항 | 리뷰 |",
    "| --- | --- |",
    ...(report.requirements.length === 0
      ? ["| 없음 | — |"]
      : report.requirements.map(
          (requirement) =>
            `| ${markdownTableCell(requirement.title)} | ${markdownTableCell(koreanReviewVerdicts(requirement.reviewVerdicts))} |`,
        )),
    "",
    ...(showApi
      ? [
          "## API",
          "",
          "| 전체 | 사용·검증 | 범위 제외 | 미해결 |",
          "| ---: | ---: | ---: | ---: |",
          `| ${apiTotal} | ${apiVerified} | ${apiExcluded} | ${apiGaps} |`,
          "",
          "<details>",
          "<summary>API 상세</summary>",
          "",
          ...(report.api.inventoryDigest === undefined
            ? []
            : [`- 인벤토리 해시: ${report.api.inventoryDigest}`]),
          ...(report.api.discoveryAdapters === undefined
            ? []
            : [`- 탐지 방식: ${report.api.discoveryAdapters.join(", ")}`]),
          ...(report.api.operations.length === 0
            ? ["- 탐지된 API 항목이 없습니다."]
            : [
                "",
                "| API | 상태 | 호출 위치 | 실행 증거 |",
                "| --- | --- | --- | --- |",
                ...apiRows,
              ]),
          ...(report.api.gaps.length === 0
            ? []
            : ["", ...report.api.gaps.map((gap) => `- 미해결: ${markdownBullet(gap)}`)]),
          "",
          "</details>",
          "",
        ]
      : []),
    ...(showLegacy
      ? [
          "## 레거시 이관",
          "",
          "| 전체 | 이관 | 범위 제외 | 미해결 |",
          "| ---: | ---: | ---: | ---: |",
          `| ${report.legacy.coverage.length} | ${legacyMigrated} | ${legacyExcluded} | ${Math.max(legacyUnresolved, 0)} |`,
          "",
          "<details>",
          "<summary>레거시 항목 상세</summary>",
          "",
          ...(report.legacy.coverage.length === 0
            ? ["- 기록된 레거시 항목이 없습니다."]
            : ["| 상태 | 요구사항 | 이관 내용 |", "| --- | --- | --- |", ...legacyRows]),
          "",
          "</details>",
          "",
        ]
      : []),
    ...(showVisual
      ? [
          "## 화면 일치율",
          "",
          "| 화면 | 경로 · 상태 | 화면 크기 | 검토 일치율 | 픽셀 일치율 | 기준 | 결과 |",
          "| --- | --- | --- | ---: | ---: | ---: | --- |",
          ...(report.visual.results.length === 0
            ? ["| 없음 | — | — | — | — | — | 미실행 |"]
            : visualRows),
          "",
          VISUAL_PREVIEW_SLOT,
          "",
        ]
      : []),
    "## 독립 리뷰",
    "",
    "| 리뷰 | 결과 | 통과 조건 | 발견사항 |",
    "| --- | --- | ---: | ---: |",
    ...(reviewRows.length === 0 ? ["| 미실행 | — | 0/0 | 0건 |"] : reviewRows),
    "",
    ...(performanceRows.length === 0
      ? []
      : ["## 성능", "", "| 지표 | 값 |", "| --- | ---: |", ...performanceRows, ""]),
    ...(issueRows.length === 0
      ? []
      : ["## 확인 필요", "", "| 구분 | 내용 |", "| --- | --- |", ...issueRows, ""]),
    ...(report.risks.length === 0
      ? []
      : [
          "## 위험 및 대응",
          "",
          "| 가능성 · 영향 | 대응 |",
          "| --- | --- |",
          ...report.risks.map(
            (risk) =>
              `| ${markdownTableCell(`${risk.likelihood} · ${risk.impact}`)} | ${markdownTableCell(risk.mitigation)} |`,
          ),
          "",
        ]),
    "## 롤백",
    "",
    "| 트리거 | 전략 | 데이터 영향 |",
    "| --- | --- | --- |",
    "| 검증된 화면·동작이 병합 후 회귀할 때 | 해당 변경 커밋을 되돌리고 이전 정상 버전을 재배포 | 자동 데이터 롤백 없음 |",
    "",
    "<details>",
    "<summary>롤백 절차</summary>",
    "",
    "1. 해당 변경 커밋을 공유 이력 재작성 없이 되돌립니다.",
    "2. 이전 정상 버전을 재배포합니다.",
    "",
    "- 확인: 영향받은 기능 테스트와 화면 비교를 다시 실행합니다.",
    "- 확인: 대상 경로와 API 상태를 확인합니다.",
    "",
    "</details>",
    "",
    "## 실행 메타데이터",
    "",
    "<details>",
    "<summary>실행 정보, 입력 출처, 변경 파일, 검증 자료 보기</summary>",
    "",
    "| 항목 | 값 |",
    "| --- | --- |",
    `| 실행 ID | ${markdownTableCell(report.runId)} |`,
    `| 모드 | ${koreanMode(report.mode)} |`,
    `| 생성 시각 | ${markdownTableCell(report.generatedAt)} |`,
    ...(report.binding === undefined
      ? ["| 검토 묶음 | 생성 전 차단 |"]
      : [
          `| 검토 묶음 | ${markdownTableCell(report.binding.reviewPacketId)} |`,
          `| 기준 커밋 | ${markdownTableCell(report.binding.baseSha)} |`,
          `| 변경 커밋 | ${markdownTableCell(report.binding.headSha)} |`,
          `| 변경 해시 | ${markdownTableCell(report.binding.diffDigest)} |`,
        ]),
    "",
    "### 입력 출처",
    "",
    ...(report.sources.length === 0
      ? ["- 없음"]
      : [
          "| 종류 | 위치 | 해시 |",
          "| --- | --- | --- |",
          ...report.sources.map(
            (source) =>
              `| ${source.kind} | ${markdownTableCell(source.locator)} | ${markdownTableCell(source.digest ?? "—")} |`,
          ),
        ]),
    "",
    `### 변경 파일 ${report.changedFiles.length}개`,
    "",
    ...(report.changedFiles.length === 0
      ? ["- 없음"]
      : report.changedFiles.map((file) => `- ${markdownBullet(file)}`)),
    "",
    "### 검증 자료 목록",
    "",
    ...listOrNone(report.evidencePaths),
    "",
    "</details>",
    "",
  ].join("\n");
  return redactSecretShapes(rendered);
}

const VISUAL_PREVIEW_SLOT = "<!-- spec-to-pr:visual-evidence:slot -->";

/**
 * The 1.0 PR body is deliberately small: it is a review surface, not a Run
 * export. Durable JSON artifacts retain provenance, logs, digests, and other
 * machine-facing detail without making every reviewer parse them.
 */
function renderReviewerFirstPrBody(report: PrReportV2): string {
  const template = report.template ?? templateForMode(report.mode);
  const gaps = reviewerFacingGaps(report);
  const changedFilePreview = report.changedFiles.slice(0, 8).map(markdownInline);
  const omittedChangedFileCount = report.changedFiles.length - changedFilePreview.length;
  const visualRows = report.visual.results.map((result) => {
    const score = `${(result.metrics.reviewMatchRatio * 100).toFixed(2)}%`;
    return `| ${markdownTableCell(result.name)} | ${markdownTableCell(`${result.route} · ${visualStateName(result.state)}`)} | ${koreanBaselineKind(result.baselineKind)} | ${score} | ${koreanOperationStatus(result.status)} |`;
  });
  const reviewRows: Array<[string, string, string]> = [
    [
      "기능 리뷰",
      reportSectionStatus(report, "functional-review", true),
      reviewVerdict(report, "functional-review"),
    ],
    [
      "디자인·접근성 리뷰",
      reportSectionStatus(report, "design-review", report.visual.applicable),
      reviewVerdict(report, "design-review"),
    ],
  ];
  const feature = asRecord(report.featureEvidence);
  const featureVideo =
    typeof feature?.["videoPath"] === "string" ? feature["videoPath"] : undefined;
  const featureResult =
    typeof feature?.["resultPath"] === "string" ? feature["resultPath"] : undefined;
  const showApi =
    report.api.applicable &&
    (report.api.operations.some(
      (operation) =>
        operation.status !== "exercised" && operation.status !== "intentionally-out-of-scope",
    ) ||
      report.api.gaps.length > 0);
  const apiGapOperations = report.api.operations.filter(
    (operation) =>
      operation.status !== "exercised" && operation.status !== "intentionally-out-of-scope",
  );
  const showLegacy = report.legacy.applicable && report.legacy.coverage.length > 0;
  const legacySources = report.sources
    .filter((source) => source.kind === "legacy")
    .map((source) => source.resolvedLocator ?? source.locator);
  const figmaSources = report.sources
    .filter((source) => source.kind === "figma")
    .map((source) => source.resolvedLocator ?? source.locator);
  const lines = [
    `# ${templateTitle(template)}`,
    "",
    `**${report.decision === "ready" ? "Draft review" : "Draft · merge blocked"}**`,
    "",
    ...(gaps.length === 0
      ? []
      : [
          "## 먼저 확인할 Gap",
          "",
          "| 상태 | Gap | 영향 | 리뷰어 결정 |",
          "| --- | --- | --- | --- |",
          ...gaps.map(
            (gap) =>
              `| ${koreanGapStatus(gap.status)} | ${markdownTableCell(gap.title)} | ${markdownTableCell(gap.impact)} | ${markdownTableCell(gap.reviewerDecision)} |`,
          ),
          "",
        ]),
    "## 변경 내용",
    "",
    ...(report.summary.bullets.length > 0
      ? report.summary.bullets.map((bullet) => `- ${markdownBullet(bullet)}`)
      : ["- 구현 범위와 증빙을 준비했습니다."]),
    ...(changedFilePreview.length === 0
      ? []
      : [
          "",
          "주요 변경 모듈: " +
            changedFilePreview.join(", ") +
            (omittedChangedFileCount > 0 ? ` 외 ${omittedChangedFileCount}개` : ""),
        ]),
    "",
    ...(showLegacy
      ? [
          "## 레거시 이관 범위",
          "",
          "| 상태 | 요구사항 | 대상 파일 |",
          "| --- | --- | --- |",
          ...report.legacy.coverage.map(
            (coverage) =>
              `| ${koreanOperationStatus(coverage.status)} | ${markdownTableCell(coverage.requirementIds.join(", "))} | ${markdownTableCell(coverage.targetFiles.join(", ") || "—")} |`,
          ),
          "",
        ]
      : []),
    ...(template === "legacy-migration"
      ? [
          "## 원본 → 대상",
          "",
          "| 원본 | 대상 | 이관 상태 |",
          "| --- | --- | --- |",
          ...(report.legacy.coverage.length === 0
            ? ["| 원본 범위 미확정 | — | Gap 확인 필요 |"]
            : report.legacy.coverage.map(
                (coverage) =>
                  `| ${markdownTableCell(legacySources.join(", ") || coverage.featureKey)} | ${markdownTableCell(coverage.targetFiles.join(", ") || "—")} | ${koreanOperationStatus(coverage.status)} |`,
              )),
          "",
        ]
      : []),
    ...(template === "brief-delivery"
      ? [
          "## 요구사항 충족",
          "",
          "| 요구사항 | 구현 파일 | 리뷰 판정 |",
          "| --- | --- | --- |",
          ...(report.requirements.length === 0
            ? ["| 요구사항 추출 없음 | — | 미실행 |"]
            : report.requirements.map(
                (requirement) =>
                  `| ${markdownTableCell(requirement.title)} | ${markdownTableCell(requirement.implementationFiles.join(", ") || "—")} | ${markdownTableCell(requirement.reviewVerdicts.join(", ") || "미실행")} |`,
              )),
          ...(report.summary.exclusions.length === 0
            ? []
            : [
                "",
                "## 제외 범위",
                "",
                ...report.summary.exclusions.map((exclusion) => `- ${markdownBullet(exclusion)}`),
              ]),
          "",
        ]
      : []),
    ...(template === "feature-flow"
      ? [
          "## 변경 전후 동작",
          "",
          "| 구분 | 확인 내용 |",
          "| --- | --- |",
          `| 변경 후 | ${markdownTableCell(report.implementationNotes.join(" ") || report.summary.bullets.join(" "))} |`,
          `| 변경 전 | ${markdownTableCell(legacySources.join(", ") || "명시된 기준 화면·요구사항을 비교 기준으로 사용")} |`,
          "",
          "## 회귀 검증",
          "",
          `- 기능 리뷰: ${reviewVerdict(report, "functional-review")}`,
          `- 사용자 흐름 테스트: ${featureResult === undefined ? "미실행" : markdownInline(featureResult)}`,
          "",
        ]
      : []),
    ...(template === "figma-ui"
      ? [
          "## Figma 상태 매핑",
          "",
          "| Figma 기준 | 구현 경로 · 상태 | 상태별 일치율 | 결과 |",
          "| --- | --- | ---: | --- |",
          ...(report.visual.results.length === 0
            ? [
                "| " +
                  markdownTableCell(figmaSources.join(", ") || "Figma 기준 미확인") +
                  " | — | — | 미실행 |",
              ]
            : report.visual.results.map(
                (result) =>
                  `| ${markdownTableCell(figmaSources.join(", ") || result.name)} | ${markdownTableCell(`${result.route} · ${visualStateName(result.state)}`)} | ${(result.metrics.reviewMatchRatio * 100).toFixed(2)}% | ${koreanOperationStatus(result.status)} |`,
              )),
          "",
          "## 디자인·접근성 검증",
          "",
          `- ${reviewVerdict(report, "design-review")}`,
          "",
        ]
      : []),
    ...(report.visual.applicable
      ? [
          "## 화면 비교",
          "",
          "| 화면 | 경로 · 상태 | 기준 출처 | 일치율 | 결과 |",
          "| --- | --- | --- | ---: | --- |",
          ...(visualRows.length === 0 ? ["| 비교 결과 없음 | — | — | — | 미실행 |"] : visualRows),
          "",
          VISUAL_PREVIEW_SLOT,
          "",
        ]
      : []),
    ...(template === "feature-flow"
      ? [
          "## 사용자 흐름 영상",
          "",
          "| 실행 상태 | 영상 | 테스트 결과 |",
          "| --- | --- | --- |",
          `| ${featureVideo === undefined ? "미실행" : "실행됨"} | ${markdownTableCell(featureVideo ?? "—")} | ${markdownTableCell(featureResult ?? "—")} |`,
          "",
        ]
      : []),
    "## 검증",
    "",
    "| 검증 | 실행 상태 | 판정/핵심 결과 |",
    "| --- | --- | --- |",
    ...(report.visual.applicable
      ? [
          `| 화면 비교 | ${koreanSectionStatus(reportSectionStatus(report, "visual", true))} | ${visualSummary(report)} |`,
        ]
      : []),
    ...reviewRows.map(
      ([label, execution, verdict]) =>
        `| ${label} | ${koreanSectionStatus(execution)} | ${markdownTableCell(verdict)} |`,
    ),
    ...(report.performance.applicable
      ? [
          `| 성능 | ${koreanSectionStatus(reportSectionStatus(report, "performance", true))} | ${report.performance.evidence === undefined ? "미실행" : "측정 완료"} |`,
        ]
      : []),
    ...(showApi
      ? [
          `| API | ${koreanSectionStatus(reportSectionStatus(report, "api", true))} | ${apiSummary(report)} |`,
        ]
      : []),
    "",
    ...(showApi
      ? [
          "## API Gap",
          "",
          "| API | 상태 | 메모 |",
          "| --- | --- | --- |",
          ...apiGapOperations.map(
            (operation) =>
              `| ${markdownTableCell(operation.operationKey)} | ${koreanOperationStatus(operation.status)} | ${markdownTableCell(operation.notes ?? "—")} |`,
          ),
          ...report.api.gaps.map((gap) => `| — | 미해결 | ${markdownTableCell(gap)} |`),
          "",
        ]
      : []),
  ];

  return redactSecretShapes(lines.join("\n"));
}

type ReviewerFacingGap = {
  category: string;
  status: string;
  title: string;
  impact: string;
  reviewerDecision: string;
};

function reviewerFacingGaps(report: PrReportV2): ReviewerFacingGap[] {
  const details = report.gapDetails
    .filter((gap) => gap.status !== "resolved")
    .map((gap) => ({
      category: gap.category,
      status: gap.status,
      title: gap.title,
      impact: gap.impact,
      reviewerDecision: gap.reviewerDecision ?? "영향과 다음 조치를 확인해 주세요.",
    }));
  const detailedTitles = new Set(details.map((gap) => gap.title));
  const derived = [
    ...report.gaps,
    ...report.blockers,
    ...report.unrunValidations.map((validation) => `${validation}: 실행되지 않았습니다.`),
  ]
    .filter((title) => !detailedTitles.has(title))
    .map((title) => ({
      category: "workflow",
      status: "open",
      title,
      impact: "검증 또는 동작 범위가 아직 확정되지 않았습니다.",
      reviewerDecision: "병합 전 해결 또는 위험 수용 여부를 결정해 주세요.",
    }));
  return [...details, ...derived];
}

function templateForMode(mode: PrReportV2["mode"]): NonNullable<PrReportV2["template"]> {
  if (mode === "legacy") return "legacy-migration";
  if (mode === "brief") return "brief-delivery";
  if (mode === "feature") return "feature-flow";
  return "figma-ui";
}

function templateTitle(template: NonNullable<PrReportV2["template"]>): string {
  const titles: Record<NonNullable<PrReportV2["template"]>, string> = {
    "legacy-migration": "레거시 이관",
    "brief-delivery": "Brief 전달",
    "feature-flow": "기능 개발",
    "figma-ui": "Figma UI 구현",
  };
  return titles[template];
}

function koreanGapStatus(status: string): string {
  const labels: Record<string, string> = {
    open: "미해결",
    assumed: "가정",
    waived: "면제",
    resolved: "해결",
  };
  return labels[status] ?? status;
}

function koreanBaselineKind(kind: "figma" | "legacy-screenshot"): string {
  return kind === "figma" ? "Figma" : "레거시 캡처";
}

function visualSummary(report: PrReportV2): string {
  if (report.visual.status === "not-run") return "비교를 실행하지 못했습니다.";
  if (report.visual.status === "blocked") return "비교가 차단되었습니다.";
  const passed = report.visual.results.filter((result) => result.status === "passed").length;
  return `${passed}/${report.visual.results.length} 화면 통과`;
}

function apiSummary(report: PrReportV2): string {
  const unresolved =
    report.api.operations.filter((operation) => operation.status === "gap").length +
    report.api.gaps.length;
  return unresolved === 0
    ? `${report.api.operations.length}개 항목 확인`
    : `${report.api.operations.length}개 중 ${unresolved}개 Gap`;
}

function koreanMode(mode: PrReportV2["mode"]): string {
  const labels: Record<PrReportV2["mode"], string> = {
    auto: "자동",
    brief: "기획 기반",
    legacy: "레거시 이관",
    feature: "기능 개발",
    figma: "Figma 구현",
  };
  return labels[mode];
}

function koreanReportTitle(mode: PrReportV2["mode"]): string {
  const titles: Record<PrReportV2["mode"], string> = {
    auto: "변경 검증 결과",
    brief: "기획 기반 구현 결과",
    legacy: "레거시 이관 결과",
    feature: "기능 개발 결과",
    figma: "Figma 구현 결과",
  };
  return titles[mode];
}

function koreanReviewVerdicts(verdicts: readonly string[]): string {
  if (verdicts.length === 0) return "—";
  return verdicts
    .map((verdict) => {
      const [kind, value] = verdict.split(":", 2);
      if (value === undefined) return koreanVerdict(verdict);
      const label =
        kind === "functional-review" ? "기능" : kind === "design-review" ? "디자인" : kind;
      return `${label} ${koreanVerdict(value)}`;
    })
    .join(", ");
}

function visualDisplayName(input: {
  targetId: string;
  name: string;
  route: string;
  state: string;
  viewport: { width: number; height: number };
}): string {
  const name = input.name.trim();
  if (name !== "" && name !== input.targetId && !looksLikeOpaqueIdentifier(name)) {
    return name;
  }

  const routeLabel = routeScreenName(input.route);
  if (routeLabel !== undefined) return routeLabel;

  const state = input.state.trim();
  if (state !== "" && state !== input.targetId && !looksLikeOpaqueIdentifier(state)) {
    return state;
  }

  return `${input.viewport.width}×${input.viewport.height} 화면`;
}

function visualStateName(state: string): string {
  const value = state.trim();
  return value === "" || looksLikeOpaqueIdentifier(value) ? "기본 상태" : value;
}

function routeScreenName(route: string): string | undefined {
  const path = route.split("?", 1)[0] ?? route;
  const segments = path
    .split(/[/:#]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && !/^\d+$/.test(segment));
  const segment = segments.at(-1);
  if (segment === undefined || looksLikeOpaqueIdentifier(segment)) return undefined;
  return `${segment.replace(/[._-]+/g, " ")} 화면`;
}

function looksLikeOpaqueIdentifier(value: string): boolean {
  return (
    /^(?:legacy_)?[a-f0-9]{16,}$/i.test(value) ||
    /^(?:target|screen|view)?[_-]?[a-z0-9]{20,}$/i.test(value)
  );
}

function normalizeGap(gap: string): string {
  return gap.trim().replace(/\s+/g, " ").toLowerCase();
}

function gapReferencesOperation(gap: string, operationKey: string): boolean {
  const normalized = gap.trim();
  if (!normalized.startsWith(operationKey)) return false;
  const suffix = normalized.slice(operationKey.length);
  return suffix === "" || /^[:\s]/u.test(suffix);
}

function koreanSectionStatus(status: string): string {
  const labels: Record<string, string> = {
    complete: "완료",
    "not-run": "미실행",
    blocked: "차단",
    "not-applicable": "해당 없음",
  };
  return labels[status] ?? status;
}

function koreanVerdict(verdict: string): string {
  const labels: Record<string, string> = {
    approved: "승인",
    accepted: "승인",
    passed: "통과",
    blocked: "차단",
    planned: "계획",
    gap: "미해결",
    "review-needed": "검토 필요",
    rejected: "거절",
    "changes-requested": "수정 요청",
  };
  return labels[verdict] ?? verdict;
}

function koreanOperationStatus(status: string): string {
  const labels: Record<string, string> = {
    exercised: "사용·검증",
    migrated: "이관",
    planned: "계획",
    captured: "캡처 완료",
    compared: "비교 완료",
    passed: "통과",
    failed: "실패",
    complete: "완료",
    "not-run": "미실행",
    "not-applicable": "해당 없음",
    "review-needed": "검토 필요",
    gap: "미해결",
    blocked: "차단",
    "intentionally-out-of-scope": "범위 제외",
    excluded: "범위 제외",
    resolved: "해결",
    unavailable: "미수집",
  };
  return labels[status] ?? status;
}

function reviewVerdict(report: PrReportV2, kind: "functional-review" | "design-review"): string {
  const review = report.reviews.find((candidate) => candidate.kind === kind);
  return review === undefined ? "미실행" : koreanVerdict(review.verdict);
}

function renderPerformanceRows(evidence: Record<string, unknown> | undefined): string[] {
  if (evidence === undefined) return [];
  const lab = asRecord(evidence["lab"]);
  const metrics = asRecord(lab?.["metrics"]);
  const field = asRecord(evidence["field"]);
  const rows: string[] = [];
  const lcpMs = metrics?.["lcpMs"];
  const cls = metrics?.["cls"];
  const tbtMs = metrics?.["tbtMs"];

  if (typeof lcpMs === "number") rows.push(`| LCP | ${lcpMs}ms |`);
  if (typeof cls === "number") rows.push(`| CLS | ${cls} |`);
  if (typeof tbtMs === "number") rows.push(`| TBT | ${tbtMs}ms |`);
  if (typeof field?.["status"] === "string") {
    rows.push(`| 필드 데이터 | ${markdownTableCell(koreanOperationStatus(field["status"]))} |`);
  }
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MARKDOWN_LIST_CONTROL_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  "!",
  "|",
  ">",
  "<",
  "&",
  "~",
  '"',
  "'",
  "=",
]);

function markdownListValue(value: string): string {
  return markdownBullet(value);
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function listOrNone(values: readonly string[]): string[] {
  return values.length === 0 ? ["- None."] : values.map((value) => `- ${markdownBullet(value)}`);
}

function reportSectionStatus(
  report: PrReportV2,
  section: keyof NonNullable<PrReportV2["sectionStatuses"]>,
  applicable: boolean,
): string {
  return report.sectionStatuses?.[section] ?? (applicable ? "complete" : "not-applicable");
}
