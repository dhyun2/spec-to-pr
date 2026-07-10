import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  AccessibilityGateDecisionSchema,
  AccessibilityReportSchema,
  AccessibilityReviewRecordSchema,
  ManualAccessibilityReviewItemSchema,
  normalizeAccessibilityTargets,
  normalizeAxeResult,
  createKeyboardCheck,
  createFocusCheck,
  mapAccessibilityChecksToGaps,
  renderAccessibilityReportMarkdown,
} from "../accessibility/index.js";
import type {
  AccessibilityGateDecision,
  AutomatedAccessibilityCheck,
  ManualAccessibilityReviewItem,
} from "../accessibility/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

export const PlanAccessibilityGateInputSchema = z
  .object({
    runId: RunIdSchema,
    targets: z.array(z.unknown()).default([]),
  })
  .strict();

export const PlanAccessibilityGateResultSchema = z
  .object({
    runId: RunIdSchema,
    targetCount: z.number().int().nonnegative(),
    targets: z.array(z.unknown()),
    recommendedChecks: z.array(z.string().trim().min(1)),
  })
  .strict();

export const RunAccessibilityGateInputSchema = z
  .object({
    runId: RunIdSchema,
    targets: z.array(z.unknown()).default([]),
    rawAxeResults: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const RunAccessibilityGateResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    markdownArtifactId: ArtifactIdSchema,
    decision: AccessibilityGateDecisionSchema,
    targetCount: z.number().int().nonnegative(),
    automatedViolationCount: z.number().int().nonnegative(),
    gapsAdded: z.number().int().nonnegative(),
    manualReviewRequiredCount: z.number().int().nonnegative(),
  })
  .strict();

export const GetAccessibilityReportInputSchema = z
  .object({
    runId: RunIdSchema,
    artifactId: ArtifactIdSchema,
  })
  .strict();

export const GetAccessibilityReportResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    report: AccessibilityReportSchema,
  })
  .strict();

export const RecordAccessibilityReviewInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema,
    reviewer: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    falsePositiveNotes: z.array(z.string()).default([]),
    manualReviewNotes: z.array(z.string()).default([]),
  })
  .strict();

export const RecordAccessibilityReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
  })
  .strict();

const ACCESSIBILITY_GATE_ADAPTER = "accessibility-gate-v1" as const;

export class AccessibilityGateService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async plan(rawInput: unknown) {
    const input = PlanAccessibilityGateInputSchema.parse(rawInput);
    const targets = normalizeAccessibilityTargets(input.targets);

    return PlanAccessibilityGateResultSchema.parse({
      runId: input.runId,
      targetCount: targets.length,
      targets,
      recommendedChecks: [
        "axe-core",
        "keyboard-smoke",
        "focus-management",
        "manual-screen-reader-review",
      ],
    });
  }

  public async run(rawInput: unknown) {
    const input = RunAccessibilityGateInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const targets = normalizeAccessibilityTargets(input.targets);
    const automatedChecks = targets.map((target) =>
      normalizeAxeResult({
        targetId: target.id,
        rawResult: input.rawAxeResults[target.id] ?? { violations: [] },
      }),
    );
    const keyboardChecks = targets.map((target) =>
      createKeyboardCheck({
        targetId: target.id,
        status: "not-run",
        reason:
          "Keyboard smoke execution is not wired in this task. Manual or runner integration required.",
      }),
    );
    const focusChecks = targets.map((target) =>
      createFocusCheck({
        targetId: target.id,
        status: "not-run",
        reason:
          "Focus management execution is not wired in this task. Manual or runner integration required.",
      }),
    );
    const manualReviewItems = targets.map((target) =>
      ManualAccessibilityReviewItemSchema.parse({
        id: `manual-screen-reader-${target.id}`,
        targetId: target.id,
        topic: "screen-reader-flow",
        status: "required",
        reason: "Automated checks cannot prove full screen reader task flow.",
      }),
    );
    const gaps = mapAccessibilityChecksToGaps({
      checks: automatedChecks,
      createdAt: timestamp,
    });
    const decision = decide({
      automatedChecks,
      manualReviewItems,
    });
    const reportWithoutArtifacts = AccessibilityReportSchema.parse({
      adapter: ACCESSIBILITY_GATE_ADAPTER,
      runId: run.id,
      generatedAt: timestamp,
      targets,
      automatedChecks,
      keyboardChecks,
      focusChecks,
      manualReviewItems,
      gapIds: gaps.map((gap) => gap.id),
      artifactIds: [],
      decision,
      summary: summaryForDecision(decision, automatedChecks, manualReviewItems),
    });
    const reportJsonArtifact = await this.writeArtifact({
      label: "accessibility-report",
      mediaType: "application/json",
      content: `${JSON.stringify(
        AccessibilityReportSchema.parse({
          ...reportWithoutArtifacts,
          artifactIds: [],
        }),
        null,
        2,
      )}\n`,
      createdAt: timestamp,
      metadata: {
        adapter: ACCESSIBILITY_GATE_ADAPTER,
        reportKind: "accessibility-report-json",
        targetCount: targets.length,
        decision,
      },
    });
    const report = AccessibilityReportSchema.parse({
      ...reportWithoutArtifacts,
      artifactIds: [reportJsonArtifact.id],
    });
    const finalReportJsonArtifact = await this.writeArtifact({
      label: "accessibility-report-final",
      mediaType: "application/json",
      content: `${JSON.stringify(report, null, 2)}\n`,
      createdAt: timestamp,
      artifactId: reportJsonArtifact.id,
      metadata: reportJsonArtifact.metadata,
    });
    const reportMarkdownArtifact = await this.writeArtifact({
      label: "accessibility-report-markdown",
      mediaType: "text/markdown",
      content: renderAccessibilityReportMarkdown(report),
      createdAt: timestamp,
      metadata: {
        adapter: ACCESSIBILITY_GATE_ADAPTER,
        reportKind: "accessibility-report-markdown",
        jsonReportArtifactId: finalReportJsonArtifact.id,
        decision,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      gaps: [...run.gaps, ...gaps],
      artifacts: [...run.artifacts, finalReportJsonArtifact, reportMarkdownArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RunAccessibilityGateResultSchema.parse({
      run: summarizeRun(nextRun),
      artifactId: finalReportJsonArtifact.id,
      markdownArtifactId: reportMarkdownArtifact.id,
      decision,
      targetCount: targets.length,
      automatedViolationCount: automatedChecks.reduce(
        (count, check) => count + check.violationCount,
        0,
      ),
      gapsAdded: gaps.length,
      manualReviewRequiredCount: manualReviewItems.filter((item) => item.status === "required")
        .length,
    });
  }

  public async getReport(rawInput: unknown) {
    const input = GetAccessibilityReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const artifact = run.artifacts.find((item) => item.id === input.artifactId);

    if (artifact === undefined) {
      throw new Error(`Accessibility report artifact not found: ${input.artifactId}`);
    }

    const content = await this.artifactStore.readContent(artifact.digest);

    return GetAccessibilityReportResultSchema.parse({
      run: summarizeRun(run),
      artifactId: artifact.id,
      report: AccessibilityReportSchema.parse(JSON.parse(content.toString("utf8"))),
    });
  }

  public async recordReview(rawInput: unknown) {
    const input = RecordAccessibilityReviewInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const review = AccessibilityReviewRecordSchema.parse({
      ...input,
      recordedAt: timestamp,
    });
    const artifact = await this.writeArtifact({
      label: "accessibility-review",
      mediaType: "application/json",
      content: `${JSON.stringify(review, null, 2)}\n`,
      createdAt: timestamp,
      metadata: {
        adapter: "accessibility-review-v1",
        reportKind: "accessibility-review",
        reportArtifactId: input.reportArtifactId,
        reviewer: input.reviewer,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordAccessibilityReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      artifactId: artifact.id,
    });
  }

  private async writeArtifact(input: {
    label: string;
    mediaType: string;
    content: string;
    createdAt: string;
    artifactId?: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: input.mediaType,
      storedAt: input.createdAt,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: input.artifactId ?? createArtifactId(),
      kind: "accessibility-report",
      uri: blob.uri,
      mediaType: input.mediaType,
      digest: blob.digest,
      producedBy: "evidence-verifier",
      evidenceIds: [],
      createdAt: input.createdAt,
      metadata: input.metadata,
    });
  }
}

function decide(input: {
  automatedChecks: AutomatedAccessibilityCheck[];
  manualReviewItems: ManualAccessibilityReviewItem[];
}): AccessibilityGateDecision {
  const hasCritical = input.automatedChecks.some((check) => check.criticalCount > 0);
  const hasSerious = input.automatedChecks.some((check) => check.seriousCount > 0);
  const manualRequired = input.manualReviewItems.some((item) => item.status === "required");

  if (hasCritical) {
    return "blocked";
  }

  if (hasSerious) {
    return "failed";
  }

  if (manualRequired) {
    return "review-needed";
  }

  return "passed";
}

function summaryForDecision(
  decision: AccessibilityGateDecision,
  automatedChecks: AutomatedAccessibilityCheck[],
  manualReviewItems: ManualAccessibilityReviewItem[],
): string {
  const violationCount = automatedChecks.reduce((count, check) => count + check.violationCount, 0);
  const manualRequired = manualReviewItems.filter((item) => item.status === "required").length;

  return `Accessibility gate decision: ${decision}. Automated violations: ${violationCount}. Manual review required: ${manualRequired}.`;
}
