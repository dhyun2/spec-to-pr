import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { isVisualComparisonArtifact } from "../pr-report/visual-evidence.js";
import {
  DEFAULT_REVIEW_SCORE_THRESHOLD,
  REVIEW_SCORECARD_REPORT_KIND,
  ReviewScorecardDimensionSchema,
  ReviewScorecardSchema,
  type ReviewScorecardDimension,
} from "../review-scorecard/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef, CheckResult, SourceRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

export const GenerateReviewScorecardInputSchema = z
  .object({
    runId: RunIdSchema,
    minimumScore: z.number().min(0).max(10).default(DEFAULT_REVIEW_SCORE_THRESHOLD),
    attempt: z.number().int().positive().default(1),
    maxAttempts: z.number().int().positive().default(3),
  })
  .strict();

export const GenerateReviewScorecardResultSchema = z
  .object({
    run: RunSummarySchema,
    scorecardArtifactId: ArtifactIdSchema,
    decision: z.object({
      status: z.enum(["passed", "retry", "blocked"]),
      score: z.number().min(0).max(10),
      minimumScore: z.number().min(0).max(10),
      nextRepairTarget: z.string().optional(),
      attempt: z.number().int().positive(),
      maxAttempts: z.number().int().positive(),
    }),
    dimensions: z.array(ReviewScorecardDimensionSchema),
    blockerCount: z.number().int().nonnegative(),
  })
  .strict();

export class ReviewScorecardService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generate(rawInput: unknown) {
    const parsedInput = GenerateReviewScorecardInputSchema.parse(rawInput);
    const input = {
      ...parsedInput,
      minimumScore: normalizeMinimumScore(parsedInput.minimumScore),
    };
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const dimensions = buildScorecardDimensions({
      artifacts: run.artifacts,
      checks: run.agentResults.flatMap((result) => result.checks),
      sources: run.sources,
      minimumScore: input.minimumScore,
    });
    const lowest = Math.min(...dimensions.map((dimension) => dimension.score));
    const failingDimensions = dimensions.filter(
      (dimension) => dimension.status === "fail" || dimension.score < dimension.threshold,
    );
    const nextRepairTarget = failingDimensions
      .sort((left, right) => left.score - right.score)
      .at(0)?.id;
    const decisionStatus =
      failingDimensions.length === 0
        ? "passed"
        : input.attempt >= input.maxAttempts
          ? "blocked"
          : "retry";
    const dimensionsWithRepairTarget = dimensions.map((dimension) =>
      ReviewScorecardDimensionSchema.parse({
        ...dimension,
        nextRepairTarget: dimension.id === nextRepairTarget,
      }),
    );
    const scorecard = ReviewScorecardSchema.parse({
      adapter: "review-scorecard-v1",
      generatedAt: timestamp,
      minimumScore: input.minimumScore,
      lowestScore: lowest,
      decision: decisionStatus,
      ...(nextRepairTarget === undefined ? {} : { nextRepairTarget }),
      dimensions: dimensionsWithRepairTarget,
      summary:
        decisionStatus === "passed"
          ? `Review scorecard passed at ${lowest.toFixed(2)} / 10.`
          : `Review scorecard ${decisionStatus}; repair ${nextRepairTarget ?? "lowest score"} next.`,
    });
    const artifact = await this.writeScorecardArtifact({
      scorecard,
      timestamp,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateReviewScorecardResultSchema.parse({
      run: summarizeRun(nextRun),
      scorecardArtifactId: artifact.id,
      decision: {
        status: decisionStatus,
        score: lowest,
        minimumScore: input.minimumScore,
        ...(nextRepairTarget === undefined ? {} : { nextRepairTarget }),
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
      },
      dimensions: scorecard.dimensions,
      blockerCount: failingDimensions.length,
    });
  }

  private async writeScorecardArtifact(input: {
    scorecard: z.infer<typeof ReviewScorecardSchema>;
    timestamp: string;
    attempt: number;
    maxAttempts: number;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(input.scorecard, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: "review-scorecard/report.json",
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "review-scorecard",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "functional-reviewer",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        reportKind: REVIEW_SCORECARD_REPORT_KIND,
        minimumScore: input.scorecard.minimumScore,
        lowestScore: input.scorecard.lowestScore,
        decision: input.scorecard.decision,
        nextRepairTarget: input.scorecard.nextRepairTarget,
        dimensions: input.scorecard.dimensions,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
      },
    });
  }
}

function buildScorecardDimensions(input: {
  artifacts: ArtifactRef[];
  checks: CheckResult[];
  sources: SourceRef[];
  minimumScore: number;
}): ReviewScorecardDimension[] {
  const checks = selectLatestChecksByKind(input.checks);

  return [
    scoreBriefFidelity(input.artifacts, input.minimumScore),
    scoreLegacyCoverage(input.artifacts, input.minimumScore),
    scoreGherkinCompleteness(input.artifacts, input.minimumScore),
    scoreTddEvidence(input.artifacts, checks, input.minimumScore),
    scoreDesignSystemUsage(input.artifacts, input.sources, input.minimumScore),
    scoreVisualParity(input.artifacts, input.sources, input.minimumScore),
    scoreResourceContract(input.artifacts, input.minimumScore),
    scoreApiContract(input.artifacts, input.sources, input.minimumScore),
    scorePublishSync(input.artifacts, input.minimumScore),
  ];
}

function scoreBriefFidelity(artifacts: ArtifactRef[], threshold: number): ReviewScorecardDimension {
  const traceability = artifacts.filter((artifact) => artifact.kind === "traceability-matrix");
  const rowCount = traceability.reduce(
    (maximum, artifact) => Math.max(maximum, metadataNumber(artifact.metadata["rowCount"], 0)),
    0,
  );
  const openspec = artifactIds(artifacts, ["openspec"]);

  if (rowCount > 0) {
    return dimension({
      id: "brief-fidelity",
      label: "Brief fidelity",
      score: 10,
      threshold,
      notes: `${rowCount} traceability row(s) link request evidence to implementation scope.`,
      evidence: traceability.map((artifact) => artifact.id),
    });
  }

  return dimension({
    id: "brief-fidelity",
    label: "Brief fidelity",
    score: openspec.length > 0 ? 8 : 0,
    threshold,
    notes:
      openspec.length > 0
        ? "OpenSpec exists, but traceability rows are missing."
        : "No OpenSpec or traceability evidence was recorded.",
    evidence: openspec,
  });
}

function scoreLegacyCoverage(
  artifacts: ArtifactRef[],
  threshold: number,
): ReviewScorecardDimension {
  const inventory = latestLegacyInventory(artifacts);

  if (inventory === undefined) {
    return notApplicableDimension(
      "legacy-coverage",
      "Legacy coverage",
      threshold,
      "No legacy migration inventory was recorded for this run.",
    );
  }

  const matrix = latestFeatureCoverageMatrix(artifacts, inventory.id);

  if (matrix === undefined) {
    const staleMatrices = featureCoverageMatricesForOtherInventories(artifacts, inventory.id);
    const staleSummary = staleMatrices
      .map((artifact) => {
        const linkedInventory = artifact.metadata["inventoryArtifactId"];

        return `${artifact.id} -> ${typeof linkedInventory === "string" ? linkedInventory : "unknown inventory"}`;
      })
      .join(", ");

    return dimension({
      id: "legacy-coverage",
      label: "Legacy coverage",
      score: 0,
      threshold,
      notes:
        staleMatrices.length > 0
          ? `Latest legacy inventory ${inventory.id} has no matching feature coverage matrix; stale feature coverage matrix artifact(s) exist for other inventories: ${staleSummary}.`
          : "Legacy inventory exists, but no matching feature coverage matrix was recorded.",
      evidence: [inventory.id, ...staleMatrices.map((artifact) => artifact.id)],
    });
  }

  const uncoveredCount = metadataNumber(matrix.metadata["uncoveredCount"], 0);
  const documentedOnlyCount = metadataNumber(matrix.metadata["documentedOnlyCount"], 0);

  return dimension({
    id: "legacy-coverage",
    label: "Legacy coverage",
    score: uncoveredCount + documentedOnlyCount === 0 ? 10 : 5,
    threshold,
    notes:
      uncoveredCount + documentedOnlyCount === 0
        ? "Every legacy feature has executed coverage or an explicit waiver."
        : `${uncoveredCount} uncovered and ${documentedOnlyCount} documented-only legacy feature(s) remain.`,
    evidence: [inventory.id, matrix.id],
  });
}

function scoreGherkinCompleteness(
  artifacts: ArtifactRef[],
  threshold: number,
): ReviewScorecardDimension {
  const gherkin = artifactIds(artifacts, ["gherkin"]);
  const testMatrix = artifactIds(artifacts, ["test-matrix"]);
  const score =
    gherkin.length > 0 && testMatrix.length > 0
      ? 10
      : gherkin.length + testMatrix.length > 0
        ? 6
        : 0;

  return dimension({
    id: "gherkin-completeness",
    label: "Gherkin completeness",
    score,
    threshold,
    notes:
      score === 10
        ? "Gherkin feature files and test matrix were recorded."
        : "OpenSpec requirements are not fully represented by both Gherkin and test matrix artifacts.",
    evidence: [...gherkin, ...testMatrix],
  });
}

function scoreTddEvidence(
  artifacts: ArtifactRef[],
  checks: CheckResult[],
  threshold: number,
): ReviewScorecardDimension {
  const functionalChecks = checks.filter((check) =>
    ["unit", "component", "contract", "acceptance", "e2e"].includes(check.kind),
  );
  const passedFunctional = functionalChecks.some((check) => check.status === "passed");
  const testArtifacts = artifactIds(artifacts, ["test-report", "coverage-report"]);
  const score = passedFunctional && testArtifacts.length > 0 ? 10 : passedFunctional ? 6 : 0;

  return dimension({
    id: "tdd-evidence",
    label: "TDD evidence",
    score,
    threshold,
    notes:
      score === 10
        ? "Executed functional checks and test-report artifacts are recorded."
        : "Functional claims need executable test-report evidence tied to scenarios or checks.",
    evidence: [...functionalChecks.map((check) => check.id), ...testArtifacts],
  });
}

function scoreDesignSystemUsage(
  artifacts: ArtifactRef[],
  sources: SourceRef[],
  threshold: number,
): ReviewScorecardDimension {
  const figmaRequired = hasFigmaEvidence(artifacts, sources);
  const designSystemArtifacts = artifactIds(artifacts, [
    "figma-design-contract",
    "design-system-map",
    "ui-implementation-rules",
  ]);
  const inventoryArtifacts = artifactIds(artifacts, [
    "figma-design-inventory",
    "figma-provider-comparison",
  ]);

  if (!figmaRequired) {
    return notApplicableDimension(
      "design-system-usage",
      "Design-system usage",
      threshold,
      "No Figma-backed UI scope was recorded for this run.",
    );
  }

  return dimension({
    id: "design-system-usage",
    label: "Design-system usage",
    score: designSystemArtifacts.length > 0 ? 10 : inventoryArtifacts.length > 0 ? 6 : 0,
    threshold,
    notes:
      designSystemArtifacts.length > 0
        ? "Design contract or design-system map evidence was recorded."
        : "Figma evidence exists, but design-system mapping is incomplete.",
    evidence: [...designSystemArtifacts, ...inventoryArtifacts],
  });
}

function scoreVisualParity(
  artifacts: ArtifactRef[],
  sources: SourceRef[],
  threshold: number,
): ReviewScorecardDimension {
  const visualRequired =
    hasFigmaEvidence(artifacts, sources) || latestLegacyInventory(artifacts) !== undefined;
  const visualReports = artifacts.filter(isVisualComparisonArtifact);

  if (!visualRequired) {
    return notApplicableDimension(
      "visual-parity",
      "Visual parity",
      threshold,
      "No Figma or legacy visual scope was recorded for this run.",
    );
  }

  const failingReport = visualReports.find((artifact) =>
    ["failed", "blocked", "fail"].includes(String(artifact.metadata["decision"] ?? "")),
  );
  const passedReport = visualReports.find((artifact) =>
    ["passed", "pass"].includes(String(artifact.metadata["decision"] ?? "passed")),
  );

  return dimension({
    id: "visual-parity",
    label: "Visual parity",
    score: failingReport !== undefined ? 4 : passedReport !== undefined ? 10 : 0,
    threshold,
    notes:
      visualReports.length > 0
        ? "Visual comparison evidence was recorded; review thresholds, masks, fixtures, and scope."
        : "Visual scope exists, but no official visual comparison report was recorded.",
    evidence: visualReports.map((artifact) => artifact.id),
  });
}

function scoreResourceContract(
  artifacts: ArtifactRef[],
  threshold: number,
): ReviewScorecardDimension {
  const inventory = latestLegacyInventory(artifacts);

  if (inventory === undefined) {
    return notApplicableDimension(
      "resource-contract",
      "Resource contract",
      threshold,
      "No legacy resource-binding or global-style scope was recorded for this run.",
    );
  }

  const matrix = latestFeatureCoverageMatrix(artifacts, inventory.id);
  const legacyVisual = artifacts.filter(
    (artifact) =>
      artifact.kind === "visual-report" &&
      (artifact.metadata["comparisonMode"] === "legacy-vs-target" ||
        artifact.metadata["visualBaseline"] === "legacy-screenshot"),
  );

  return dimension({
    id: "resource-contract",
    label: "Resource contract",
    score: matrix !== undefined && legacyVisual.length > 0 ? 10 : matrix !== undefined ? 6 : 0,
    threshold,
    notes:
      matrix !== undefined && legacyVisual.length > 0
        ? "Legacy resource bindings and global style effects have coverage and legacy-vs-target visual evidence."
        : "Legacy images, marker assets, root/global CSS selectors, map params, native bridge, or URL-open flows need resource contract evidence.",
    evidence: [
      inventory.id,
      ...(matrix === undefined ? [] : [matrix.id]),
      ...legacyVisual.map((artifact) => artifact.id),
    ],
  });
}

function scoreApiContract(
  artifacts: ArtifactRef[],
  sources: SourceRef[],
  threshold: number,
): ReviewScorecardDimension {
  const apiRequired =
    sources.some((source) => source.kind === "openapi") ||
    artifacts.some((artifact) => artifact.kind.startsWith("openapi-"));
  const apiEvidence = artifactIds(artifacts, [
    "openapi-intake-report",
    "api-contract-report",
    "generated-code",
  ]);
  const inventoryEvidence = artifactIds(artifacts, [
    "openapi-operation-inventory",
    "openapi-schema-inventory",
    "openapi-security-inventory",
  ]);

  if (!apiRequired) {
    return notApplicableDimension(
      "api-contract",
      "API contract",
      threshold,
      "No OpenAPI-backed API scope was recorded for this run.",
    );
  }

  return dimension({
    id: "api-contract",
    label: "API contract",
    score: apiEvidence.length > 0 ? 10 : inventoryEvidence.length > 0 ? 6 : 0,
    threshold,
    notes:
      apiEvidence.length > 0
        ? "API contract or generated API evidence was recorded."
        : "OpenAPI evidence exists, but generated API contract evidence is incomplete.",
    evidence: [...apiEvidence, ...inventoryEvidence],
  });
}

function scorePublishSync(artifacts: ArtifactRef[], threshold: number): ReviewScorecardDimension {
  const publishResult = [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "agent-result-report" &&
        artifact.metadata["reportKind"] === "publish-result",
    );

  if (publishResult === undefined) {
    return notApplicableDimension(
      "publish-sync",
      "Publish sync",
      threshold,
      "No publish attempt has been recorded yet.",
    );
  }

  const synced =
    !["failed", "blocked"].includes(String(publishResult.metadata["status"] ?? "")) &&
    publishResult.metadata["requestDraft"] !== false &&
    publishResult.metadata["requestSynced"] !== false &&
    (publishResult.metadata["visualPreviewExpected"] !== true ||
      publishResult.metadata["visualPreviewSynced"] === true) &&
    (publishResult.metadata["featureVideoExpected"] !== true ||
      publishResult.metadata["featureVideoSynced"] === true);

  return dimension({
    id: "publish-sync",
    label: "Publish sync",
    score: synced ? 10 : 0,
    threshold,
    notes: synced
      ? "Generated PR/MR body and required review evidence were synchronized."
      : "Publish result did not confirm generated body or required review evidence synchronization.",
    evidence: [publishResult.id],
  });
}

function dimension(input: {
  id: z.infer<typeof ReviewScorecardDimensionSchema>["id"];
  label: string;
  score: number;
  threshold: number;
  notes: string;
  evidence: string[];
}): ReviewScorecardDimension {
  return ReviewScorecardDimensionSchema.parse({
    ...input,
    status: input.score < input.threshold ? "fail" : input.score < 10 ? "warning" : "pass",
    nextRepairTarget: false,
  });
}

function notApplicableDimension(
  id: z.infer<typeof ReviewScorecardDimensionSchema>["id"],
  label: string,
  threshold: number,
  notes: string,
): ReviewScorecardDimension {
  return ReviewScorecardDimensionSchema.parse({
    id,
    label,
    score: 10,
    threshold,
    status: "pass",
    notes,
    evidence: [],
    nextRepairTarget: false,
  });
}

function latestLegacyInventory(artifacts: ArtifactRef[]): ArtifactRef | undefined {
  return [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "legacy-feature-inventory" &&
        artifact.metadata["reportKind"] === "legacy-feature-inventory-json",
    );
}

function latestFeatureCoverageMatrix(
  artifacts: ArtifactRef[],
  inventoryArtifactId: string,
): ArtifactRef | undefined {
  return [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "feature-coverage-matrix" &&
        artifact.metadata["reportKind"] === "feature-coverage-matrix-json" &&
        artifact.metadata["inventoryArtifactId"] === inventoryArtifactId,
    );
}

function featureCoverageMatricesForOtherInventories(
  artifacts: ArtifactRef[],
  inventoryArtifactId: string,
): ArtifactRef[] {
  return artifacts.filter(
    (artifact) =>
      artifact.kind === "feature-coverage-matrix" &&
      artifact.metadata["reportKind"] === "feature-coverage-matrix-json" &&
      artifact.metadata["inventoryArtifactId"] !== inventoryArtifactId,
  );
}

function hasFigmaEvidence(artifacts: ArtifactRef[], sources: SourceRef[]): boolean {
  return (
    sources.some((source) => source.kind === "figma") ||
    artifacts.some((artifact) =>
      [
        "figma-design-context",
        "figma-screenshot",
        "figma-design-inventory",
        "figma-design-contract",
      ].includes(artifact.kind),
    )
  );
}

function artifactIds(artifacts: ArtifactRef[], kinds: string[]): string[] {
  return artifacts
    .filter((artifact) => kinds.includes(artifact.kind))
    .map((artifact) => artifact.id);
}

function selectLatestChecksByKind(checks: CheckResult[]): CheckResult[] {
  const latest = new Map<CheckResult["kind"], CheckResult>();

  for (const check of checks) {
    latest.set(check.kind, check);
  }

  return [...latest.values()];
}

function metadataNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMinimumScore(value: number): number {
  if (value > 0 && value <= 1) {
    return Number((value * 10).toFixed(2));
  }

  return value;
}
