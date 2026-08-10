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

const execFileAsync = promisify(execFile);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/iu;
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|s[ac]ss|less)$/iu;

export type LegacyVisualManifest = {
  schemaVersion: 1;
  case: "legacy";
  change: string;
  legacyProjectRoot: string;
  targetPaths: string[];
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
};

export type LegacyRouteInventoryItem = {
  id: string;
  route: string;
  state: string;
  sourceFiles: string[];
  targetFiles: string[];
  userVisible?: boolean;
};

export type LegacyVisualTarget = {
  id: string;
  inventoryId: string;
  fixture: string;
  viewport: { width: number; height: number; dpr: number };
  baselinePath: string;
  attempts: Array<{ actualPath: string; diffPath: string }>;
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
  targets: LegacyEvidenceTargetResult[];
  exclusions: LegacyVisualExclusion[];
  gaps: Array<{ item: string; impact: string; nextAction: string }>;
  markdown: string;
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
  for (const message of designPreservation.messages) {
    gaps.push({
      item: "레거시 UI 보존 확인",
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
      const status = result.status;
      if (status === "failed") {
        gaps.push({
          item: `${inventory.route} · ${inventory.state} 화면 일치율 ${result.matchPercent}`,
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
    targets: results,
    exclusions,
    gaps,
    markdown: renderLegacyMarkdown(
      manifest,
      { status, coverage, designPreservation, targets: results, exclusions, gaps },
      options,
    ),
  };
}

function validateManifest(manifest: LegacyVisualManifest, projectRoot: string): void {
  if (manifest.schemaVersion !== 1 || manifest.case !== "legacy") {
    throw new Error("LEGACY_EVIDENCE_SCHEMA_INVALID: schemaVersion 1 and case legacy are required");
  }
  assertSafeId(manifest.change, "change");
  if (!path.isAbsolute(manifest.legacyProjectRoot)) {
    throw new Error("LEGACY_EVIDENCE_SCHEMA_INVALID: legacyProjectRoot must be an absolute path");
  }
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
    if (target.criticalRegions.length === 0) {
      throw new Error(
        `LEGACY_EVIDENCE_SCHEMA_INVALID: ${target.id} needs at least one critical UI region`,
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
  const visualRows = report.targets
    .map((target) => {
      const images = [
        imageMarkdown("레거시", target.artifacts.baseline, options),
        target.artifacts.actual === undefined
          ? "이관 이미지 없음"
          : imageMarkdown("Vue 3", target.artifacts.actual, options),
        target.artifacts.diff === undefined
          ? "Diff 없음"
          : linkMarkdown("Diff", target.artifacts.diff, options),
      ].join("<br>");
      const score = target.result === undefined ? "측정하지 못함" : target.result.matchPercent;
      const critical =
        target.result === undefined
          ? "-"
          : target.result.regions.map((region) => `${region.id} ${region.matchPercent}`).join(", ");
      return `| ${escapeCell(`${target.inventory.route} · ${target.inventory.state}`)} | ${escapeCell(target.target.fixture)} | ${target.target.viewport.width}×${target.target.viewport.height} @${target.target.viewport.dpr} | ${score} | ${critical} | ${statusLabel(target.status)} | ${images} |`;
    })
    .join("\n");
  const exclusions = report.exclusions.length
    ? report.exclusions
        .map(
          (exclusion) =>
            `| ${escapeCell(inventoryLabel(manifest, exclusion.inventoryId))} | ${escapeCell(exclusion.reason)} | ${escapeCell(exclusion.impact)} | ${escapeCell(exclusion.reviewerDecision)} |`,
        )
        .join("\n")
    : "| 없음 | - | - | - |";
  const gaps = report.gaps.length
    ? report.gaps
        .map(
          (gap) =>
            `| ${escapeCell(gap.item)} | ${escapeCell(gap.impact)} | ${escapeCell(gap.nextAction)} |`,
        )
        .join("\n")
    : "| 없음 | - | - |";

  return `## 검토자 결정

> **${report.status === "verified" ? "VERIFIED" : "NOT VERIFIED"}** · 화면 비교 ${report.coverage.passed}/${report.coverage.required} 통과 · 제외 ${report.coverage.excluded}개
>
> ${verification}

## 이관 범위

| 레거시 경로 · 상태 | 원본 파일 | 대상 파일 | 화면 증빙 |
| --- | --- | --- | --- |
${scopeRows}

## 화면 비교

| 경로 · 상태 | Fixture | Viewport | 전체 일치율 | 핵심 UI 영역 | 결과 | 기준 · 이관 결과 · Diff |
| --- | --- | --- | ---: | --- | --- | --- |
${visualRows || "| 비교 대상 없음 | - | - | - | - | Gap | - |"}

## 보존 이관 확인

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 전략 | ${manifest.migration.strategy === "preserve-legacy" ? "레거시 DOM·CSS·자산 보존" : "승인된 재디자인"} | ${escapeCell(manifest.migration.redesignApproval ?? "디자인 시스템 대체 금지")} |
| 템플릿 · 스타일 · 자산 · 컨트롤 | ${report.designPreservation.status === "passed" ? "통과" : "Gap"} | ${escapeCell(report.designPreservation.messages.join(" / ") || "보존 확인 완료")} |

## 비교 제외

| 경로 · 상태 | 제외 사유 | 영향 | 리뷰어 결정 |
| --- | --- | --- |
${exclusions}

## Gap

| 확인 또는 개발이 필요한 내용 | 영향 | 다음 작업 |
| --- | --- | --- |
${gaps}
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
