import type { PrReportViewModel } from "./pr-report-model.js";
import { markdownTable } from "./markdown-table.js";

export function renderPrReportMarkdown(model: PrReportViewModel): string {
  if (model.locale === "ko") {
    return renderKoreanPrReportMarkdown(model);
  }

  return renderEnglishPrReportMarkdown(model);
}

function renderEnglishPrReportMarkdown(model: PrReportViewModel): string {
  return `${[
    renderSummary(model),
    renderRunMetadata(model),
    renderGateSummary(model),
    renderReviewGuide(model),
    renderSpecification(model),
    renderRequirementTraceability(model),
    renderChangeScope(model),
    renderApi(model),
    renderFunctional(model),
    renderDesign(model),
    renderFigmaProviderCapability(model),
    renderFigmaDesignInventory(model),
    renderVisual(model),
    renderScreenshotCompare(model),
    renderNetworkVerification(),
    renderAccessibility(model),
    renderPerformance(model),
    renderObservability(model),
    renderRuntimeVerification(model),
    renderGaps(model),
    renderArchivePlan(model),
    renderDecision(model),
  ]
    .join("\n\n")
    .trimEnd()}\n`;
}

function renderKoreanPrReportMarkdown(model: PrReportViewModel): string {
  return `${[
    renderKoreanSummary(model),
    renderKoreanRunMetadata(model),
    renderKoreanGateSummary(model),
    renderKoreanReviewGuide(model),
    renderKoreanSpecification(model),
    renderKoreanRequirementTraceability(model),
    renderKoreanChangeScope(model),
    renderKoreanApi(model),
    renderKoreanFunctional(model),
    renderKoreanDesign(model),
    renderKoreanFigmaProviderCapability(model),
    renderKoreanFigmaDesignInventory(model),
    renderKoreanVisual(model),
    renderKoreanScreenshotCompare(model),
    renderKoreanNetworkVerification(),
    renderKoreanAccessibility(model),
    renderKoreanPerformance(model),
    renderKoreanObservability(model),
    renderKoreanRuntimeVerification(model),
    renderKoreanGaps(model),
    renderKoreanArchivePlan(model),
    renderKoreanDecision(model),
  ]
    .join("\n\n")
    .trimEnd()}\n`;
}

function renderSummary(model: PrReportViewModel): string {
  return ["# Summary", "", ...model.summaryBullets.map((item) => `- ${item}`)].join("\n");
}

function renderRunMetadata(model: PrReportViewModel): string {
  return [
    "## Run Metadata",
    "",
    markdownTable(
      ["Item", "Value"],
      Object.entries(model.runMetadata).map(([key, value]) => [key, value]),
    ),
  ].join("\n");
}

function renderReviewGuide(model: PrReportViewModel): string {
  return ["## Review Guide", "", ...model.reviewGuide.map((item) => `- ${item}`)].join("\n");
}

function renderGateSummary(model: PrReportViewModel): string {
  const rows = model.gateRows ?? [];

  return [
    "## Gate Summary",
    "",
    rows.length === 0
      ? "No gate summary rows were found. A missing gate must not be treated as Pass."
      : markdownTable(
          ["Gate", "Required", "Status", "Evidence", "Notes"],
          rows.map((row) => [
            row.gate,
            row.required ? "Yes" : "No",
            row.status,
            row.evidence.join("<br>") || "-",
            row.notes,
          ]),
        ),
  ].join("\n");
}

function renderSpecification(model: PrReportViewModel): string {
  return [
    "## Specification",
    "",
    model.specificationLinks.length === 0
      ? "No OpenSpec artifacts were found."
      : markdownTable(
          ["Artifact", "URI"],
          model.specificationLinks.map((link) => [link.label, link.uri]),
        ),
  ].join("\n");
}

function renderRequirementTraceability(model: PrReportViewModel): string {
  return [
    "## Requirement Traceability",
    "",
    model.traceabilityRows.length === 0
      ? "No traceability matrix rows were found."
      : markdownTable(
          ["Requirement", "Status", "Brief", "Figma", "API", "Scenarios", "Gaps"],
          model.traceabilityRows.map((row) => [
            `${row.requirementId}<br>${row.title}`,
            row.status,
            row.briefEvidence.join("<br>") || "-",
            row.figmaEvidence.join("<br>") || "-",
            row.openApiEvidence.join("<br>") || "-",
            row.scenarios.join("<br>") || "-",
            row.gaps.join("<br>") || "-",
          ]),
        ),
  ].join("\n");
}

function renderChangeScope(model: PrReportViewModel): string {
  return [
    "## Change Scope",
    "",
    model.changeScopeRows.length === 0
      ? "No change scope rows were found."
      : markdownTable(
          ["Area", "Artifact Count", "Review Focus"],
          model.changeScopeRows.map((row) => [
            row["Area"] ?? "-",
            row["Artifact Count"] ?? "-",
            row["Review Focus"] ?? "-",
          ]),
        ),
  ].join("\n");
}

function renderApi(model: PrReportViewModel): string {
  return [
    "## API Generator / API Contract",
    "",
    model.apiRows.length === 0
      ? "No API artifacts were found."
      : markdownTable(
          ["Artifact", "Kind", "URI", "Digest"],
          model.apiRows.map((row) => [
            row["Artifact"] ?? "-",
            row["Kind"] ?? "-",
            row["URI"] ?? "-",
            row["Digest"] ?? "-",
          ]),
        ),
  ].join("\n");
}

function renderFunctional(model: PrReportViewModel): string {
  return renderCheckSection("## Functional Verification", model.functionalChecks);
}

function renderDesign(model: PrReportViewModel): string {
  return renderCheckSection("## Design Contract", model.designChecks);
}

function renderFigmaProviderCapability(model: PrReportViewModel): string {
  const rows = model.figmaProviderRows ?? [];

  return [
    "## Figma Provider Capability",
    "",
    rows.length === 0
      ? "No Figma provider capability rows were found."
      : markdownTable(
          ["Item", "Status", "Artifacts", "Notes"],
          rows.map((row) => [row.item, row.status, row.artifacts.join("<br>") || "-", row.notes]),
        ),
  ].join("\n");
}

function renderFigmaDesignInventory(model: PrReportViewModel): string {
  const rows = model.figmaInventoryRows ?? [];

  return [
    "## Figma Design-System Inventory",
    "",
    rows.length === 0
      ? "No Figma design-system inventory rows were found."
      : markdownTable(
          ["Item", "Status", "Artifacts", "Notes"],
          rows.map((row) => [row.item, row.status, row.artifacts.join("<br>") || "-", row.notes]),
        ),
  ].join("\n");
}

function renderVisual(model: PrReportViewModel): string {
  return [
    "## Visual Regression",
    "",
    model.visualRows.length === 0
      ? "No visual comparison rows were found."
      : markdownTable(
          ["State", "Figma", "Browser", "Diff", "Exact", "Review Match", "Result", "Notes"],
          model.visualRows.map((row) => [
            row.state,
            row.figmaArtifactId ?? "-",
            row.browserArtifactId ?? "-",
            row.diffArtifactId ?? "-",
            row.exactMatch === undefined ? "-" : `${row.exactMatch.toFixed(2)}%`,
            row.reviewMatch === undefined ? "-" : `${row.reviewMatch.toFixed(2)}%`,
            row.result,
            row.notes ?? "-",
          ]),
        ),
    "",
    "Visual match rates must be interpreted with the comparison algorithm, threshold, masks, viewport, browser, and font environment recorded in the visual report artifact.",
  ].join("\n");
}

function renderScreenshotCompare(model: PrReportViewModel): string {
  return [
    "## Screenshot Compare",
    "",
    model.visualRows.length === 0
      ? "No Figma/browser screenshot comparison rows were found. Missing screenshot comparison evidence must keep the report out of Ready status."
      : markdownTable(
          ["Target", "Figma Baseline", "Browser Screenshot", "Diff", "Result"],
          model.visualRows.map((row) => [
            row.state,
            row.figmaArtifactId ?? "-",
            row.browserArtifactId ?? "-",
            row.diffArtifactId ?? "-",
            row.result,
          ]),
        ),
  ].join("\n");
}

function renderNetworkVerification(): string {
  return [
    "## Network Verification",
    "",
    "Network verification must be backed by explicit CheckResult or API contract artifacts. Fixture-backed smoke tests are not live API verification.",
  ].join("\n");
}

function renderAccessibility(model: PrReportViewModel): string {
  return [
    renderCheckSection("## Accessibility", model.accessibilityChecks),
    "",
    "Automated accessibility checks do not prove manual screen-reader review unless a manual review artifact exists.",
  ].join("\n");
}

function renderPerformance(model: PrReportViewModel): string {
  return [
    "## Performance / Web Vitals",
    "",
    model.performanceRows.length === 0
      ? "No performance rows were found."
      : markdownTable(
          ["Metric", "Value", "Budget", "Result", "Source"],
          model.performanceRows.map((row) => [
            row.metric,
            row.value,
            row.budget ?? "-",
            row.result,
            row.source,
          ]),
        ),
    "",
    "Lighthouse and CI measurements are lab data. Field Web Vitals require real-user monitoring or field data artifacts.",
  ].join("\n");
}

function renderObservability(model: PrReportViewModel): string {
  return [
    renderCheckSection("## OpenTelemetry / Observability", model.observabilityChecks),
    "",
    "OpenTelemetry templates and log correlation artifacts do not prove collector deployment or production telemetry collection.",
  ].join("\n");
}

function renderRuntimeVerification(model: PrReportViewModel): string {
  return renderCheckSection("## Runtime / Verification", model.runtimeChecks);
}

function renderGaps(model: PrReportViewModel): string {
  return [
    "## Gaps And Review Notes",
    "",
    model.gapSummaries.length === 0
      ? "No open or assumed gaps were found."
      : markdownTable(
          ["Gap", "Category", "Severity", "Status", "Title", "Impact"],
          model.gapSummaries.map((gap) => [
            gap.id,
            gap.category,
            gap.severity,
            gap.status,
            gap.title,
            gap.impact,
          ]),
        ),
  ].join("\n");
}

function renderArchivePlan(model: PrReportViewModel): string {
  return ["## OpenSpec Archive Plan", "", ...model.archivePlan.map((item) => `- ${item}`)].join(
    "\n",
  );
}

function renderDecision(model: PrReportViewModel): string {
  return [
    "## Decision",
    "",
    markdownTable(
      ["Item", "Result"],
      [
        ["Merge readiness", model.decision],
        ["Report generated at", model.generatedAt],
        ["Run ID", model.runId],
      ],
    ),
  ].join("\n");
}

function renderCheckSection(title: string, checks: PrReportViewModel["functionalChecks"]): string {
  return [
    title,
    "",
    checks.length === 0
      ? "No check results were found for this section."
      : markdownTable(
          ["Check", "Kind", "Result", "Command", "Exit Code", "Summary"],
          checks.map((check) => [
            check.name,
            check.kind,
            check.status,
            check.command ?? "-",
            check.exitCode === undefined ? "-" : String(check.exitCode),
            check.summary,
          ]),
        ),
  ].join("\n");
}

function renderKoreanSummary(model: PrReportViewModel): string {
  return ["# 요약", "", ...model.summaryBullets.map((item) => `- ${item}`)].join("\n");
}

function renderKoreanRunMetadata(model: PrReportViewModel): string {
  return [
    "## 실행 메타데이터",
    "",
    markdownTable(
      ["항목", "값"],
      Object.entries(model.runMetadata).map(([key, value]) => [koreanMetadataKey(key), value]),
    ),
  ].join("\n");
}

function renderKoreanReviewGuide(model: PrReportViewModel): string {
  return ["## 리뷰 가이드", "", ...model.reviewGuide.map((item) => `- ${item}`)].join("\n");
}

function renderKoreanGateSummary(model: PrReportViewModel): string {
  const rows = model.gateRows ?? [];

  return [
    "## 게이트 요약",
    "",
    rows.length === 0
      ? "게이트 요약 행이 없습니다. 누락된 게이트는 통과로 취급하면 안 됩니다."
      : markdownTable(
          ["게이트", "필수", "상태", "증거", "메모"],
          rows.map((row) => [
            koreanGateName(row.gate),
            row.required ? "예" : "아니오",
            koreanStatus(row.status),
            row.evidence.join("<br>") || "-",
            koreanNote(row.notes),
          ]),
        ),
  ].join("\n");
}

function renderKoreanSpecification(model: PrReportViewModel): string {
  return [
    "## 명세",
    "",
    model.specificationLinks.length === 0
      ? "OpenSpec artifact가 없습니다."
      : markdownTable(
          ["Artifact", "URI"],
          model.specificationLinks.map((link) => [link.label, link.uri]),
        ),
  ].join("\n");
}

function renderKoreanRequirementTraceability(model: PrReportViewModel): string {
  return [
    "## 요구사항 추적성",
    "",
    model.traceabilityRows.length === 0
      ? "추적성 매트릭스 행이 없습니다."
      : markdownTable(
          ["요구사항", "상태", "기획", "Figma", "API", "시나리오", "갭"],
          model.traceabilityRows.map((row) => [
            `${row.requirementId}<br>${row.title}`,
            row.status,
            row.briefEvidence.join("<br>") || "-",
            row.figmaEvidence.join("<br>") || "-",
            row.openApiEvidence.join("<br>") || "-",
            row.scenarios.join("<br>") || "-",
            row.gaps.join("<br>") || "-",
          ]),
        ),
  ].join("\n");
}

function renderKoreanChangeScope(model: PrReportViewModel): string {
  return [
    "## 변경 범위",
    "",
    model.changeScopeRows.length === 0
      ? "변경 범위 행이 없습니다."
      : markdownTable(
          ["영역", "Artifact 수", "리뷰 초점"],
          model.changeScopeRows.map((row) => [
            row["Area"] ?? "-",
            row["Artifact Count"] ?? "-",
            koreanReviewFocus(row["Review Focus"] ?? "-"),
          ]),
        ),
  ].join("\n");
}

function renderKoreanApi(model: PrReportViewModel): string {
  return [
    "## API Generator / API Contract",
    "",
    model.apiRows.length === 0
      ? "API artifact가 없습니다."
      : markdownTable(
          ["Artifact", "종류", "URI", "Digest"],
          model.apiRows.map((row) => [
            row["Artifact"] ?? "-",
            row["Kind"] ?? "-",
            row["URI"] ?? "-",
            row["Digest"] ?? "-",
          ]),
        ),
  ].join("\n");
}

function renderKoreanFunctional(model: PrReportViewModel): string {
  return renderKoreanCheckSection("## 기능 검증", model.functionalChecks);
}

function renderKoreanDesign(model: PrReportViewModel): string {
  return renderKoreanCheckSection("## 디자인 계약", model.designChecks);
}

function renderKoreanFigmaProviderCapability(model: PrReportViewModel): string {
  const rows = model.figmaProviderRows ?? [];

  return [
    "## Figma 제공자 기능",
    "",
    rows.length === 0
      ? "Figma 제공자 기능 행이 없습니다."
      : markdownTable(
          ["항목", "상태", "Artifacts", "메모"],
          rows.map((row) => [
            koreanArtifactItem(row.item),
            koreanStatus(row.status),
            row.artifacts.join("<br>") || "-",
            koreanNote(row.notes),
          ]),
        ),
  ].join("\n");
}

function renderKoreanFigmaDesignInventory(model: PrReportViewModel): string {
  const rows = model.figmaInventoryRows ?? [];

  return [
    "## Figma 디자인 시스템 인벤토리",
    "",
    rows.length === 0
      ? "Figma 디자인 시스템 인벤토리 행이 없습니다."
      : markdownTable(
          ["항목", "상태", "Artifacts", "메모"],
          rows.map((row) => [
            koreanArtifactItem(row.item),
            koreanStatus(row.status),
            row.artifacts.join("<br>") || "-",
            koreanNote(row.notes),
          ]),
        ),
  ].join("\n");
}

function renderKoreanVisual(model: PrReportViewModel): string {
  return [
    "## 시각 회귀",
    "",
    model.visualRows.length === 0
      ? "시각 비교 행이 없습니다."
      : markdownTable(
          ["상태", "Figma", "브라우저", "Diff", "Exact", "Review Match", "결과", "메모"],
          model.visualRows.map((row) => [
            row.state,
            row.figmaArtifactId ?? "-",
            row.browserArtifactId ?? "-",
            row.diffArtifactId ?? "-",
            row.exactMatch === undefined ? "-" : `${row.exactMatch.toFixed(2)}%`,
            row.reviewMatch === undefined ? "-" : `${row.reviewMatch.toFixed(2)}%`,
            koreanStatus(row.result),
            row.notes ?? "-",
          ]),
        ),
    "",
    "시각 매치율은 visual report artifact에 기록된 알고리즘, 임계값, mask, viewport, 브라우저, 폰트 환경과 함께 해석해야 합니다.",
  ].join("\n");
}

function renderKoreanScreenshotCompare(model: PrReportViewModel): string {
  return [
    "## 스크린샷 비교",
    "",
    model.visualRows.length === 0
      ? "Figma/브라우저 스크린샷 비교 행이 없습니다. 스크린샷 비교 증거가 없으면 Ready 상태로 볼 수 없습니다."
      : markdownTable(
          ["대상", "Figma Baseline", "Browser Screenshot", "Diff", "결과"],
          model.visualRows.map((row) => [
            row.state,
            row.figmaArtifactId ?? "-",
            row.browserArtifactId ?? "-",
            row.diffArtifactId ?? "-",
            koreanStatus(row.result),
          ]),
        ),
  ].join("\n");
}

function renderKoreanNetworkVerification(): string {
  return [
    "## 네트워크 검증",
    "",
    "네트워크 검증은 명시적인 CheckResult 또는 API contract artifact로 뒷받침되어야 합니다. fixture 기반 smoke test는 live API 검증이 아닙니다.",
  ].join("\n");
}

function renderKoreanAccessibility(model: PrReportViewModel): string {
  return [
    renderKoreanCheckSection("## 접근성", model.accessibilityChecks),
    "",
    "자동 접근성 검사는 수동 스크린리더 리뷰 artifact가 없는 한 수동 검증을 증명하지 않습니다.",
  ].join("\n");
}

function renderKoreanPerformance(model: PrReportViewModel): string {
  return [
    "## 성능 / Web Vitals",
    "",
    model.performanceRows.length === 0
      ? "성능 행이 없습니다."
      : markdownTable(
          ["지표", "값", "예산", "결과", "출처"],
          model.performanceRows.map((row) => [
            row.metric,
            row.value,
            row.budget ?? "-",
            koreanStatus(row.result),
            row.source,
          ]),
        ),
    "",
    "Lighthouse와 CI 측정은 lab data입니다. Field Web Vitals는 RUM 또는 field data artifact가 있어야 합니다.",
  ].join("\n");
}

function renderKoreanObservability(model: PrReportViewModel): string {
  return [
    renderKoreanCheckSection("## OpenTelemetry / 관측성", model.observabilityChecks),
    "",
    "OpenTelemetry 템플릿과 로그 상관관계 artifact만으로 collector 배포나 운영 telemetry 수집이 증명되지는 않습니다.",
  ].join("\n");
}

function renderKoreanRuntimeVerification(model: PrReportViewModel): string {
  return renderKoreanCheckSection("## 런타임 / 검증", model.runtimeChecks);
}

function renderKoreanGaps(model: PrReportViewModel): string {
  return [
    "## 갭 및 리뷰 메모",
    "",
    model.gapSummaries.length === 0
      ? "open 또는 assumed 상태의 gap이 없습니다."
      : markdownTable(
          ["Gap", "카테고리", "심각도", "상태", "제목", "영향"],
          model.gapSummaries.map((gap) => [
            gap.id,
            gap.category,
            gap.severity,
            gap.status,
            gap.title,
            gap.impact,
          ]),
        ),
  ].join("\n");
}

function renderKoreanArchivePlan(model: PrReportViewModel): string {
  return ["## OpenSpec Archive 계획", "", ...model.archivePlan.map((item) => `- ${item}`)].join(
    "\n",
  );
}

function renderKoreanDecision(model: PrReportViewModel): string {
  return [
    "## 결정",
    "",
    markdownTable(
      ["항목", "결과"],
      [
        ["머지 준비 상태", model.decision],
        ["리포트 생성 시각", model.generatedAt],
        ["Run ID", model.runId],
      ],
    ),
  ].join("\n");
}

function renderKoreanCheckSection(
  title: string,
  checks: PrReportViewModel["functionalChecks"],
): string {
  return [
    title,
    "",
    checks.length === 0
      ? "이 섹션의 CheckResult가 없습니다."
      : markdownTable(
          ["체크", "종류", "결과", "명령", "Exit Code", "요약"],
          checks.map((check) => [
            check.name,
            check.kind,
            koreanStatus(check.status),
            check.command ?? "-",
            check.exitCode === undefined ? "-" : String(check.exitCode),
            check.summary,
          ]),
        ),
  ].join("\n");
}

function koreanStatus(status: string): string {
  switch (status) {
    case "pass":
      return "통과";
    case "fail":
      return "실패";
    case "warning":
      return "검토 필요";
    case "not-run":
      return "미실행";
    case "skipped":
      return "건너뜀";
    case "not-applicable":
      return "해당 없음";
    default:
      return status;
  }
}

function koreanGateName(gate: string): string {
  switch (gate) {
    case "Runtime verification":
      return "런타임 검증";
    case "Functional verification":
      return "기능 검증";
    case "OpenSpec / specification":
      return "OpenSpec / 명세";
    case "Figma provider capability":
      return "Figma 제공자 기능";
    case "Figma design inventory":
      return "Figma 디자인 인벤토리";
    case "Visual regression":
      return "시각 회귀";
    case "Accessibility":
      return "접근성";
    case "Performance / Web Vitals":
      return "성능 / Web Vitals";
    case "Security hardening":
      return "보안 하드닝";
    case "Observability":
      return "관측성";
    default:
      return gate;
  }
}

function koreanArtifactItem(item: string): string {
  switch (item) {
    case "Provider capability":
      return "제공자 기능";
    case "Provider policy":
      return "제공자 정책";
    case "Raw metadata":
      return "원본 메타데이터";
    case "Screenshot baseline":
      return "스크린샷 baseline";
    case "Variables / styles":
      return "Variables / styles";
    case "Code Connect map":
      return "Code Connect map";
    case "Design-system inventory":
      return "디자인 시스템 인벤토리";
    case "Design contract":
      return "디자인 계약";
    default:
      return item;
  }
}

function koreanMetadataKey(key: string): string {
  switch (key) {
    case "Plugin Version":
      return "플러그인 버전";
    case "Schema Version":
      return "스키마 버전";
    case "Project Root":
      return "프로젝트 루트";
    case "Status":
      return "상태";
    case "Revision":
      return "리비전";
    case "Created At":
      return "생성 시각";
    case "Updated At":
      return "수정 시각";
    default:
      return key;
  }
}

function koreanReviewFocus(value: string): string {
  switch (value) {
    case "Requirement and scope correctness":
      return "요구사항과 범위 정합성";
    case "API operation coverage and gaps":
      return "API operation 커버리지와 gap";
    case "Design evidence and parity":
      return "디자인 증거와 구현 일치도";
    case "Functional verification":
      return "기능 검증";
    case "Figma/browser comparison":
      return "Figma/브라우저 비교";
    case "Automated and manual accessibility evidence":
      return "자동/수동 접근성 증거";
    case "Lab performance and Web Vitals readiness":
      return "Lab 성능과 Web Vitals 준비도";
    case "Trace/log correlation and telemetry readiness":
      return "Trace/log 상관관계와 telemetry 준비도";
    case "Evidence review":
      return "증거 리뷰";
    default:
      return value;
  }
}

function koreanNote(note: string): string {
  switch (note) {
    case "No performance report artifact was recorded.":
      return "성능 리포트 artifact가 기록되지 않았습니다.";
    case "No unit/component/contract/acceptance/e2e CheckResult was recorded.":
      return "unit/component/contract/acceptance/e2e CheckResult가 기록되지 않았습니다.";
    case "No openspec CheckResult was recorded.":
      return "OpenSpec CheckResult가 기록되지 않았습니다.";
    case "No accessibility CheckResult was recorded.":
      return "접근성 CheckResult가 기록되지 않았습니다.";
    case "No security CheckResult was recorded.":
      return "보안 CheckResult가 기록되지 않았습니다.";
    case "No observability report artifact was recorded.":
      return "관측성 리포트 artifact가 기록되지 않았습니다.";
    case "Figma evidence exists, but no Figma/browser visual comparison artifact was recorded.":
      return "Figma 증거는 있지만 Figma/브라우저 시각 비교 artifact가 기록되지 않았습니다.";
    case "Figma evidence exists, but design-system inventory was not recorded.":
      return "Figma 증거는 있지만 디자인 시스템 인벤토리가 기록되지 않았습니다.";
    case "Figma provider capability artifact is recorded.":
      return "Figma 제공자 기능 artifact가 기록되었습니다.";
    case "Figma design-system inventory artifact is recorded.":
      return "Figma 디자인 시스템 인벤토리 artifact가 기록되었습니다.";
    case "Figma/browser visual comparison artifact is recorded.":
      return "Figma/브라우저 시각 비교 artifact가 기록되었습니다.";
    case "Performance report artifact is recorded.":
    case "Performance evidence was recorded.":
      return "성능 증거가 기록되었습니다.";
    case "Observability report artifact is recorded.":
      return "관측성 리포트 artifact가 기록되었습니다.";
    case "Recorded checks passed.":
      return "기록된 체크가 통과했습니다.";
    case "Recorded.":
      return "기록됨.";
    case "No provider selection policy artifact was recorded.":
      return "제공자 선택 정책 artifact가 기록되지 않았습니다.";
    case "No Figma screenshot baseline artifact was recorded.":
      return "Figma 스크린샷 baseline artifact가 기록되지 않았습니다.";
    case "No Figma variable/style artifact was recorded.":
      return "Figma variable/style artifact가 기록되지 않았습니다.";
    case "No Figma Code Connect map artifact was recorded.":
      return "Figma Code Connect map artifact가 기록되지 않았습니다.";
    case "No Figma design-system inventory artifact was recorded.":
      return "Figma 디자인 시스템 인벤토리 artifact가 기록되지 않았습니다.";
    case "No Figma design contract artifact was recorded.":
      return "Figma 디자인 계약 artifact가 기록되지 않았습니다.";
    case "No raw Figma metadata or design context artifact was recorded.":
      return "원본 Figma metadata 또는 design context artifact가 기록되지 않았습니다.";
    case "No matching source evidence was recorded for this gate.":
      return "이 게이트에 해당하는 source evidence가 기록되지 않았습니다.";
    case "At least one required check failed.":
      return "필수 체크 중 하나 이상이 실패했습니다.";
    case "At least one required check was skipped.":
      return "필수 체크 중 하나 이상이 건너뛰어졌습니다.";
    case "At least one check or artifact gate failed.":
      return "체크 또는 artifact 게이트 중 하나 이상이 실패했습니다.";
    default:
      return note;
  }
}
