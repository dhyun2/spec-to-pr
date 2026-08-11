import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  compareImages,
  type ImageComparisonRegion,
  type ImageComparisonResult,
} from "./compare-images.js";
import type { LegacySourceInventory } from "./legacy-source-inventory.js";

const execFileAsync = promisify(execFile);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/iu;
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|s[ac]ss|less)$/iu;
const SECRET_SHAPED_CAPTURE_TEXT =
  /(?:bearer\s+[a-z0-9._~+\-/=]+|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|(?:cookie|token|authorization)\s*[:=]\s*\S+)/iu;

export type LegacyVisualManifest = {
  /**
   * v2 manifests remain readable so an interrupted Draft does not lose its evidence.
   * v3 introduced capture-provider disclosure and remains readable.
   * v4 adds lightweight route/runtime proof and target Vue 3 code conformance.
   */
  schemaVersion: 2 | 3 | 4;
  case: "legacy";
  change: string;
  legacyProjectRoot: string;
  sourceInventoryPath: string;
  targetPaths: string[];
  capturePolicy?: LegacyCapturePolicy;
  migration: {
    strategy: "preserve-legacy" | "redesign-approved";
    redesignApproval?: string;
    preservation: {
      template: "preserved" | "not-applicable" | "gap";
      styles: "preserved" | "not-applicable" | "gap";
      assets: "preserved" | "not-applicable" | "gap";
      controls: "preserved" | "not-applicable" | "gap";
    };
    forbiddenImports?: string[];
  };
  routeInventory: LegacyRouteInventoryItem[];
  visualTargets: LegacyVisualTarget[];
  exclusions?: LegacyVisualExclusion[];
  assetMappings: LegacyAssetMapping[];
  selectorMappings: LegacySelectorMapping[];
  breakpointMappings: LegacyBreakpointMapping[];
  runtimeMappings: LegacyRuntimeMapping[];
  routeChecks?: LegacyRouteCheck[];
  targetCodeProfile?: LegacyTargetCodeProfile;
  publishing?: LegacyPublishingStatus;
};

export type LegacyFixtureParameter = {
  name: string;
  value: string;
  provenance: "legacy-runtime" | "legacy-api" | "user-provided";
  evidence: string;
};

export type LegacyRuntimeAssertion = {
  label: string;
  kind: "selector" | "text";
  expected: string;
  status: "passed" | "failed";
};

export type LegacyApiCheck = {
  request: string;
  purpose: "auth" | "data";
  status?: number;
  result: "passed" | "failed" | "not-observed";
  required?: boolean;
};

export type LegacyAuthProof = {
  status: "passed" | "failed" | "not-required";
  kind: "api-2xx" | "ui-assertion" | "not-required";
  evidence: string;
};

export type LegacyRuntimeObservation = {
  finalUrl: string;
  screenState: "content" | "empty-state" | "blank" | "error" | "loading";
  assertions: LegacyRuntimeAssertion[];
  auth: LegacyAuthProof;
  apiChecks: LegacyApiCheck[];
  diagnosticsChecked?: boolean;
  relevantConsoleErrors: string[];
  relevantNetworkErrors: string[];
};

export type LegacyRouteCheck = {
  id: string;
  inventoryId: string;
  entry:
    | { type: "direct"; action: string }
    | { type: "interaction"; fromInventoryId: string; action: string };
  expectedUrlPattern: string;
  expectedScreen: "content" | "empty-state" | "error";
  apiExpectation?: { requirement: "required" } | { requirement: "not-required"; reason: string };
  fixture: {
    summary: string;
    parameters?: LegacyFixtureParameter[];
  };
  baseline: LegacyRuntimeObservation;
  target: LegacyRuntimeObservation;
};

export type LegacyTargetCodeProfile = {
  framework: "vue3";
  evidenceSources: string[];
  componentStyle: "script-setup" | "composition-api" | "options-api-allowed";
  language: "typescript" | "mixed";
  stateManagement: "pinia" | "not-applicable" | "repository-standard";
  router: "vue-router-4" | "not-applicable" | "repository-standard";
  legacyCompatibility: "forbidden" | "allowed";
};

export type LegacyAssetMapping = {
  sourceAssetId: string;
  target: string;
  status: "preserved" | "approved-replacement" | "gap";
  approval?: string;
};

export type LegacySelectorMapping = {
  sourceSelectorId: string;
  targetSelector: string;
  status: "preserved" | "approved-replacement" | "gap";
  approval?: string;
};

export type LegacyBreakpointMapping = {
  sourceBreakpointId: string;
  targetQuery: string;
  status: "preserved" | "approved-replacement" | "gap";
  approval?: string;
};

export type LegacyRuntimeMapping = {
  sourceRuntimeId: string;
  targetFiles: string[];
  targetEvidence: string;
  status: "preserved" | "approved-replacement" | "gap";
  approval?: string;
};

export type LegacyPublishingStatus = {
  plugin: {
    status: "not-attempted" | "passed" | "failed";
    summary?: string;
  };
  draft: {
    status: "not-attempted" | "published" | "failed";
    method?: "plugin-api" | "glab" | "gh";
    url?: string;
    summary?: string;
  };
};

export type LegacyRouteInventoryItem = {
  id: string;
  route: string;
  state: string;
  sourceFiles: string[];
  targetFiles: string[];
  userVisible?: boolean;
};

export type LegacyCaptureProvider = "computer-use" | "browser" | "playwright";
export type LegacyCaptureAuthState =
  "authenticated" | "unauthenticated" | "not-required" | "unknown";

/**
 * Computer Use is the legacy capture default. Browser and Playwright are allowed
 * only as an explicitly disclosed fallback when that host capability is absent or
 * cannot produce the required capture.
 */
export type LegacyCapturePolicy = {
  preferredProvider: "computer-use";
  fallback:
    | "browser-or-playwright-when-unavailable"
    /** @deprecated Kept readable for manifests created by SpecToPR 1.0.3. */
    | "browser-or-playwright-with-gap";
};

export type LegacyCaptureEvidence = {
  provider: LegacyCaptureProvider;
  authState: LegacyCaptureAuthState;
  capturedAt: string;
  fallbackReason?: string;
};

export type LegacyVisualAttempt = {
  actualPath: string;
  diffPath: string;
  capture?: LegacyCaptureEvidence;
};

export type LegacyVisualTarget = {
  id: string;
  inventoryId: string;
  fixture: string;
  viewport: { width: number; height: number; dpr: number };
  baselinePath: string;
  baselineCapture?: LegacyCaptureEvidence;
  attempts: LegacyVisualAttempt[];
  criticalRegions: ImageComparisonRegion[];
};

export type LegacyVisualExclusion = {
  inventoryId: string;
  reason: string;
  impact: string;
  reviewerDecision: string;
};

export type LegacyEvidenceOptions = {
  projectRoot: string;
  repositoryWebUrl?: string;
  sourceRef?: string;
  requireStaged?: boolean;
};

export type LegacyEvidenceTargetResult = {
  target: LegacyVisualTarget;
  inventory: LegacyRouteInventoryItem;
  status: "passed" | "failed" | "capture-missing";
  result?: ImageComparisonResult;
  gap?: string;
  artifacts: { baseline: string; actual?: string; diff?: string };
};

export type LegacyEvidenceReport = {
  status: "verified" | "not-verified";
  coverage: {
    required: number;
    compared: number;
    excluded: number;
    passed: number;
    failed: number;
  };
  designPreservation: { status: "passed" | "gap"; messages: string[] };
  sourcePreservation: SourcePreservationReport;
  captureEvidence: CaptureEvidenceReport;
  routeValidation: RouteValidationReport;
  codeConformance: CodeConformanceReport;
  publishing?: LegacyPublishingStatus;
  targets: LegacyEvidenceTargetResult[];
  exclusions: LegacyVisualExclusion[];
  gaps: Array<{ item: string; impact: string; nextAction: string }>;
  markdown: string;
};

export type RouteCheckResult = {
  check: LegacyRouteCheck;
  inventory: LegacyRouteInventoryItem;
  status: "passed" | "failed";
  messages: string[];
};

export type RouteValidationReport = {
  status: "passed" | "gap";
  checks: RouteCheckResult[];
  messages: string[];
  failedInventoryIds: string[];
};

export type CodeConformanceReport = {
  status: "passed" | "gap";
  profile?: LegacyTargetCodeProfile;
  metrics: {
    vueScripts: number;
    scriptSetup: number;
    typescriptScripts: number;
  };
  messages: string[];
};

export type SourcePreservationReport = {
  status: "passed" | "gap";
  coverage: {
    assets: { mapped: number; total: number };
    selectors: { mapped: number; total: number };
    breakpoints: { mapped: number; total: number };
    runtime: { mapped: number; total: number };
  };
  messages: string[];
};

export type CaptureEvidenceReport = {
  status: "passed" | "gap";
  messages: string[];
  disclosures: string[];
};

/**
 * Validates a legacy migration evidence manifest and produces review-ready Markdown.
 * Structural mistakes throw. Missing captures, failed comparisons, and forbidden imports
 * stay visible as gaps so a Draft PR can still be prepared without false verification.
 */
export async function buildLegacyEvidenceReport(
  manifest: LegacyVisualManifest,
  options: LegacyEvidenceOptions,
): Promise<LegacyEvidenceReport> {
  validateManifest(manifest, options.projectRoot);
  const manifestDirectory = resolveWithin(
    options.projectRoot,
    "spec-to-pr-evidence",
    manifest.change,
  );
  const gaps: LegacyEvidenceReport["gaps"] = [];
  const targetByInventory = new Map(
    manifest.visualTargets.map((target) => [target.inventoryId, target]),
  );
  const exclusions = manifest.exclusions ?? [];
  const exclusionByInventory = new Map(
    exclusions.map((exclusion) => [exclusion.inventoryId, exclusion]),
  );
  const requiredInventory = manifest.routeInventory.filter((item) => item.userVisible !== false);
  const designPreservation = await inspectDesignPreservation(manifest, options.projectRoot);
  const sourcePreservation = await inspectSourcePreservation(
    manifest,
    options.projectRoot,
    manifestDirectory,
  );
  const captureEvidence = inspectCaptureEvidence(manifest);
  const routeValidation = inspectRouteChecks(manifest);
  const codeConformance = await inspectCodeConformance(manifest, options.projectRoot);
  for (const message of designPreservation.messages) {
    gaps.push({
      item: "레거시 UI 보존 확인",
      impact: "높음",
      nextAction: message,
    });
  }
  for (const message of sourcePreservation.messages) {
    gaps.push({
      item: "레거시 자산·CSS·런타임 보존 확인",
      impact: "높음",
      nextAction: message,
    });
  }
  for (const message of captureEvidence.messages) {
    gaps.push({
      item: "화면 캡처 방식",
      impact: "중간",
      nextAction: message,
    });
  }
  for (const message of routeValidation.messages) {
    gaps.push({
      item: "라우트 동작 확인",
      impact: "높음",
      nextAction: message,
    });
  }
  for (const message of codeConformance.messages) {
    gaps.push({
      item: "Vue 3 대상 규격",
      impact: "높음",
      nextAction: message,
    });
  }

  const results: LegacyEvidenceTargetResult[] = [];
  for (const inventory of requiredInventory) {
    const target = targetByInventory.get(inventory.id);
    if (target === undefined) {
      const exclusion = exclusionByInventory.get(inventory.id);
      if (exclusion !== undefined) continue;
      gaps.push({
        item: `${inventory.route} · ${inventory.state} 화면 비교가 없음`,
        impact: "높음",
        nextAction: "레거시와 이관 결과를 같은 조건으로 캡처해 visualTargets에 추가합니다.",
      });
      continue;
    }

    const baselinePath = resolveEvidencePath(
      options.projectRoot,
      manifestDirectory,
      target.baselinePath,
    );
    const finalAttempt = target.attempts.at(-1)!;
    const actualPath = resolveEvidencePath(
      options.projectRoot,
      manifestDirectory,
      finalAttempt.actualPath,
    );
    const diffPath = resolveEvidencePath(
      options.projectRoot,
      manifestDirectory,
      finalAttempt.diffPath,
    );
    const artifacts = {
      baseline: relativeProjectPath(options.projectRoot, baselinePath),
      actual: relativeProjectPath(options.projectRoot, actualPath),
      diff: relativeProjectPath(options.projectRoot, diffPath),
    };

    if (!existsSync(baselinePath) || !existsSync(actualPath)) {
      const missing = [
        !existsSync(baselinePath) ? "기준 이미지" : "",
        !existsSync(actualPath) ? "이관 결과 이미지" : "",
      ]
        .filter(Boolean)
        .join(", ");
      const gap = `${missing}가 없어 비교를 실행하지 못했습니다.`;
      results.push({ target, inventory, status: "capture-missing", gap, artifacts });
      gaps.push({
        item: `${inventory.route} · ${inventory.state} ${gap}`,
        impact: "높음",
        nextAction: "같은 fixture·viewport·DPR로 두 이미지를 저장한 뒤 다시 검증합니다.",
      });
      continue;
    }

    await mkdir(path.dirname(diffPath), { recursive: true });
    try {
      const result = await compareImages({
        baselinePath,
        actualPath,
        diffPath,
        regions: target.criticalRegions,
      });
      const routeCheckFailed = routeValidation.failedInventoryIds.includes(inventory.id);
      const criticalRegionIssue = criticalRegionGap(target);
      const status =
        result.status === "passed" && !routeCheckFailed && criticalRegionIssue === undefined
          ? "passed"
          : "failed";
      if (criticalRegionIssue !== undefined) {
        gaps.push({
          item: `${inventory.route} · ${inventory.state} 핵심 UI 영역이 유효하지 않음`,
          impact: "높음",
          nextAction: criticalRegionIssue,
        });
      }
      if (result.status === "failed") {
        gaps.push({
          item: `${inventory.route} · ${inventory.state} 화면 일치율 미달 (${result.matchPercent})`,
          impact: "높음",
          nextAction:
            "Diff와 핵심 컨트롤 영역을 기준으로 레거시 템플릿·CSS·자산·동작을 보존하도록 보완합니다.",
        });
      }
      results.push({ target, inventory, status, result, artifacts });
    } catch (error) {
      const gap = error instanceof Error ? error.message : String(error);
      results.push({ target, inventory, status: "capture-missing", gap, artifacts });
      gaps.push({
        item: `${inventory.route} · ${inventory.state} 비교 실패: ${gap}`,
        impact: "높음",
        nextAction: "두 캡처의 viewport·DPR·fixture를 맞춘 뒤 다시 캡처합니다.",
      });
    }
  }

  for (const exclusion of exclusions) {
    gaps.push({
      item: `${inventoryLabel(manifest, exclusion.inventoryId)} 비교 제외: ${exclusion.reason}`,
      impact: exclusion.impact,
      nextAction: `리뷰어 결정 필요: ${exclusion.reviewerDecision}`,
    });
  }

  appendPublishingGaps(manifest.publishing, gaps);

  if (options.requireStaged ?? true) {
    const evidencePaths = results.flatMap((result) =>
      [result.artifacts.baseline, result.artifacts.actual, result.artifacts.diff].filter(
        (value): value is string => value !== undefined,
      ),
    );
    const unstaged = await findUnstagedPaths(options.projectRoot, evidencePaths);
    if (unstaged.length > 0) {
      gaps.push({
        item: `화면 증빙 ${unstaged.length}개가 Git index에 없음`,
        impact: "높음",
        nextAction: `PR 생성 전에 증빙을 stage·commit·push합니다: ${unstaged.join(", ")}`,
      });
    }
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const compared = results.filter((result) => result.status !== "capture-missing").length;
  const status =
    gaps.length === 0 && passed === requiredInventory.length ? "verified" : "not-verified";
  const coverage = {
    required: requiredInventory.length,
    compared,
    excluded: exclusions.length,
    passed,
    failed,
  };
  return {
    status,
    coverage,
    designPreservation,
    sourcePreservation,
    captureEvidence,
    routeValidation,
    codeConformance,
    targets: results,
    exclusions,
    ...(manifest.publishing === undefined ? {} : { publishing: manifest.publishing }),
    gaps,
    markdown: renderLegacyMarkdown(
      manifest,
      {
        status,
        coverage,
        designPreservation,
        sourcePreservation,
        captureEvidence,
        routeValidation,
        codeConformance,
        targets: results,
        exclusions,
        ...(manifest.publishing === undefined ? {} : { publishing: manifest.publishing }),
        gaps,
      },
      options,
    ),
  };
}

function validateManifest(manifest: LegacyVisualManifest, projectRoot: string): void {
  if (
    (manifest.schemaVersion !== 2 &&
      manifest.schemaVersion !== 3 &&
      manifest.schemaVersion !== 4) ||
    manifest.case !== "legacy"
  ) {
    throw new Error(
      "LEGACY_EVIDENCE_SCHEMA_INVALID: schemaVersion 2, 3, or 4 and case legacy are required",
    );
  }
  assertSafeId(manifest.change, "change");
  if (!path.isAbsolute(manifest.legacyProjectRoot)) {
    throw new Error("LEGACY_EVIDENCE_SCHEMA_INVALID: legacyProjectRoot must be an absolute path");
  }
  resolveEvidencePath(
    projectRoot,
    resolveWithin(projectRoot, "spec-to-pr-evidence", manifest.change),
    manifest.sourceInventoryPath,
  );
  if (
    manifest.targetPaths.length === 0 ||
    manifest.targetPaths.some((target) => !isSafeRelativePath(target))
  ) {
    throw new Error(
      "LEGACY_EVIDENCE_SCHEMA_INVALID: targetPaths must contain safe project-relative paths",
    );
  }
  if (
    manifest.migration.strategy === "redesign-approved" &&
    (manifest.migration.redesignApproval?.trim().length ?? 0) === 0
  ) {
    throw new Error(
      "LEGACY_EVIDENCE_SCHEMA_INVALID: redesign-approved requires explicit redesignApproval",
    );
  }
  if (
    manifest.migration.strategy !== "preserve-legacy" &&
    manifest.migration.strategy !== "redesign-approved"
  ) {
    throw new Error("LEGACY_EVIDENCE_SCHEMA_INVALID: migration.strategy is invalid");
  }
  for (const [name, status] of Object.entries(manifest.migration.preservation)) {
    if (!["preserved", "not-applicable", "gap"].includes(status)) {
      throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: migration.preservation.${name} is invalid`);
    }
  }

  const inventoryIds = new Set<string>();
  for (const item of manifest.routeInventory) {
    assertSafeId(item.id, "routeInventory id");
    if (inventoryIds.has(item.id))
      throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: duplicate inventory id ${item.id}`);
    inventoryIds.add(item.id);
    if (!item.route.startsWith("/") || item.state.trim().length === 0) {
      throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${item.id} must declare route and state`);
    }
    if (item.sourceFiles.length === 0 || item.targetFiles.length === 0) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${item.id} must declare sourceFiles and targetFiles`,
      );
    }
    if (item.targetFiles.some((file) => !isTargetPath(file, manifest.targetPaths))) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${item.id} targetFiles must stay inside targetPaths`,
      );
    }
  }
  if (manifest.routeInventory.length === 0) {
    throw new Error("LEGACY_EVIDENCE_SCHEMA_INVALID: routeInventory must not be empty");
  }

  const targetInventoryIds = new Set<string>();
  for (const target of manifest.visualTargets) {
    assertSafeId(target.id, "visual target id");
    if (!inventoryIds.has(target.inventoryId) || targetInventoryIds.has(target.inventoryId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: visual target inventoryId is missing or duplicated: ${target.inventoryId}`,
      );
    }
    targetInventoryIds.add(target.inventoryId);
    if (
      target.fixture.trim().length === 0 ||
      !Number.isInteger(target.viewport.width) ||
      !Number.isInteger(target.viewport.height) ||
      target.viewport.width <= 0 ||
      target.viewport.height <= 0 ||
      !Number.isFinite(target.viewport.dpr) ||
      target.viewport.dpr <= 0
    ) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${target.id} must declare fixture and viewport`,
      );
    }
    if (target.attempts.length < 1 || target.attempts.length > 3) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${target.id} attempts must contain 1 to 3 comparisons`,
      );
    }
    for (const artifactPath of [
      target.baselinePath,
      ...target.attempts.flatMap((attempt) => [attempt.actualPath, attempt.diffPath]),
    ]) {
      resolveEvidencePath(
        projectRoot,
        resolveWithin(projectRoot, "spec-to-pr-evidence", manifest.change),
        artifactPath,
      );
    }
    validateCaptureEvidence(target.baselineCapture, `${target.id} baselineCapture`);
    for (const [attemptIndex, attempt] of target.attempts.entries()) {
      validateCaptureEvidence(attempt.capture, `${target.id} attempt ${attemptIndex + 1} capture`);
    }
  }

  const excludedIds = new Set<string>();
  for (const exclusion of manifest.exclusions ?? []) {
    if (!inventoryIds.has(exclusion.inventoryId) || excludedIds.has(exclusion.inventoryId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: exclusion inventoryId is missing or duplicated: ${exclusion.inventoryId}`,
      );
    }
    if (targetInventoryIds.has(exclusion.inventoryId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${exclusion.inventoryId} cannot be both compared and excluded`,
      );
    }
    if (
      exclusion.reason.trim().length === 0 ||
      exclusion.impact.trim().length === 0 ||
      exclusion.reviewerDecision.trim().length === 0
    ) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${exclusion.inventoryId} exclusion needs reason, impact, reviewerDecision`,
      );
    }
    excludedIds.add(exclusion.inventoryId);
  }
  validateRouteCheckSchema(manifest, inventoryIds);
  validateTargetCodeProfileSchema(manifest.targetCodeProfile, projectRoot);
  validateMappings(manifest.assetMappings, "sourceAssetId", "assetMappings");
  validateMappings(manifest.selectorMappings, "sourceSelectorId", "selectorMappings");
  validateMappings(manifest.breakpointMappings, "sourceBreakpointId", "breakpointMappings");
  validateMappings(manifest.runtimeMappings, "sourceRuntimeId", "runtimeMappings");
  if (
    manifest.assetMappings.some(
      (mapping) =>
        mapping.target.trim().length === 0 ||
        (!isCanonicalUrl(mapping.target) && !isTargetPath(mapping.target, manifest.targetPaths)),
    ) ||
    manifest.selectorMappings.some((mapping) => mapping.targetSelector.trim().length === 0) ||
    manifest.breakpointMappings.some((mapping) => mapping.targetQuery.trim().length === 0)
  ) {
    throw new Error(
      "LEGACY_EVIDENCE_SCHEMA_INVALID: preservation mappings need a non-empty target inside targetPaths or a canonical URL",
    );
  }
  for (const mapping of manifest.runtimeMappings) {
    if (
      mapping.targetFiles.length === 0 ||
      mapping.targetFiles.some((file) => !isTargetPath(file, manifest.targetPaths)) ||
      mapping.targetEvidence.trim().length === 0
    ) {
      throw new Error(
        "LEGACY_EVIDENCE_SCHEMA_INVALID: runtime mappings need target files inside targetPaths and targetEvidence",
      );
    }
  }
  validatePublishingStatus(manifest.publishing);
}

function validateCaptureEvidence(capture: LegacyCaptureEvidence | undefined, label: string): void {
  if (capture === undefined) return;
  if (!(["computer-use", "browser", "playwright"] as const).includes(capture.provider)) {
    throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} provider is invalid`);
  }
  if (
    !(["authenticated", "unauthenticated", "not-required", "unknown"] as const).includes(
      capture.authState,
    )
  ) {
    throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} authState is invalid`);
  }
  if (!Number.isFinite(Date.parse(capture.capturedAt))) {
    throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} capturedAt must be an ISO timestamp`);
  }
  if (capture.provider !== "computer-use" && (capture.fallbackReason?.trim().length ?? 0) === 0) {
    throw new Error(
      `LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} browser/playwright fallback needs fallbackReason`,
    );
  }
  if (
    capture.fallbackReason !== undefined &&
    SECRET_SHAPED_CAPTURE_TEXT.test(capture.fallbackReason)
  ) {
    throw new Error(
      `LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} fallbackReason must not contain cookie, token, or authorization values`,
    );
  }
}

function validateMappings<T extends { status: string; approval?: string }>(
  mappings: readonly T[],
  idKey: keyof T,
  label: string,
): void {
  const ids = new Set<string>();
  for (const mapping of mappings) {
    const sourceId = mapping[idKey];
    if (typeof sourceId !== "string" || !SAFE_ID.test(sourceId) || ids.has(sourceId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} source ids must be unique safe identifiers`,
      );
    }
    if (!["preserved", "approved-replacement", "gap"].includes(mapping.status)) {
      throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} status is invalid`);
    }
    if (mapping.status === "approved-replacement" && (mapping.approval?.trim().length ?? 0) === 0) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} approved replacement needs approval`,
      );
    }
    ids.add(sourceId);
  }
}

function validatePublishingStatus(publishing: LegacyPublishingStatus | undefined): void {
  if (publishing === undefined) return;
  for (const stage of [publishing.plugin, publishing.draft]) {
    if (stage.status === "failed" && (stage.summary?.trim().length ?? 0) === 0) {
      throw new Error(
        "LEGACY_EVIDENCE_SCHEMA_INVALID: failed publication status needs a concise summary",
      );
    }
  }
  if (publishing.draft.status === "published" && publishing.draft.url === undefined) {
    throw new Error("LEGACY_EVIDENCE_SCHEMA_INVALID: published Draft needs its URL");
  }
}

function validateRouteCheckSchema(
  manifest: LegacyVisualManifest,
  inventoryIds: ReadonlySet<string>,
): void {
  const checkIds = new Set<string>();
  const checkedInventoryIds = new Set<string>();
  for (const check of manifest.routeChecks ?? []) {
    assertSafeId(check.id, "route check id");
    if (checkIds.has(check.id) || checkedInventoryIds.has(check.inventoryId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: duplicated route check id or inventoryId: ${check.id}`,
      );
    }
    if (!inventoryIds.has(check.inventoryId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: route check inventoryId is missing: ${check.inventoryId}`,
      );
    }
    if (check.entry.type === "interaction" && !inventoryIds.has(check.entry.fromInventoryId)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: route check source inventoryId is missing: ${check.entry.fromInventoryId}`,
      );
    }
    for (const parameter of check.fixture.parameters ?? []) {
      if (
        parameter.name.trim().length === 0 ||
        parameter.value.trim().length === 0 ||
        parameter.evidence.trim().length === 0
      ) {
        throw new Error(
          `LEGACY_EVIDENCE_SCHEMA_INVALID: ${check.id} fixture parameters need name, value, and evidence`,
        );
      }
      assertNoSecretText(
        `${parameter.name} ${parameter.value} ${parameter.evidence}`,
        `${check.id} fixture parameter`,
      );
    }
    validateRuntimeObservation(check.baseline, `${check.id} baseline`);
    validateRuntimeObservation(check.target, `${check.id} target`);
    checkIds.add(check.id);
    checkedInventoryIds.add(check.inventoryId);
  }
}

function validateRuntimeObservation(observation: LegacyRuntimeObservation, label: string): void {
  if (
    typeof observation.finalUrl !== "string" ||
    !Array.isArray(observation.assertions) ||
    !Array.isArray(observation.apiChecks) ||
    !Array.isArray(observation.relevantConsoleErrors) ||
    !Array.isArray(observation.relevantNetworkErrors) ||
    typeof observation.auth?.evidence !== "string"
  ) {
    throw new Error(
      `LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} runtime evidence has an invalid structure`,
    );
  }
  const evidenceText = [
    observation.finalUrl,
    observation.auth.evidence,
    ...observation.assertions.flatMap((assertion) => [assertion.label, assertion.expected]),
    ...observation.apiChecks.map((check) => check.request),
    ...observation.relevantConsoleErrors,
    ...observation.relevantNetworkErrors,
  ].join(" ");
  assertNoSecretText(evidenceText, label);
  if (!(["api-2xx", "ui-assertion", "not-required"] as const).includes(observation.auth.kind)) {
    throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} auth proof kind is invalid`);
  }
  for (const check of observation.apiChecks) {
    if (!(["auth", "data"] as const).includes(check.purpose)) {
      throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} API purpose is invalid`);
    }
    if (check.status !== undefined && (!Number.isInteger(check.status) || check.status < 100)) {
      throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} API status is invalid`);
    }
  }
}

function validateTargetCodeProfileSchema(
  profile: LegacyTargetCodeProfile | undefined,
  projectRoot: string,
): void {
  if (profile === undefined) return;
  for (const source of profile.evidenceSources) {
    if (!isSafeRelativePath(source)) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: target code profile source is unsafe: ${source}`,
      );
    }
    resolveWithin(projectRoot, source);
  }
}

function assertNoSecretText(value: string, label: string): void {
  if (SECRET_SHAPED_CAPTURE_TEXT.test(value)) {
    throw new Error(
      `LEGACY_EVIDENCE_SCHEMA_INVALID: ${label} must not contain cookie, token, or authorization values`,
    );
  }
}

async function inspectDesignPreservation(
  manifest: LegacyVisualManifest,
  projectRoot: string,
): Promise<LegacyEvidenceReport["designPreservation"]> {
  const messages: string[] = [];
  if (manifest.migration.strategy === "redesign-approved") {
    messages.push(`재디자인 승인 범위: ${manifest.migration.redesignApproval}`);
  }
  for (const [part, status] of Object.entries(manifest.migration.preservation)) {
    if (status === "gap") messages.push(`레거시 ${part} 보존이 완료되지 않았습니다.`);
  }
  const missingTargetFiles = manifest.routeInventory
    .flatMap((item) => item.targetFiles)
    .filter((file, index, allFiles) => allFiles.indexOf(file) === index)
    .filter((file) => !existsSync(resolveWithin(projectRoot, file)));
  if (missingTargetFiles.length > 0) {
    messages.push(`선언한 대상 파일을 찾을 수 없습니다: ${missingTargetFiles.join(", ")}`);
  }
  const forbiddenImports = manifest.migration.forbiddenImports ?? ["@frontend/ui"];
  if (manifest.migration.strategy === "preserve-legacy") {
    const foundImports = await findForbiddenImports(
      projectRoot,
      manifest.targetPaths,
      forbiddenImports,
    );
    if (foundImports.length > 0) {
      messages.push(
        `보존 이관에 금지된 디자인 시스템 대체가 발견되었습니다: ${foundImports.join(", ")}`,
      );
    }
  }
  return { status: messages.length === 0 ? "passed" : "gap", messages };
}

function inspectRouteChecks(manifest: LegacyVisualManifest): RouteValidationReport {
  const messages: string[] = [];
  const checks: RouteCheckResult[] = [];
  const failedInventoryIds = new Set<string>();
  const excluded = new Set((manifest.exclusions ?? []).map((item) => item.inventoryId));
  const requiredInventory = manifest.routeInventory.filter(
    (item) => item.userVisible !== false && !excluded.has(item.id),
  );
  const checkByInventory = new Map(
    (manifest.routeChecks ?? []).map((check) => [check.inventoryId, check]),
  );

  if (manifest.schemaVersion < 4) {
    messages.push(
      "기존 manifest에는 실제 fixture·최종 URL·핵심 UI·API/인증·오류 증빙이 없습니다. schemaVersion 4 routeChecks로 보완합니다.",
    );
  }
  if (
    manifest.schemaVersion >= 4 &&
    requiredInventory.length > 1 &&
    !(manifest.routeChecks ?? []).some((check) => check.entry.type === "interaction")
  ) {
    messages.push(
      "모든 경로를 직접 열기만 했습니다. 실제 사용자 동작으로 이어지는 대표 클릭·선택 전환 한 건을 확인합니다.",
    );
  }

  for (const inventory of requiredInventory) {
    const check = checkByInventory.get(inventory.id);
    if (check === undefined) {
      failedInventoryIds.add(inventory.id);
      messages.push(
        `${inventory.route} · ${inventory.state}: 직접 URL 픽셀 비교가 아닌 라우트 동작 증빙이 없습니다.`,
      );
      continue;
    }
    const checkMessages = validateRouteCheckRuntime(check, manifest);
    const status = checkMessages.length === 0 ? "passed" : "failed";
    if (status === "failed") {
      failedInventoryIds.add(inventory.id);
      messages.push(`${inventory.route} · ${inventory.state}: ${checkMessages.join(" / ")}`);
    }
    checks.push({ check, inventory, status, messages: checkMessages });
  }

  return {
    status: messages.length === 0 ? "passed" : "gap",
    checks,
    messages,
    failedInventoryIds: [...failedInventoryIds],
  };
}

function validateRouteCheckRuntime(
  check: LegacyRouteCheck,
  manifest: LegacyVisualManifest,
): string[] {
  const messages: string[] = [];
  if (check.entry.action.trim().length === 0) messages.push("실행한 진입·클릭 동작이 없습니다.");
  if (!check.expectedUrlPattern.startsWith("/")) {
    messages.push("검증할 최종 URL pattern이 없습니다.");
  }
  if (check.fixture.summary.trim().length === 0) messages.push("fixture 설명이 없습니다.");
  if (check.apiExpectation === undefined) {
    messages.push("화면 데이터 API가 필요한지 여부를 확인하지 않았습니다.");
  } else if (!(["required", "not-required"] as const).includes(check.apiExpectation.requirement)) {
    messages.push("화면 데이터 API 필요 여부 값이 유효하지 않습니다.");
  } else if (
    check.apiExpectation.requirement === "not-required" &&
    (!("reason" in check.apiExpectation) ||
      typeof check.apiExpectation.reason !== "string" ||
      check.apiExpectation.reason.trim().length === 0)
  ) {
    messages.push("API 불필요 사유가 없습니다.");
  }
  const parameters = new Map(
    (check.fixture.parameters ?? []).map((parameter) => [parameter.name, parameter]),
  );
  for (const name of routePatternParameters(check.expectedUrlPattern)) {
    const parameter = parameters.get(name);
    if (parameter === undefined) {
      messages.push(`동적 파라미터 :${name}의 실제 fixture 출처가 없습니다.`);
      continue;
    }
    if (isPlaceholderFixture(parameter.value)) {
      messages.push(`:${name}에 임의 값 ${parameter.value}을(를) 사용할 수 없습니다.`);
    }
  }
  if (check.entry.type === "interaction" && check.entry.fromInventoryId === check.inventoryId) {
    messages.push("클릭 전환의 시작 화면과 도착 화면이 같습니다.");
  }

  const target = manifest.visualTargets.find((item) => item.inventoryId === check.inventoryId);
  const authenticatedCapture =
    target?.baselineCapture?.authState === "authenticated" ||
    target?.attempts.at(-1)?.capture?.authState === "authenticated";
  for (const [side, observation] of [
    ["레거시", check.baseline],
    ["Vue 3", check.target],
  ] as const) {
    if (observation.finalUrl.trim().length === 0) messages.push(`${side} 최종 URL이 없습니다.`);
    if (!matchesRoutePattern(observation.finalUrl, check.expectedUrlPattern)) {
      messages.push(
        `${side} 최종 URL ${observation.finalUrl || "(없음)"}이 ${check.expectedUrlPattern}와 일치하지 않습니다.`,
      );
    }
    if (observation.screenState !== check.expectedScreen) {
      messages.push(
        `${side} 화면 상태가 ${check.expectedScreen} 대신 ${observation.screenState}입니다.`,
      );
    }
    const failedAssertions = observation.assertions.filter(
      (assertion) => assertion.status !== "passed",
    );
    if (observation.assertions.length === 0) {
      messages.push(`${side} 핵심 selector/text 확인이 없습니다.`);
    }
    if (failedAssertions.length > 0) {
      messages.push(
        `${side} 핵심 UI 확인 실패: ${failedAssertions.map((item) => item.label).join(", ")}`,
      );
    }
    const vagueAssertions = observation.assertions.filter(
      (assertion) =>
        !(["selector", "text"] as const).includes(assertion.kind) ||
        typeof assertion.expected !== "string" ||
        assertion.expected.trim().length === 0,
    );
    if (vagueAssertions.length > 0) {
      messages.push(
        `${side} 핵심 UI 확인의 selector/text 기대값이 없습니다: ${vagueAssertions.map((item) => item.label).join(", ")}`,
      );
    }
    if (!isValidAuthProof(observation, authenticatedCapture)) {
      messages.push(`${side} 화면의 인증 상태를 확인할 증거가 없습니다.`);
    }
    for (const api of observation.apiChecks.filter((item) => item.required !== false)) {
      if (
        api.request.trim().length === 0 ||
        api.result !== "passed" ||
        api.status === undefined ||
        api.status < 200 ||
        api.status >= 400
      ) {
        messages.push(
          `${side} 필수 API 실패 또는 미확인: ${api.request || "(요청 미기록)"} (${api.status ?? "상태 미확인"} · ${api.result})`,
        );
      }
    }
    if (
      check.apiExpectation?.requirement === "required" &&
      !observation.apiChecks.some((api) => api.purpose === "data" && api.required !== false)
    ) {
      messages.push(`${side} 화면의 필수 데이터 API 확인이 없습니다.`);
    }
    if (observation.diagnosticsChecked !== true) {
      messages.push(`${side} 콘솔·네트워크 진단을 확인하지 않았습니다.`);
    }
    if (observation.relevantConsoleErrors.length > 0) {
      messages.push(
        `${side} 관련 콘솔 오류 ${observation.relevantConsoleErrors.length}건: ${summarizeDiagnostics(observation.relevantConsoleErrors)}`,
      );
    }
    if (observation.relevantNetworkErrors.length > 0) {
      messages.push(
        `${side} 관련 네트워크 오류 ${observation.relevantNetworkErrors.length}건: ${summarizeDiagnostics(observation.relevantNetworkErrors)}`,
      );
    }
  }
  return messages;
}

function summarizeDiagnostics(errors: readonly string[]): string {
  const visible = errors.slice(0, 2);
  return `${visible.join(", ")}${errors.length > visible.length ? ` 외 ${errors.length - visible.length}건` : ""}`;
}

function isValidAuthProof(
  observation: LegacyRuntimeObservation,
  authenticatedCapture: boolean,
): boolean {
  const proof = observation.auth;
  if (proof.evidence.trim().length === 0 || proof.status === "failed") return false;
  if (proof.status === "not-required") {
    return !authenticatedCapture && proof.kind === "not-required";
  }
  if (proof.kind === "api-2xx") {
    return observation.apiChecks.some(
      (check) =>
        check.purpose === "auth" &&
        check.result === "passed" &&
        check.status !== undefined &&
        check.status >= 200 &&
        check.status < 400,
    );
  }
  if (proof.kind === "ui-assertion") {
    return observation.assertions.some(
      (assertion) => assertion.status === "passed" && assertion.label === proof.evidence,
    );
  }
  return false;
}

async function inspectCodeConformance(
  manifest: LegacyVisualManifest,
  projectRoot: string,
): Promise<CodeConformanceReport> {
  const profile = manifest.targetCodeProfile;
  const emptyMetrics = { vueScripts: 0, scriptSetup: 0, typescriptScripts: 0 };
  if (manifest.schemaVersion < 4 || profile === undefined) {
    return {
      status: "gap",
      metrics: emptyMetrics,
      messages: [
        "UI 보존과 별개인 대상 Vue 3 코드 규격 증빙이 없습니다. 저장소 규칙을 targetCodeProfile로 선언합니다.",
      ],
    };
  }

  const files = await listTargetTextFiles(projectRoot, manifest.targetPaths);
  const entries = await Promise.all(
    files.map(async (file) => ({
      file: relativeProjectPath(projectRoot, file),
      contents: await readFile(file, "utf8"),
    })),
  );
  const vueEntries = entries.filter((entry) => entry.file.endsWith(".vue"));
  const vueScripts = vueEntries.filter((entry) => /<script\b/iu.test(entry.contents));
  const scriptSetup = vueScripts.filter((entry) => hasScriptSetup(entry.contents));
  const typescriptScripts = vueScripts.filter((entry) => hasTypeScriptScript(entry.contents));
  const messages: string[] = [];

  if (profile.evidenceSources.length === 0) {
    messages.push("대상 코드 규격의 근거 파일이 없습니다.");
  } else {
    const missingSources = profile.evidenceSources.filter(
      (source) => !existsSync(resolveWithin(projectRoot, source)),
    );
    if (missingSources.length > 0) {
      messages.push(`대상 코드 규격 근거 파일을 찾을 수 없습니다: ${missingSources.join(", ")}`);
    }
  }

  if (profile.componentStyle === "script-setup" && scriptSetup.length !== vueScripts.length) {
    messages.push(
      `<script setup> 규격이 ${scriptSetup.length}/${vueScripts.length}개입니다. Options API를 대상 규격으로 변환합니다.`,
    );
  }
  if (
    profile.componentStyle === "composition-api" &&
    vueScripts.some(
      (entry) => !hasScriptSetup(entry.contents) && !/\bsetup\s*\(/u.test(entry.contents),
    )
  ) {
    messages.push("Composition API로 변환되지 않은 Vue 컴포넌트가 있습니다.");
  }
  if (profile.language === "typescript") {
    const javascriptFiles = entries.filter((entry) => /\.[cm]?jsx?$/iu.test(entry.file));
    if (typescriptScripts.length !== vueScripts.length || javascriptFiles.length > 0) {
      messages.push(
        `TypeScript 규격 미달: Vue script ${typescriptScripts.length}/${vueScripts.length}, JS 파일 ${javascriptFiles.length}개`,
      );
    }
  }

  const combined = entries.map((entry) => entry.contents).join("\n");
  const legacyState = findFilesMatching(entries, /\b(?:vuex|mapGetters|mapActions)\b|\$store\b/iu);
  if (profile.stateManagement === "pinia") {
    if (legacyState.length > 0) {
      messages.push(`Vuex 호환 계층이 남아 있습니다: ${summarizeFiles(legacyState)}`);
    }
    if (!/\b(?:defineStore|storeToRefs|use[A-Z][A-Za-z0-9]*Store)\b/u.test(combined)) {
      messages.push("Pinia 직접 사용 증거가 없습니다.");
    }
  }
  if (profile.router === "vue-router-4") {
    if (!/\bcreateRouter\s*\(/u.test(combined) || /\bnew\s+VueRouter\b/u.test(combined)) {
      messages.push(
        "Vue Router 4 createRouter 사용 증거가 없거나 Vue Router 3 호환 코드가 남았습니다.",
      );
    }
  }
  if (profile.legacyCompatibility === "forbidden") {
    const compatibilityFiles = findFilesMatching(
      entries,
      /\bexport\s+default\s*\{|\bdata\s*\(\s*\)|\b(?:methods|computed|mixins|extends)\s*:|\bVue\.use\s*\(|\bnew\s+Vue\s*\(|\bBus\.\$(?:on|off|once|emit)\b/u,
    );
    if (compatibilityFiles.length > 0) {
      messages.push(`Vue 2 호환 계층이 남아 있습니다: ${summarizeFiles(compatibilityFiles)}`);
    }
  }

  return {
    status: messages.length === 0 ? "passed" : "gap",
    profile,
    metrics: {
      vueScripts: vueScripts.length,
      scriptSetup: scriptSetup.length,
      typescriptScripts: typescriptScripts.length,
    },
    messages,
  };
}

function hasScriptSetup(contents: string): boolean {
  return [...contents.matchAll(/<script\b([^>]*)>/giu)].some((match) =>
    /\bsetup\b/u.test(match[1] ?? ""),
  );
}

function hasTypeScriptScript(contents: string): boolean {
  return [...contents.matchAll(/<script\b([^>]*)>/giu)].some((match) =>
    /\blang\s*=\s*["']ts["']/u.test(match[1] ?? ""),
  );
}

function findFilesMatching(
  entries: ReadonlyArray<{ file: string; contents: string }>,
  pattern: RegExp,
): string[] {
  return entries.filter((entry) => pattern.test(entry.contents)).map((entry) => entry.file);
}

function summarizeFiles(files: readonly string[]): string {
  const visible = files.slice(0, 3);
  return `${visible.join(", ")}${files.length > visible.length ? ` 외 ${files.length - visible.length}개` : ""}`;
}

function routePatternParameters(pattern: string): string[] {
  return [...pattern.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/gu)].map((match) => match[1]!);
}

function isPlaceholderFixture(value: string): boolean {
  return /^(?:0+|test|sample|dummy|today|null|undefined)$/iu.test(value.trim());
}

function matchesRoutePattern(value: string, pattern: string): boolean {
  const route = normalizeObservedRoute(value);
  const expression = pattern
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/?#]+" : segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${expression}(?:[?#].*)?$`, "u").test(route);
}

function normalizeObservedRoute(value: string): string {
  try {
    const url = new URL(value);
    if (url.hash.startsWith("#/")) return url.hash.slice(1);
    return `${url.pathname}${url.search}`;
  } catch {
    return value.startsWith("#/") ? value.slice(1) : value;
  }
}

function criticalRegionGap(target: LegacyVisualTarget): string | undefined {
  if (target.criticalRegions.length === 0) {
    return "콘텐츠·컨트롤을 확인할 핵심 UI 영역이 없습니다.";
  }
  const viewportArea = target.viewport.width * target.viewport.height;
  const oversized = target.criticalRegions.filter(
    (region) => (region.width * region.height) / viewportArea >= 0.9,
  );
  if (oversized.length === 0) return undefined;
  return `전체 viewport와 사실상 같은 영역(${oversized.map((item) => item.id).join(", ")}) 대신 콘텐츠·컨트롤 핵심 영역을 지정합니다.`;
}

async function inspectSourcePreservation(
  manifest: LegacyVisualManifest,
  projectRoot: string,
  manifestDirectory: string,
): Promise<SourcePreservationReport> {
  const inventoryPath = resolveEvidencePath(
    projectRoot,
    manifestDirectory,
    manifest.sourceInventoryPath,
  );
  let inventory: LegacySourceInventory;
  try {
    inventory = await readSourceInventory(inventoryPath, manifest);
  } catch (error) {
    return {
      status: "gap",
      coverage: {
        assets: { mapped: 0, total: 0 },
        selectors: { mapped: 0, total: 0 },
        breakpoints: { mapped: 0, total: 0 },
        runtime: { mapped: 0, total: 0 },
      },
      messages: [error instanceof Error ? error.message : String(error)],
    };
  }
  const targetFiles = await listTargetTextFiles(projectRoot, manifest.targetPaths);
  const targetContents = new Map(
    await Promise.all(
      targetFiles.map(
        async (file) =>
          [relativeProjectPath(projectRoot, file), await readFile(file, "utf8")] as const,
      ),
    ),
  );
  const messages: string[] = [];
  const inventoryRoutes = new Set(manifest.routeInventory.map((item) => item.route));
  for (const route of inventory.routes) {
    if (route.scope === "supporting") continue;
    if (!inventoryRoutes.has(route.route)) {
      messages.push(
        `레거시 router 경로가 화면 매트릭스에 없습니다: ${route.sourceFile} → ${route.route}`,
      );
    }
    if (route.kind === "navigation") {
      const matchingInventory = manifest.routeInventory.filter(
        (item) => item.route === route.route,
      );
      const hasInteractionProof = matchingInventory.some((item) =>
        (manifest.routeChecks ?? []).some(
          (check) => check.inventoryId === item.id && check.entry.type === "interaction",
        ),
      );
      if (matchingInventory.length > 0 && !hasInteractionProof) {
        messages.push(
          `레거시 클릭 이동을 직접 URL로만 검증했습니다: ${route.sourceFile} → ${route.route}`,
        );
      }
    }
  }
  const inventoryWarnings = inventory.warnings ?? [];
  if (inventoryWarnings.length > 0) {
    const visible = inventoryWarnings
      .slice(0, 5)
      .map((warning) => `${warning.sourceFile} → ${warning.message}`)
      .join(" / ");
    messages.push(
      `레거시 의존성 조사 Gap ${inventoryWarnings.length}건: ${visible}${inventoryWarnings.length > 5 ? ` 외 ${inventoryWarnings.length - 5}건` : ""}`,
    );
  }
  const assets = validateAssetMappings(manifest, inventory, projectRoot, messages);
  const selectors = validateSelectorMappings(manifest, inventory, targetContents, messages);
  const breakpoints = validateBreakpointMappings(manifest, inventory, targetContents, messages);
  const runtime = validateRuntimeMappings(manifest, inventory, targetContents, messages);
  const glyphs = findForbiddenGlyphs(targetContents);
  if (glyphs.length > 0) {
    messages.push(`Unicode glyph/emoji로 대체한 아이콘이 있습니다: ${glyphs.join(", ")}`);
  }
  const placeholders = findPlaceholderSubstitutions(targetContents);
  if (placeholders.length > 0) {
    messages.push(`placeholder/mock UI 대체가 있습니다: ${placeholders.join(", ")}`);
  }
  return {
    status: messages.length === 0 ? "passed" : "gap",
    coverage: { assets, selectors, breakpoints, runtime },
    messages,
  };
}

function inspectCaptureEvidence(manifest: LegacyVisualManifest): CaptureEvidenceReport {
  const messages: string[] = [];
  const disclosures: string[] = [];
  if (manifest.schemaVersion < 3 || manifest.capturePolicy === undefined) {
    messages.push(
      "Computer Use 우선 캡처 정책 또는 제공자 기록이 없습니다. 새 캡처를 schemaVersion 4 manifest로 다시 기록합니다.",
    );
  } else if (
    manifest.capturePolicy.preferredProvider !== "computer-use" ||
    !["browser-or-playwright-when-unavailable", "browser-or-playwright-with-gap"].includes(
      manifest.capturePolicy.fallback,
    )
  ) {
    messages.push("legacy 캡처 정책은 Computer Use 우선과 공개된 fallback이어야 합니다.");
  }
  for (const target of manifest.visualTargets) {
    inspectOneCapture(target.baselineCapture, `${target.id} 레거시 기준`, messages, disclosures);
    inspectOneCapture(
      target.attempts.at(-1)?.capture,
      `${target.id} Vue 3 이관 결과`,
      messages,
      disclosures,
    );
  }
  return {
    status: messages.length === 0 ? "passed" : "gap",
    messages,
    disclosures: [...new Set(disclosures)],
  };
}

function inspectOneCapture(
  capture: LegacyCaptureEvidence | undefined,
  label: string,
  messages: string[],
  disclosures: string[],
): void {
  if (capture === undefined) {
    messages.push(`${label}의 capture provider·인증 상태 기록이 없습니다.`);
    return;
  }
  if (capture.provider !== "computer-use") {
    disclosures.push(
      `${captureProviderLabel(capture.provider)} fallback · ${captureAuthLabel(capture.authState)} · ${capture.fallbackReason}`,
    );
  }
}

async function readSourceInventory(
  inventoryPath: string,
  manifest: LegacyVisualManifest,
): Promise<LegacySourceInventory> {
  if (!existsSync(inventoryPath)) {
    throw new Error(`LEGACY_SOURCE_INVENTORY_MISSING: ${inventoryPath}`);
  }
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as LegacySourceInventory;
  if (inventory.schemaVersion !== 1 || inventory.legacyProjectRoot !== manifest.legacyProjectRoot) {
    throw new Error(
      "LEGACY_SOURCE_INVENTORY_INVALID: source inventory does not match legacyProjectRoot",
    );
  }
  for (const collection of [
    inventory.routes,
    inventory.assets,
    inventory.selectors,
    inventory.breakpoints,
    inventory.runtimeDependencies,
    inventory.supportingDependencies ?? [],
    inventory.warnings ?? [],
  ]) {
    if (!Array.isArray(collection) || collection.some((item) => !SAFE_ID.test(item.id))) {
      throw new Error("LEGACY_SOURCE_INVENTORY_INVALID: inventory collections require safe ids");
    }
  }
  return inventory;
}

function validateAssetMappings(
  manifest: LegacyVisualManifest,
  inventory: LegacySourceInventory,
  projectRoot: string,
  messages: string[],
): { mapped: number; total: number } {
  const mappings = new Map(
    manifest.assetMappings.map((mapping) => [mapping.sourceAssetId, mapping]),
  );
  let mapped = 0;
  const findings: string[] = [];
  for (const asset of inventory.assets) {
    const mapping = mappings.get(asset.id);
    if (mapping === undefined) {
      findings.push(`mapping 누락 ${asset.sourceFile} → ${asset.reference}`);
      continue;
    }
    if (mapping.status !== "preserved") {
      findings.push(assetMappingGap(asset.reference, mapping.status, mapping.approval));
      continue;
    }
    if (
      !isCanonicalUrl(mapping.target) &&
      !existsSync(resolveWithin(projectRoot, mapping.target))
    ) {
      findings.push(`대상 없음 ${asset.reference} → ${mapping.target}`);
      continue;
    }
    mapped += 1;
  }
  for (const mapping of manifest.assetMappings) {
    if (!inventory.assets.some((asset) => asset.id === mapping.sourceAssetId)) {
      findings.push(`존재하지 않는 source id ${mapping.sourceAssetId}`);
    }
  }
  appendCoverageFindings(messages, "레거시 asset 보존 Gap", findings);
  return { mapped, total: inventory.assets.length };
}

function validateSelectorMappings(
  manifest: LegacyVisualManifest,
  inventory: LegacySourceInventory,
  targetContents: Map<string, string>,
  messages: string[],
): { mapped: number; total: number } {
  const mappings = new Map(
    manifest.selectorMappings.map((mapping) => [mapping.sourceSelectorId, mapping]),
  );
  let mapped = 0;
  const findings: string[] = [];
  for (const selector of inventory.selectors) {
    const mapping = mappings.get(selector.id);
    if (mapping === undefined) {
      findings.push(`mapping 누락 ${selector.sourceFile} → ${selector.selector}`);
      continue;
    }
    if (mapping.status !== "preserved") {
      findings.push(assetMappingGap(selector.selector, mapping.status, mapping.approval));
      continue;
    }
    if (mapping.targetSelector !== selector.selector) {
      findings.push(`selector 변경 ${selector.selector} → ${mapping.targetSelector}`);
      continue;
    }
    if (!containsTargetText(targetContents, mapping.targetSelector)) {
      findings.push(`대상 CSS에 없음 ${selector.selector}`);
      continue;
    }
    mapped += 1;
  }
  appendCoverageFindings(messages, "레거시 CSS selector 보존 Gap", findings);
  return { mapped, total: inventory.selectors.length };
}

function validateBreakpointMappings(
  manifest: LegacyVisualManifest,
  inventory: LegacySourceInventory,
  targetContents: Map<string, string>,
  messages: string[],
): { mapped: number; total: number } {
  const mappings = new Map(
    manifest.breakpointMappings.map((mapping) => [mapping.sourceBreakpointId, mapping]),
  );
  let mapped = 0;
  const findings: string[] = [];
  for (const breakpoint of inventory.breakpoints) {
    const mapping = mappings.get(breakpoint.id);
    if (mapping === undefined) {
      findings.push(`mapping 누락 ${breakpoint.sourceFile} → ${breakpoint.query}`);
      continue;
    }
    if (mapping.status !== "preserved") {
      findings.push(assetMappingGap(breakpoint.query, mapping.status, mapping.approval));
      continue;
    }
    if (mapping.targetQuery !== breakpoint.query) {
      findings.push(`breakpoint 변경 ${breakpoint.query} → ${mapping.targetQuery}`);
      continue;
    }
    if (!containsTargetText(targetContents, mapping.targetQuery)) {
      findings.push(`대상 CSS에 없음 ${breakpoint.query}`);
      continue;
    }
    mapped += 1;
  }
  appendCoverageFindings(messages, "레거시 breakpoint 보존 Gap", findings);
  return { mapped, total: inventory.breakpoints.length };
}

function validateRuntimeMappings(
  manifest: LegacyVisualManifest,
  inventory: LegacySourceInventory,
  targetContents: Map<string, string>,
  messages: string[],
): { mapped: number; total: number } {
  const mappings = new Map(
    manifest.runtimeMappings.map((mapping) => [mapping.sourceRuntimeId, mapping]),
  );
  let mapped = 0;
  for (const dependency of inventory.runtimeDependencies) {
    const mapping = mappings.get(dependency.id);
    if (mapping === undefined) {
      messages.push(
        `레거시 ${dependency.kind} mapping 누락: ${dependency.sourceFile} → ${dependency.marker}`,
      );
      continue;
    }
    if (mapping.status !== "preserved") {
      messages.push(assetMappingGap(dependency.marker, mapping.status, mapping.approval));
      continue;
    }
    if (!runtimeEvidenceMatches(dependency, mapping.targetEvidence)) {
      messages.push(
        `runtime mapping이 실제 레거시 구성요소를 증명하지 않습니다: ${dependency.marker}`,
      );
      continue;
    }
    const mappedContents = mapping.targetFiles
      .map((file) => targetContents.get(file) ?? "")
      .join("\n");
    if (!mappedContents.includes(mapping.targetEvidence)) {
      messages.push(
        `실제 runtime 보존 증거가 없습니다: ${dependency.marker} → ${mapping.targetEvidence}`,
      );
      continue;
    }
    mapped += 1;
  }
  return { mapped, total: inventory.runtimeDependencies.length };
}

function runtimeEvidenceMatches(
  dependency: LegacySourceInventory["runtimeDependencies"][number],
  evidence: string,
): boolean {
  if (evidence.includes(dependency.marker)) return true;
  if (dependency.kind === "map-sdk") return /kakao.?map|kakao\.maps/iu.test(evidence);
  if (dependency.kind === "carousel") return /swiper|carousel/iu.test(evidence);
  return /bridge|webview|messageHandlers/iu.test(evidence);
}

function assetMappingGap(source: string, status: string, approval: string | undefined): string {
  if (status === "approved-replacement") {
    return `레거시 ${source}를 승인된 대체로 바꿨습니다: ${approval}`;
  }
  return `레거시 ${source} 보존이 Gap 상태입니다.`;
}

function appendCoverageFindings(
  messages: string[],
  label: string,
  findings: readonly string[],
): void {
  if (findings.length === 0) return;
  const visible = findings.slice(0, 3);
  messages.push(
    `${label} ${findings.length}건: ${visible.join(" / ")}${findings.length > visible.length ? ` 외 ${findings.length - visible.length}건` : ""}`,
  );
}

function isCanonicalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function containsTargetText(targetContents: Map<string, string>, expected: string): boolean {
  return [...targetContents.values()].some((contents) => contents.includes(expected));
}

async function listTargetTextFiles(projectRoot: string, targetPaths: string[]): Promise<string[]> {
  return (
    await Promise.all(
      targetPaths.map((targetPath) => listTextFiles(resolveWithin(projectRoot, targetPath))),
    )
  ).flat();
}

function findForbiddenGlyphs(targetContents: Map<string, string>): string[] {
  const findings: string[] = [];
  const glyph = /[\u2300-\u2bff\u{1f000}-\u{1faff}]/gu;
  for (const [file, contents] of targetContents) {
    const matched = [...contents.matchAll(glyph)].map((match) => match[0]).filter(Boolean);
    if (matched.length > 0) findings.push(`${file} (${[...new Set(matched)].join(" ")})`);
  }
  return findings;
}

function findPlaceholderSubstitutions(targetContents: Map<string, string>): string[] {
  const findings: string[] = [];
  const placeholder =
    /\b(?:mock(?:[-_ ]?(?:map|icon|logo))?|fake(?:[-_ ]?(?:map|icon|logo))?|(?:map|icon|logo)[-_ ]?placeholder)\b/giu;
  for (const [file, contents] of targetContents) {
    const matched = [...contents.matchAll(placeholder)].map((match) => match[0]).filter(Boolean);
    if (matched.length > 0) findings.push(`${file} (${[...new Set(matched)].join(", ")})`);
  }
  return findings;
}

function appendPublishingGaps(
  publishing: LegacyPublishingStatus | undefined,
  gaps: LegacyEvidenceReport["gaps"],
): void {
  if (publishing?.plugin.status === "failed") {
    gaps.push({
      item: `플러그인 발행 실패: ${publishing.plugin.summary}`,
      impact: "중간",
      nextAction:
        publishing.draft.status === "published"
          ? "fallback 발행 사실과 실패 원인을 Draft PR 본문에 반영합니다."
          : "인증·TLS·권한을 해결하거나 허용된 fallback 발행을 시도합니다.",
    });
  }
  if (publishing?.draft.status === "failed") {
    gaps.push({
      item: `Draft PR 발행 실패: ${publishing.draft.summary}`,
      impact: "높음",
      nextAction:
        "발행 권한·인증서·API 접근을 확인한 뒤 같은 branch의 Draft를 생성하거나 갱신합니다.",
    });
  }
}

async function findForbiddenImports(
  projectRoot: string,
  targetPaths: string[],
  forbiddenImports: string[],
): Promise<string[]> {
  const findings: string[] = [];
  for (const targetPath of targetPaths) {
    const absolutePath = resolveWithin(projectRoot, targetPath);
    for (const file of await listTextFiles(absolutePath)) {
      const contents = await readFile(file, "utf8");
      for (const forbiddenImport of forbiddenImports) {
        if (contents.includes(forbiddenImport)) {
          findings.push(`${relativeProjectPath(projectRoot, file)} → ${forbiddenImport}`);
        }
      }
    }
  }
  return findings;
}

async function listTextFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) return TEXT_FILE.test(directory) ? [directory] : [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTextFiles(entryPath);
      return TEXT_FILE.test(entry.name) ? [entryPath] : [];
    }),
  );
  return files.flat();
}

async function findUnstagedPaths(projectRoot: string, evidencePaths: string[]): Promise<string[]> {
  const uniquePaths = [...new Set(evidencePaths)];
  const results = await Promise.all(
    uniquePaths.map(async (evidencePath) => {
      try {
        await execFileAsync("git", [
          "-C",
          projectRoot,
          "ls-files",
          "--cached",
          "--error-unmatch",
          "--",
          evidencePath,
        ]);
        await execFileAsync("git", ["-C", projectRoot, "diff", "--quiet", "--", evidencePath]);
        return undefined;
      } catch {
        return evidencePath;
      }
    }),
  );
  return results.filter((value): value is string => value !== undefined);
}

function renderLegacyMarkdown(
  manifest: LegacyVisualManifest,
  report: Omit<LegacyEvidenceReport, "markdown">,
  options: LegacyEvidenceOptions,
): string {
  const verification =
    report.status === "verified"
      ? "검증됨 — 모든 사용자 노출 화면·상태가 비교되고 레거시 보존 점검을 통과했습니다."
      : "미검증 — Draft 검토는 가능하지만 merge-ready가 아닙니다. 아래 Gap과 화면 범위를 확인해 주세요.";
  const scopeRows = manifest.routeInventory
    .filter((item) => item.userVisible !== false)
    .map(
      (item) =>
        `| ${escapeCell(`${item.route} · ${item.state}`)} | ${escapeCell(item.sourceFiles.join(", "))} | ${escapeCell(item.targetFiles.join(", "))} | ${targetStatus(report.targets, report.exclusions, item.id)} |`,
    )
    .join("\n");
  const visualPairs = report.targets
    .map((target) => {
      const score = target.result === undefined ? "측정하지 못함" : target.result.matchPercent;
      const actual =
        target.artifacts.actual === undefined
          ? "이관 이미지 없음"
          : imageMarkdown("Vue 3", target.artifacts.actual, options);
      const diff =
        target.artifacts.diff === undefined
          ? "Diff 없음"
          : linkMarkdown("Diff 이미지", target.artifacts.diff, options);
      return `### ${target.inventory.route} · ${target.inventory.state}

**${statusLabel(target.status)} · ${score}** · ${target.target.viewport.width}×${target.target.viewport.height} @${target.target.viewport.dpr} · ${escapeCell(target.target.fixture)}

| 레거시 | Vue 3 |
| --- | --- |
| ${imageMarkdown("레거시", target.artifacts.baseline, options)} | ${actual} |

${diff}`;
    })
    .join("\n\n");
  const captureDisclosure = report.captureEvidence.disclosures.length
    ? `> 캡처: ${report.captureEvidence.disclosures.map(escapeCell).join("<br>")}`
    : "";
  const gapSection = renderGapSection(report.gaps);
  const exclusionSection = renderExclusionSection(report.exclusions, manifest);
  const routeRows = report.routeValidation.checks
    .map((result) => renderRouteCheckRow(result, manifest))
    .join("\n");
  const routeSection = routeRows
    ? `## 라우트 동작 확인

| 시작 · 동작 | 실제 fixture | 최종 경로 | 핵심 UI | API · 인증 | 관련 오류 | 결과 |
| --- | --- | --- | --- | --- | --- | --- |
${routeRows}`
    : "";
  const codeSection = renderCodeConformance(report.codeConformance);

  return `## 검토자 결정

> **${report.status === "verified" ? "VERIFIED" : "NOT VERIFIED"}** · 좌우 비교 ${report.coverage.passed}/${report.coverage.required} 통과 · 제외 ${report.coverage.excluded}개
>
> ${verification}

${gapSection}

## 이관 범위

| 레거시 경로 · 상태 | 원본 파일 | 대상 파일 | 화면 증빙 |
| --- | --- | --- | --- |
${scopeRows}

${routeSection}

## 좌우 이미지 비교

${captureDisclosure}

${visualPairs || "비교 대상 없음"}

## 보존 이관 확인

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 전략 | ${manifest.migration.strategy === "preserve-legacy" ? "레거시 DOM·CSS·자산 보존" : "승인된 재디자인"} | ${escapeCell(manifest.migration.redesignApproval ?? "디자인 시스템 대체 금지")} |
| 템플릿 · 스타일 · 자산 · 컨트롤 | ${report.designPreservation.status === "passed" ? "통과" : "Gap"} | ${escapeCell(report.designPreservation.messages.join(" / ") || "보존 확인 완료")} |
| asset inventory | ${report.sourcePreservation.coverage.assets.mapped}/${report.sourcePreservation.coverage.assets.total} | ${report.sourcePreservation.status === "passed" ? "원본 asset 1:1 보존" : "누락·대체는 Gap 참고"} |
| CSS selector · breakpoint | ${report.sourcePreservation.coverage.selectors.mapped}/${report.sourcePreservation.coverage.selectors.total} · ${report.sourcePreservation.coverage.breakpoints.mapped}/${report.sourcePreservation.coverage.breakpoints.total} | selector·상태·반응형 보존 |
| runtime UI (지도·carousel·bridge) | ${report.sourcePreservation.coverage.runtime.mapped}/${report.sourcePreservation.coverage.runtime.total} | 실제 SDK/구성요소 증거 |

${codeSection}

${exclusionSection}

${renderPublishingSection(report.publishing)}
`;
}

function renderGapSection(gaps: LegacyEvidenceReport["gaps"]): string {
  if (gaps.length === 0) return "";
  const rows = gaps
    .map(
      (gap) =>
        `| ${escapeCell(gap.item)} | ${escapeCell(gap.impact)} | ${escapeCell(gap.nextAction)} |`,
    )
    .join("\n");
  return `## 핵심 Gap

| 확인 또는 개발이 필요한 내용 | 영향 | 리뷰어 판단 · 다음 작업 |
| --- | --- | --- |
${rows}`;
}

function renderExclusionSection(
  exclusions: readonly LegacyVisualExclusion[],
  manifest: LegacyVisualManifest,
): string {
  if (exclusions.length === 0) return "";
  const rows = exclusions
    .map(
      (exclusion) =>
        `| ${escapeCell(inventoryLabel(manifest, exclusion.inventoryId))} | ${escapeCell(exclusion.reason)} | ${escapeCell(exclusion.impact)} | ${escapeCell(exclusion.reviewerDecision)} |`,
    )
    .join("\n");
  return `## 비교 제외

| 경로 · 상태 | 제외 사유 | 영향 | 리뷰어 결정 |
| --- | --- | --- | --- |
${rows}`;
}

function renderRouteCheckRow(result: RouteCheckResult, manifest: LegacyVisualManifest): string {
  const { check } = result;
  const entry =
    check.entry.type === "direct"
      ? check.entry.action
      : `${inventoryLabel(manifest, check.entry.fromInventoryId)} → ${check.entry.action}`;
  const parameters = check.fixture.parameters ?? [];
  const fixture = [
    check.fixture.summary,
    ...parameters.map((item) => `${item.name}=${item.value} (${item.provenance})`),
  ].join(" · ");
  const uiPassed = check.target.assertions.filter((item) => item.status === "passed").length;
  const requiredApis = check.target.apiChecks.filter((item) => item.required !== false);
  const passedApis = requiredApis.filter(
    (item) =>
      item.result === "passed" &&
      item.status !== undefined &&
      item.status >= 200 &&
      item.status < 400,
  ).length;
  const apiAndAuth = `${passedApis}/${requiredApis.length} API · 인증 ${routeAuthLabel(check.target.auth.status)}`;
  const errors =
    check.target.relevantConsoleErrors.length + check.target.relevantNetworkErrors.length;
  return `| ${escapeCell(entry)} | ${escapeCell(fixture)} | ${escapeCell(normalizeObservedRoute(check.target.finalUrl))} | ${uiPassed}/${check.target.assertions.length} | ${escapeCell(apiAndAuth)} | ${errors}건 | ${result.status === "passed" ? "통과" : "Gap"} |`;
}

function renderCodeConformance(report: CodeConformanceReport): string {
  if (report.profile === undefined) {
    return `## Vue 3 규격 이관

대상 저장소 코드 규격 증빙이 없어 Gap입니다.`;
  }
  const profile = report.profile;
  const notes =
    report.messages.length === 0 ? "대상 저장소 규격 충족" : report.messages.join(" / ");
  return `## Vue 3 규격 이관

| 항목 | 대상 규격 | 결과 |
| --- | --- | --- |
| Vue SFC | ${profile.componentStyle} | ${report.metrics.scriptSetup}/${report.metrics.vueScripts} script setup |
| 언어 | ${profile.language} | ${report.metrics.typescriptScripts}/${report.metrics.vueScripts} TypeScript script |
| 상태 · 라우터 | ${profile.stateManagement} · ${profile.router} | ${report.status === "passed" ? "통과" : "Gap"} |
| 호환 계층 | ${profile.legacyCompatibility === "forbidden" ? "Vue 2 호환 계층 금지" : "허용"} | ${escapeCell(notes)} |`;
}

function routeAuthLabel(status: LegacyAuthProof["status"]): string {
  if (status === "passed") return "확인";
  if (status === "not-required") return "불필요";
  return "실패";
}

function renderPublishingSection(publishing: LegacyPublishingStatus | undefined): string {
  if (
    publishing === undefined ||
    (publishing.plugin.status === "not-attempted" && publishing.draft.status === "not-attempted")
  ) {
    return "";
  }
  const plugin = `${publishing.plugin.status}${publishing.plugin.summary === undefined ? "" : ` — ${escapeCell(publishing.plugin.summary)}`}`;
  const draftDetail = [
    publishing.draft.method,
    publishing.draft.url === undefined ? undefined : `[Draft MR](${publishing.draft.url})`,
    publishing.draft.summary,
  ]
    .filter((value): value is string => value !== undefined)
    .map(escapeCell)
    .join(" · ");
  return `## 발행 상태

| 단계 | 결과 | 세부 사항 |
| --- | --- | --- |
| 플러그인 발행 | ${plugin} | ${publishing.plugin.status === "failed" ? "실패 원인은 Gap에도 기록" : ""} |
| Draft PR | ${publishing.draft.status} | ${draftDetail || "-"} |
`;
}

function targetStatus(
  targets: LegacyEvidenceTargetResult[],
  exclusions: LegacyVisualExclusion[],
  inventoryId: string,
): string {
  const target = targets.find((candidate) => candidate.inventory.id === inventoryId);
  if (target !== undefined) return statusLabel(target.status);
  return exclusions.some((exclusion) => exclusion.inventoryId === inventoryId)
    ? "명시적 제외"
    : "누락";
}

function statusLabel(status: LegacyEvidenceTargetResult["status"]): string {
  if (status === "passed") return "통과";
  if (status === "failed") return "미달";
  return "Gap";
}

function captureProviderLabel(provider: LegacyCaptureProvider): string {
  if (provider === "computer-use") return "Computer Use";
  if (provider === "browser") return "Browser";
  return "Playwright";
}

function captureAuthLabel(authState: LegacyCaptureAuthState): string {
  if (authState === "authenticated") return "로그인";
  if (authState === "unauthenticated") return "비로그인";
  if (authState === "not-required") return "인증 불필요";
  return "인증 상태 미확인";
}

function imageMarkdown(
  label: string,
  evidencePath: string,
  options: LegacyEvidenceOptions,
): string {
  return `![${label}](${evidenceUrl(evidencePath, options)})`;
}

function linkMarkdown(label: string, evidencePath: string, options: LegacyEvidenceOptions): string {
  return `[${label}](${evidenceUrl(evidencePath, options)})`;
}

function evidenceUrl(evidencePath: string, options: LegacyEvidenceOptions): string {
  if (options.repositoryWebUrl === undefined || options.sourceRef === undefined) {
    return `./${encodePath(evidencePath)}`;
  }
  const base = options.repositoryWebUrl.replace(/\/$/u, "");
  const ref = encodeURIComponent(options.sourceRef);
  const encodedPath = encodePath(evidencePath);
  if (/github\.com$/iu.test(new URL(base).hostname)) return `${base}/raw/${ref}/${encodedPath}`;
  if (/gitlab/iu.test(new URL(base).hostname)) return `${base}/-/raw/${ref}/${encodedPath}`;
  return `${base}/raw/${ref}/${encodedPath}`;
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function inventoryLabel(manifest: LegacyVisualManifest, inventoryId: string): string {
  const item = manifest.routeInventory.find((candidate) => candidate.id === inventoryId);
  return item === undefined ? inventoryId : `${item.route} · ${item.state}`;
}

function resolveEvidencePath(
  projectRoot: string,
  manifestDirectory: string,
  evidencePath: string,
): string {
  if (!isSafeRelativePath(evidencePath)) {
    throw new Error(
      `LEGACY_EVIDENCE_SCHEMA_INVALID: evidence paths must stay relative: ${evidencePath}`,
    );
  }
  const resolved = resolveWithin(manifestDirectory, evidencePath);
  if (!isInside(projectRoot, resolved)) {
    throw new Error(
      `LEGACY_EVIDENCE_SCHEMA_INVALID: evidence path escapes project: ${evidencePath}`,
    );
  }
  return resolved;
}

function resolveWithin(root: string, ...parts: string[]): string {
  const resolved = path.resolve(root, ...parts);
  if (!isInside(root, resolved) && path.resolve(root) !== resolved) {
    throw new Error(`Path escapes allowed root: ${parts.join("/")}`);
  }
  return resolved;
}

function relativeProjectPath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..");
}

function isTargetPath(file: string, targetPaths: string[]): boolean {
  if (!isSafeRelativePath(file)) return false;
  return targetPaths.some((targetPath) => file === targetPath || file.startsWith(`${targetPath}/`));
}

function assertSafeId(value: string, name: string): void {
  if (!SAFE_ID.test(value))
    throw new Error(`LEGACY_EVIDENCE_SCHEMA_INVALID: ${name} must be a safe identifier`);
}

type CliOptions = LegacyEvidenceOptions & { manifestPath: string; writePrSection?: string };

function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new Error(
        "Usage: legacy-visual-evidence --manifest <json> --project-root <path> [--write-pr-section <md>] [--repository-web-url <url> --source-ref <branch>] [--allow-unstaged]",
      );
    }
    values.set(flag, value);
  }
  const manifestPath = values.get("--manifest");
  const projectRoot = values.get("--project-root");
  if (manifestPath === undefined || projectRoot === undefined) {
    throw new Error(
      "Usage: legacy-visual-evidence --manifest <json> --project-root <path> [--write-pr-section <md>] [--repository-web-url <url> --source-ref <branch>] [--allow-unstaged]",
    );
  }
  const allowUnstaged = values.get("--allow-unstaged") === "true";
  const writePrSection = values.get("--write-pr-section");
  const repositoryWebUrl = values.get("--repository-web-url");
  const sourceRef = values.get("--source-ref");
  return {
    manifestPath,
    projectRoot,
    requireStaged: !allowUnstaged,
    ...(writePrSection === undefined ? {} : { writePrSection }),
    ...(repositoryWebUrl === undefined ? {} : { repositoryWebUrl }),
    ...(sourceRef === undefined ? {} : { sourceRef }),
  };
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (/legacy-visual-evidence\.(?:[cm]?js|ts)$/u.test(invokedPath)) {
  void runCli();
}

async function runCli(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = JSON.parse(
      await readFile(options.manifestPath, "utf8"),
    ) as LegacyVisualManifest;
    const report = await buildLegacyEvidenceReport(manifest, options);
    if (options.writePrSection !== undefined) {
      await writeFile(options.writePrSection, report.markdown, "utf8");
    }
    process.stdout.write(`${JSON.stringify({ ...report, markdown: undefined })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
