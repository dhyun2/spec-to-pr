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
  const apiExcluded = report.api.operations.filter((operation) =>
    /out-of-scope|excluded/i.test(operation.status),
  ).length;
  const apiBlocking = report.api.operations.filter((operation) => operation.blocking).length;
  const apiVerified = report.api.operations.length - apiExcluded - apiBlocking;
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
      `| ${markdownTableCell(koreanVisualName(result.targetId, result.name))} | ${markdownTableCell(`${result.route} · ${koreanVisualState(result.targetId, result.state)}`)} | ${result.viewport.width}×${result.viewport.height} @${result.deviceScaleFactor}x | ${(result.metrics.reviewMatchRatio * 100).toFixed(2)}% | ${(result.metrics.threshold * 100).toFixed(2)}% | ${result.status === "passed" ? "통과" : "실패"} |`,
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
    ...report.gaps.map((gap) => `| 갭 | ${markdownTableCell(gap)} |`),
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
        ? [`| 1 | 레거시 기능 ${legacyMigrated}개를 대상 프로젝트 구조로 이관했습니다. |`]
        : ["| 1 | 요청 범위의 구현을 완료했습니다. |"]),
    ...(showApi
      ? [`| 2 | API ${apiVerified}개를 구현·검증하고 ${apiExcluded}개는 범위에서 제외했습니다. |`]
      : []),
    ...(showVisual
      ? [`| 3 | 동일한 경로·상태·뷰포트에서 화면 ${visualPassed}개를 비교했습니다. |`]
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
          "| 전체 | 사용·검증 | 범위 제외 | 차단 | 갭 |",
          "| ---: | ---: | ---: | ---: | ---: |",
          `| ${report.api.operations.length} | ${Math.max(apiVerified, 0)} | ${apiExcluded} | ${apiBlocking} | ${report.api.gaps.length} |`,
          "",
          "<details>",
          "<summary>API 상세</summary>",
          "",
          ...(report.api.inventoryDigest === undefined
            ? []
            : [`- 인벤토리 digest: ${report.api.inventoryDigest}`]),
          ...(report.api.discoveryAdapters === undefined
            ? []
            : [`- 탐지 adapter: ${report.api.discoveryAdapters.join(", ")}`]),
          ...(report.api.operations.length === 0
            ? ["- 탐지된 API operation이 없습니다."]
            : [
                "",
                "| API | 상태 | 호출 위치 | 실행 증거 |",
                "| --- | --- | --- | --- |",
                ...apiRows,
              ]),
          ...(report.api.gaps.length === 0
            ? []
            : ["", ...report.api.gaps.map((gap) => `- 갭: ${markdownBullet(gap)}`)]),
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
          "| 화면 | 경로 · 상태 | 뷰포트 | 일치율 | 기준 | 결과 |",
          "| --- | --- | --- | ---: | ---: | --- |",
          ...(report.visual.results.length === 0
            ? ["| 없음 | — | — | — | — | 미실행 |"]
            : visualRows),
          "",
          VISUAL_PREVIEW_SLOT,
          "",
        ]
      : []),
    "## 독립 리뷰",
    "",
    "| 리뷰 | 결과 | 게이트 | 발견사항 |",
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
    "<summary>Run, 입력 출처, 변경 파일, 증거 보기</summary>",
    "",
    "| 항목 | 값 |",
    "| --- | --- |",
    `| Run | ${markdownTableCell(report.runId)} |`,
    `| 모드 | ${koreanMode(report.mode)} |`,
    `| 생성 시각 | ${markdownTableCell(report.generatedAt)} |`,
    ...(report.binding === undefined
      ? ["| 리뷰 패킷 | 생성 전 차단 |"]
      : [
          `| 리뷰 패킷 | ${markdownTableCell(report.binding.reviewPacketId)} |`,
          `| Base | ${markdownTableCell(report.binding.baseSha)} |`,
          `| Head | ${markdownTableCell(report.binding.headSha)} |`,
          `| Diff digest | ${markdownTableCell(report.binding.diffDigest)} |`,
        ]),
    "",
    "### 입력 출처",
    "",
    ...(report.sources.length === 0
      ? ["- 없음"]
      : [
          "| 종류 | 위치 | digest |",
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
    "### 증거 인덱스",
    "",
    ...listOrNone(report.evidencePaths),
    "",
    "</details>",
    "",
  ].join("\n");
  return redactSecretShapes(rendered);
}

const VISUAL_PREVIEW_SLOT = "<!-- spec-to-pr:visual-evidence:slot -->";

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

function koreanVisualName(targetId: string, fallback: string): string {
  if (targetId.includes("tournament.current")) return "진행 대회";
  if (targetId.includes("tournament.ended")) return "종료 대회";
  if (targetId.includes("tournament.upcoming")) return "예정 대회";
  if (targetId.includes("notice")) return "공지";
  if (targetId.includes("ranking")) return "회원 랭킹";
  if (targetId.includes("main")) return "매장 메인";
  return /[가-힣]/.test(fallback) ? fallback : targetId;
}

function koreanVisualState(targetId: string, fallback: string): string {
  if (targetId.includes("tournament.current")) return "진행 중";
  if (targetId.includes("tournament.ended")) return "종료";
  if (targetId.includes("tournament.upcoming")) return "예정";
  if (targetId.includes("notice")) return "첫 페이지 · 접힘";
  if (targetId.includes("ranking")) return "첫 페이지";
  if (targetId.includes("main")) return "초기 화면";
  return /[가-힣]/.test(fallback) ? fallback : "검증 상태";
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
    rejected: "거절",
    "changes-requested": "수정 요청",
  };
  return labels[verdict] ?? verdict;
}

function koreanOperationStatus(status: string): string {
  const labels: Record<string, string> = {
    exercised: "사용·검증",
    migrated: "이관",
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
