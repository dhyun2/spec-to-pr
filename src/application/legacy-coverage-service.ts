import path from "node:path";

import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  LegacyFeatureInventorySchema,
  LegacyFeatureSchema,
  scanLegacyFeatureInventory,
} from "../legacy/legacy-feature-inventory.js";
import type { LegacyFeature, LegacyFeatureInventory } from "../legacy/legacy-feature-inventory.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { GapSchema } from "../runtime/gap.js";
import {
  createArtifactId,
  createEvidenceId,
  createGapId,
  createSourceId,
} from "../runtime/id-factory.js";
import { ArtifactIdSchema, CheckIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import { EvidenceRefSchema, SourceRefSchema } from "../runtime/source.js";
import type { ArtifactRef, EvidenceRef, Gap, SourceRef } from "../runtime/index.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RunStore } from "../store/run-store.js";

const LEGACY_COVERAGE_ADAPTER = "legacy-feature-inventory-v1" as const;

type CoverageText = {
  kind: ArtifactRef["kind"];
  text: string;
};

type CheckText = {
  kind: string;
  text: string;
};

const COVERAGE_ARTIFACT_KINDS = new Set([
  "openspec",
  "gherkin",
  "test-matrix",
  "source-code",
  "test-report",
  "coverage-report",
  "agent-result-report",
]);

const EXECUTION_ARTIFACT_KINDS = new Set(["test-report", "coverage-report"]);

const EXECUTION_CHECK_KINDS = new Set(["unit", "component", "contract", "acceptance", "e2e"]);

export const GenerateLegacyFeatureInventoryInputSchema = z
  .object({
    runId: RunIdSchema,
    legacyRoot: z.string().trim().min(1),
    includeGlobs: z.array(z.string().trim().min(1)).optional(),
    maxFileBytes: z.number().int().positive().optional(),
  })
  .strict();

export const GenerateLegacyFeatureInventoryResultSchema = z
  .object({
    run: RunSummarySchema,
    inventoryArtifactId: ArtifactIdSchema,
    featureCount: z.number().int().nonnegative(),
    scannedFileCount: z.number().int().nonnegative(),
  })
  .strict();

export const BuildFeatureCoverageMatrixInputSchema = z
  .object({
    runId: RunIdSchema,
    inventoryArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const FeatureCoverageRowSchema = z
  .object({
    featureId: z.string().trim().min(1),
    category: z.string().trim().min(1),
    label: z.string().trim().min(1),
    file: z.string().trim().min(1),
    line: z.number().int().positive(),
    covered: z.boolean(),
    matchedArtifactIds: z.array(ArtifactIdSchema).default([]),
    documentationArtifactIds: z.array(ArtifactIdSchema).default([]),
    testArtifactIds: z.array(ArtifactIdSchema).default([]),
    checkIds: z.array(CheckIdSchema).default([]),
    coverageLevel: z.enum(["none", "documented", "executed"]),
    fidelitySeverity: z.enum(["info", "major", "blocker"]),
    missingReason: z.string().trim().min(1).optional(),
    gapId: z.string().trim().min(1).optional(),
  })
  .strict();

export const FeatureCoverageMatrixSchema = z
  .object({
    schemaVersion: z.literal("feature-coverage-matrix-v1"),
    runId: RunIdSchema,
    generatedAt: IsoDateTimeSchema,
    inventoryArtifactId: ArtifactIdSchema,
    featureCount: z.number().int().nonnegative(),
    coveredCount: z.number().int().nonnegative(),
    uncoveredCount: z.number().int().nonnegative(),
    rows: z.array(FeatureCoverageRowSchema),
  })
  .strict();

export const BuildFeatureCoverageMatrixResultSchema = z
  .object({
    run: RunSummarySchema,
    inventoryArtifactId: ArtifactIdSchema,
    matrixArtifactId: ArtifactIdSchema,
    featureCount: z.number().int().nonnegative(),
    coveredCount: z.number().int().nonnegative(),
    uncoveredCount: z.number().int().nonnegative(),
    gapIds: z.array(z.string().trim().min(1)),
  })
  .strict();

export class LegacyCoverageService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generateInventory(rawInput: unknown) {
    const input = GenerateLegacyFeatureInventoryInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const inventory = await scanLegacyFeatureInventory({
      legacyRoot: path.resolve(input.legacyRoot),
      generatedAt: timestamp,
      ...(input.includeGlobs === undefined ? {} : { includeGlobs: input.includeGlobs }),
      ...(input.maxFileBytes === undefined ? {} : { maxFileBytes: input.maxFileBytes }),
    });
    const { source: legacySource, shouldAddSource } = getOrCreateLegacySource({
      sources: run.sources,
      inventory,
      timestamp,
    });
    const existingEvidence = new Map(
      run.evidence
        .filter((evidence) => evidence.metadata["adapter"] === LEGACY_COVERAGE_ADAPTER)
        .map((evidence) => [String(evidence.metadata["legacyFeatureId"] ?? ""), evidence]),
    );
    const featureEvidence = inventory.features.map(
      (feature) =>
        existingEvidence.get(feature.id) ??
        createLegacyFeatureEvidence({
          source: legacySource,
          feature,
          timestamp,
        }),
    );
    const evidenceToAdd = featureEvidence.filter(
      (evidence) => !run.evidence.some((existing) => existing.id === evidence.id),
    );
    const artifact = await this.writeJsonArtifact({
      label: "legacy-feature-inventory.json",
      kind: "legacy-feature-inventory",
      value: inventory,
      timestamp,
      evidenceIds: featureEvidence.map((evidence) => evidence.id),
      metadata: {
        reportKind: "legacy-feature-inventory-json",
        legacyRoot: inventory.legacyRoot,
        featureCount: inventory.featureCount,
        scannedFileCount: inventory.scannedFileCount,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      sources: shouldAddSource ? [...run.sources, legacySource] : run.sources,
      evidence: [...run.evidence, ...evidenceToAdd],
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateLegacyFeatureInventoryResultSchema.parse({
      run: summarizeRun(nextRun),
      inventoryArtifactId: artifact.id,
      featureCount: inventory.featureCount,
      scannedFileCount: inventory.scannedFileCount,
    });
  }

  public async buildCoverageMatrix(rawInput: unknown) {
    const input = BuildFeatureCoverageMatrixInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const inventoryArtifact = findInventoryArtifact(run.artifacts, input.inventoryArtifactId);
    const inventory = LegacyFeatureInventorySchema.parse(
      JSON.parse((await this.artifactStore.readContent(inventoryArtifact.digest)).toString("utf8")),
    );
    const evidenceIdByFeatureId = new Map(
      run.evidence
        .filter((evidence) => evidence.metadata["adapter"] === LEGACY_COVERAGE_ADAPTER)
        .map((evidence) => [String(evidence.metadata["legacyFeatureId"] ?? ""), evidence.id]),
    );
    const coverageTexts = await this.readCoverageTexts(run.artifacts);
    const checkTexts = readCheckTexts(run.agentResults);
    const existingOpenGapByFeatureId = openLegacyCoverageGapByFeatureId(run.gaps);
    const rows: z.infer<typeof FeatureCoverageRowSchema>[] = [];
    const newGaps: Gap[] = [];

    for (const feature of inventory.features) {
      const coverage = matchingCoverage(feature, coverageTexts, checkTexts);
      const matchedArtifactIds = [
        ...coverage.documentationArtifactIds,
        ...coverage.testArtifactIds,
      ];
      const covered = coverage.coverageLevel === "executed";
      const evidenceId = evidenceIdByFeatureId.get(feature.id);
      let gapId: string | undefined;

      if (!covered) {
        const existingGap = existingOpenGapByFeatureId.get(feature.id);
        gapId = existingGap?.id ?? createGapId();

        if (existingGap === undefined) {
          newGaps.push(
            createCoverageGap({
              feature,
              gapId,
              timestamp,
              coverageLevel: coverage.coverageLevel,
              severity: coverage.fidelitySeverity,
              ...(evidenceId === undefined ? {} : { evidenceId }),
            }),
          );
        }
      }

      rows.push(
        FeatureCoverageRowSchema.parse({
          featureId: feature.id,
          category: feature.category,
          label: feature.label,
          file: feature.file,
          line: feature.line,
          covered,
          matchedArtifactIds,
          documentationArtifactIds: coverage.documentationArtifactIds,
          testArtifactIds: coverage.testArtifactIds,
          checkIds: coverage.checkIds,
          coverageLevel: coverage.coverageLevel,
          fidelitySeverity: coverage.fidelitySeverity,
          ...(covered
            ? {}
            : {
                missingReason: missingReasonForCoverageLevel(coverage.coverageLevel),
                gapId,
              }),
        }),
      );
    }

    const coveredCount = rows.filter((row) => row.covered).length;
    const documentedOnlyCount = rows.filter((row) => row.coverageLevel === "documented").length;
    const matrix = FeatureCoverageMatrixSchema.parse({
      schemaVersion: "feature-coverage-matrix-v1",
      runId: run.id,
      generatedAt: timestamp,
      inventoryArtifactId: inventoryArtifact.id,
      featureCount: rows.length,
      coveredCount,
      uncoveredCount: rows.length - coveredCount,
      rows,
    });
    const matrixArtifact = await this.writeJsonArtifact({
      label: "feature-coverage-matrix.json",
      kind: "feature-coverage-matrix",
      value: matrix,
      timestamp,
      evidenceIds: inventoryArtifact.evidenceIds,
      metadata: {
        reportKind: "feature-coverage-matrix-json",
        inventoryArtifactId: inventoryArtifact.id,
        featureCount: matrix.featureCount,
        coveredCount: matrix.coveredCount,
        uncoveredCount: matrix.uncoveredCount,
        documentedOnlyCount,
        executedCount: coveredCount,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      gaps: [...run.gaps, ...newGaps],
      artifacts: [...run.artifacts, matrixArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return BuildFeatureCoverageMatrixResultSchema.parse({
      run: summarizeRun(nextRun),
      inventoryArtifactId: inventoryArtifact.id,
      matrixArtifactId: matrixArtifact.id,
      featureCount: matrix.featureCount,
      coveredCount: matrix.coveredCount,
      uncoveredCount: matrix.uncoveredCount,
      gapIds: matrix.rows.flatMap((row) => (row.gapId === undefined ? [] : [row.gapId])),
    });
  }

  private async readCoverageTexts(artifacts: ArtifactRef[]): Promise<Map<string, CoverageText>> {
    const texts = new Map<string, CoverageText>();

    for (const artifact of artifacts) {
      if (!COVERAGE_ARTIFACT_KINDS.has(artifact.kind)) {
        continue;
      }

      try {
        texts.set(artifact.id, {
          kind: artifact.kind,
          text: (await this.artifactStore.readContent(artifact.digest))
            .toString("utf8")
            .toLowerCase(),
        });
      } catch {
        const metadataText = JSON.stringify(artifact.metadata).toLowerCase();

        if (metadataText.length > 2) {
          texts.set(artifact.id, {
            kind: artifact.kind,
            text: metadataText,
          });
        }
      }
    }

    return texts;
  }

  private async writeJsonArtifact(input: {
    label: string;
    kind: ArtifactRef["kind"];
    value: unknown;
    timestamp: string;
    evidenceIds?: string[];
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const content = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`, "utf8");
    const blob = await this.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: input.kind,
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: input.evidenceIds ?? [],
      createdAt: input.timestamp,
      metadata: {
        adapter: "legacy-coverage-v1",
        label: input.label,
        ...input.metadata,
      },
    });
  }
}

function getOrCreateLegacySource(input: {
  sources: SourceRef[];
  inventory: LegacyFeatureInventory;
  timestamp: string;
}): { source: SourceRef; shouldAddSource: boolean } {
  const existing = input.sources.find(
    (source) =>
      source.kind === "repository" &&
      source.metadata["adapter"] === LEGACY_COVERAGE_ADAPTER &&
      source.metadata["legacyRoot"] === input.inventory.legacyRoot,
  );

  if (existing !== undefined) {
    return {
      source: existing,
      shouldAddSource: false,
    };
  }

  return {
    source: SourceRefSchema.parse({
      id: createSourceId(),
      kind: "repository",
      locator: {
        type: "repository",
        root: input.inventory.legacyRoot,
      },
      digest: sha256Digest(
        JSON.stringify({
          legacyRoot: input.inventory.legacyRoot,
          scannedFileCount: input.inventory.scannedFileCount,
          featureCount: input.inventory.featureCount,
          files: [...new Set(input.inventory.features.map((feature) => feature.file))],
        }),
      ),
      capturedAt: input.timestamp,
      metadata: {
        adapter: LEGACY_COVERAGE_ADAPTER,
        legacyRoot: input.inventory.legacyRoot,
        scannedFileCount: input.inventory.scannedFileCount,
        featureCount: input.inventory.featureCount,
      },
    }),
    shouldAddSource: true,
  };
}

function createLegacyFeatureEvidence(input: {
  source: SourceRef;
  feature: LegacyFeature;
  timestamp: string;
}): EvidenceRef {
  return EvidenceRefSchema.parse({
    id: createEvidenceId(),
    sourceId: input.source.id,
    location: {
      type: "file-lines",
      path: input.feature.file,
      startLine: input.feature.line,
      endLine: input.feature.line,
    },
    summary: `Legacy ${input.feature.category}: ${input.feature.label}`,
    excerpt: input.feature.snippet,
    digest: sha256Digest(
      JSON.stringify({
        id: input.feature.id,
        category: input.feature.category,
        label: input.feature.label,
        file: input.feature.file,
        line: input.feature.line,
        snippet: input.feature.snippet,
      }),
    ),
    capturedAt: input.timestamp,
    metadata: {
      adapter: LEGACY_COVERAGE_ADAPTER,
      itemType: "requirement",
      evidenceType: "legacy-feature",
      legacyFeatureId: input.feature.id,
      legacyFeatureCategory: input.feature.category,
      keywords: input.feature.keywords,
      file: input.feature.file,
      line: input.feature.line,
    },
  });
}

function findInventoryArtifact(
  artifacts: ArtifactRef[],
  artifactId: string | undefined,
): ArtifactRef {
  const artifact =
    artifactId === undefined
      ? [...artifacts]
          .reverse()
          .find(
            (item) =>
              item.kind === "legacy-feature-inventory" &&
              item.metadata["reportKind"] === "legacy-feature-inventory-json",
          )
      : artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error("Legacy feature inventory artifact not found.");
  }

  if (
    artifact.kind !== "legacy-feature-inventory" ||
    artifact.metadata["reportKind"] !== "legacy-feature-inventory-json"
  ) {
    throw new Error(`Artifact is not a legacy feature inventory artifact: ${artifact.id}`);
  }

  return artifact;
}

function matchingCoverage(
  feature: LegacyFeature,
  coverageTexts: Map<string, CoverageText>,
  checkTexts: Map<string, CheckText>,
): {
  documentationArtifactIds: string[];
  testArtifactIds: string[];
  checkIds: string[];
  coverageLevel: "none" | "documented" | "executed";
  fidelitySeverity: "info" | "major" | "blocker";
} {
  const tokens = coverageTokens(feature);
  const documentationArtifactIds: string[] = [];
  const testArtifactIds: string[] = [];
  const checkIds: string[] = [];

  for (const [artifactId, coverage] of coverageTexts) {
    if (!tokens.some((token) => coverage.text.includes(token))) {
      continue;
    }

    if (EXECUTION_ARTIFACT_KINDS.has(coverage.kind)) {
      testArtifactIds.push(ArtifactIdSchema.parse(artifactId));
    } else {
      documentationArtifactIds.push(ArtifactIdSchema.parse(artifactId));
    }
  }

  for (const [checkId, check] of checkTexts) {
    if (tokens.some((token) => check.text.includes(token))) {
      checkIds.push(CheckIdSchema.parse(checkId));
    }
  }

  const coverageLevel =
    testArtifactIds.length > 0 || checkIds.length > 0
      ? "executed"
      : documentationArtifactIds.length > 0
        ? "documented"
        : "none";
  const fidelitySeverity =
    coverageLevel === "executed" ? "info" : coverageLevel === "documented" ? "major" : "blocker";

  return {
    documentationArtifactIds,
    testArtifactIds,
    checkIds,
    coverageLevel,
    fidelitySeverity,
  };
}

function coverageTokens(feature: LegacyFeature): string[] {
  return [
    feature.category,
    feature.label,
    ...feature.keywords,
    ...(feature.snippet.match(/[A-Za-z][A-Za-z0-9_/#.-]{2,}/g) ?? []),
  ]
    .map((token) => token.toLowerCase().trim())
    .filter((token, index, tokens) => token.length >= 3 && tokens.indexOf(token) === index);
}

function createCoverageGap(input: {
  feature: z.infer<typeof LegacyFeatureSchema>;
  gapId: string;
  timestamp: string;
  coverageLevel: "none" | "documented" | "executed";
  severity: "major" | "blocker" | "info";
  evidenceId?: string;
}): Gap {
  return GapSchema.parse({
    id: input.gapId,
    category: "legacy-coverage",
    severity: input.severity === "info" ? "major" : input.severity,
    status: "open",
    title: compactTitle(coverageGapTitle(input.feature.label, input.coverageLevel)),
    expected:
      "Every legacy behavior feature should map to OpenSpec, Gherkin, test matrix, and executable test evidence, or carry an explicit waiver.",
    observed: coverageGapObserved(input.feature, input.coverageLevel),
    impact:
      input.coverageLevel === "documented"
        ? "Migration behavior is specified but has not been proven by an executable test artifact."
        : "Migration may ship with legacy branch behavior omitted even when screenshots look similar.",
    sourceEvidenceIds: input.evidenceId === undefined ? [] : [input.evidenceId],
    owner: "functional-reviewer",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    metadata: {
      featureId: input.feature.id,
      category: input.feature.category,
      file: input.feature.file,
      line: input.feature.line,
      snippet: input.feature.snippet,
      coverageLevel: input.coverageLevel,
      source: "legacy-feature-coverage",
    },
  });
}

function openLegacyCoverageGapByFeatureId(gaps: Gap[]): Map<string, Gap> {
  const byFeatureId = new Map<string, Gap>();

  for (const gap of gaps) {
    if (
      gap.category !== "legacy-coverage" ||
      gap.status !== "open" ||
      gap.metadata["source"] !== "legacy-feature-coverage" ||
      typeof gap.metadata["featureId"] !== "string" ||
      byFeatureId.has(gap.metadata["featureId"])
    ) {
      continue;
    }

    byFeatureId.set(gap.metadata["featureId"], gap);
  }

  return byFeatureId;
}

function readCheckTexts(
  agentResults: Array<{
    checks: Array<{
      id: string;
      kind: string;
      status: string;
      name: string;
      summary: string;
      command?: string | undefined;
    }>;
  }>,
): Map<string, CheckText> {
  const texts = new Map<string, CheckText>();

  for (const result of agentResults) {
    for (const check of result.checks) {
      if (check.status !== "passed" || !EXECUTION_CHECK_KINDS.has(check.kind)) {
        continue;
      }

      texts.set(check.id, {
        kind: check.kind,
        text: [check.name, check.kind, check.summary, check.command ?? ""].join("\n").toLowerCase(),
      });
    }
  }

  return texts;
}

function missingReasonForCoverageLevel(coverageLevel: "none" | "documented" | "executed"): string {
  if (coverageLevel === "documented") {
    return "Legacy feature appears in specification artifacts but was not matched by executable test evidence.";
  }

  return "Legacy feature was not found in OpenSpec, Gherkin, test matrix, source-code, or executable test evidence artifacts.";
}

function coverageGapTitle(
  label: string,
  coverageLevel: "none" | "documented" | "executed",
): string {
  if (coverageLevel === "documented") {
    return `Legacy feature missing executable test evidence: ${label}`;
  }

  return `Legacy feature missing from OpenSpec coverage: ${label}`;
}

function coverageGapObserved(
  feature: z.infer<typeof LegacyFeatureSchema>,
  coverageLevel: "none" | "documented" | "executed",
): string {
  if (coverageLevel === "documented") {
    return `${feature.category} feature ${feature.id} at ${feature.file}:${feature.line} was documented but not matched by executable test-report or CheckResult evidence.`;
  }

  return `${feature.category} feature ${feature.id} at ${feature.file}:${feature.line} was not matched by coverage artifacts.`;
}

function compactTitle(title: string): string {
  return title.length <= 200 ? title : `${title.slice(0, 197).trimEnd()}...`;
}
