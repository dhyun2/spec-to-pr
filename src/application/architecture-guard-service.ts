import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { analyzeArchitecture } from "../architecture/architecture-analyzer.js";
import { ArchitectureReportSchema } from "../architecture/architecture-report.js";
import { writeSourceGuardTest } from "../architecture/source-guard-writer.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { GapSchema } from "../runtime/gap.js";
import { createArtifactId, createGapId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const AnalyzeArchitectureBoundariesInputSchema = z
  .object({
    runId: RunIdSchema,
    sourceRoots: z.array(z.string().trim().min(1)).optional(),
    aliases: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const GenerateSourceGuardTestsInputSchema = z
  .object({
    runId: RunIdSchema,
    force: z.boolean().default(false),
  })
  .strict();

export const ArchitectureGuardResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    violationCount: z.number().int().nonnegative(),
    blockerCount: z.number().int().nonnegative(),
    majorCount: z.number().int().nonnegative(),
    gapIds: z.array(GapIdSchema),
  })
  .strict();

export const GenerateSourceGuardTestsResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    relativePath: z.string().trim().min(1),
    changed: z.boolean(),
  })
  .strict();

export class ArchitectureGuardService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async analyze(rawInput: unknown) {
    const input = AnalyzeArchitectureBoundariesInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const report = await analyzeArchitecture({
      projectRoot: run.projectRoot,
      analyzedAt: timestamp,
      ...(input.sourceRoots === undefined ? {} : { sourceRoots: input.sourceRoots }),
      ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
    });
    const parsedReport = ArchitectureReportSchema.parse(report);
    const reportBlob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(parsedReport, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "architecture-report",
    });
    const reportArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "test-report",
      uri: reportBlob.uri,
      mediaType: "application/json",
      digest: reportBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "architecture-guard-v1",
        reportKind: "architecture-report",
        violationCount: parsedReport.violationCount,
        blockerCount: parsedReport.blockerCount,
        majorCount: parsedReport.majorCount,
      },
    });
    const gaps = parsedReport.violations
      .filter((violation) => violation.severity === "blocker" || violation.severity === "major")
      .map((violation) =>
        GapSchema.parse({
          id: createGapId(),
          category: "architecture",
          severity: violation.severity,
          status: "open",
          title: violation.message,
          expected: "Integrated code should respect FSD and API boundary rules.",
          observed: `${violation.file}${violation.line === undefined ? "" : `:${violation.line}`} - ${violation.message}`,
          impact:
            "Architecture violation can make generated code difficult to maintain and unsafe to extend.",
          sourceEvidenceIds: [],
          owner: "integrator",
          createdAt: timestamp,
          updatedAt: timestamp,
          metadata: {
            violationId: violation.id,
            violationKind: violation.kind,
            recommendation: violation.recommendation,
          },
        }),
      );
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, reportArtifact],
      gaps: [...run.gaps, ...gaps],
    });

    await this.runStore.save(nextRun, run.revision);

    return ArchitectureGuardResultSchema.parse({
      run: summarizeRun(nextRun),
      artifactId: reportArtifact.id,
      violationCount: parsedReport.violationCount,
      blockerCount: parsedReport.blockerCount,
      majorCount: parsedReport.majorCount,
      gapIds: gaps.map((gap) => gap.id),
    });
  }

  public async generateSourceGuardTests(rawInput: unknown) {
    const input = GenerateSourceGuardTestsInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const result = await writeSourceGuardTest({
      projectRoot: run.projectRoot,
      generatedAt: timestamp,
      force: input.force,
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, result.artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateSourceGuardTestsResultSchema.parse({
      run: summarizeRun(nextRun),
      artifactId: result.artifact.id,
      relativePath: result.relativePath,
      changed: result.changed,
    });
  }
}
