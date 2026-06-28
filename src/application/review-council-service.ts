import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { ReviewCouncilResultSchema } from "../review/review-model.js";
import type { ReviewCouncilResult } from "../review/review-model.js";
import { renderReviewCouncilReport } from "../review/review-renderer.js";
import { runReviewPrechecks } from "../review/review-precheck.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { GapSchema } from "../runtime/gap.js";
import { createAgentResultId, createArtifactId, createGapId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const PrepareReviewCouncilInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export const GetReviewCouncilContextInputSchema = z
  .object({
    runId: RunIdSchema,
    contextArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const RecordReviewCouncilResultInputSchema = z
  .object({
    runId: RunIdSchema,
    contextArtifactId: ArtifactIdSchema,
    result: ReviewCouncilResultSchema,
  })
  .strict();

export const ReviewCouncilContextPackSchema = z
  .object({
    schemaVersion: z.literal("review-council-context-v1"),
    runId: RunIdSchema,
    generatedAt: IsoDateTimeSchema,
    runSummary: z.record(z.string(), z.unknown()),
    evidenceCount: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative(),
    gapCount: z.number().int().nonnegative(),
    agentResults: z.array(z.record(z.string(), z.unknown())),
    precheckFindings: z.array(z.record(z.string(), z.unknown())),
    instructions: z.string(),
  })
  .strict();

export const PrepareReviewCouncilResultSchema = z
  .object({
    run: RunSummarySchema,
    contextArtifactId: ArtifactIdSchema,
    contextPath: z.string().trim().min(1),
    instructionsPath: z.string().trim().min(1),
    precheckFindingCount: z.number().int().nonnegative(),
  })
  .strict();

export const GetReviewCouncilContextResultSchema = z
  .object({
    contextArtifactId: ArtifactIdSchema,
    contextPath: z.string().trim().min(1),
    instructionsPath: z.string().trim().min(1),
    context: ReviewCouncilContextPackSchema,
  })
  .strict();

export const RecordReviewCouncilResultSchema = z
  .object({
    run: RunSummarySchema,
    reportArtifactId: ArtifactIdSchema,
    resultArtifactId: ArtifactIdSchema,
    agentResultId: z.string().regex(/^ar_[a-f0-9]{32}$/),
    newGapCount: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    verdictCount: z.number().int().nonnegative(),
  })
  .strict();

export class ReviewCouncilService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly dataDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async prepare(rawInput: unknown) {
    const input = PrepareReviewCouncilInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const precheckFindings = runReviewPrechecks({
      run,
      generatedAt: timestamp,
    });

    const instructions = buildReviewInstructions();
    const contextPack = ReviewCouncilContextPackSchema.parse({
      schemaVersion: "review-council-context-v1",
      runId: run.id,
      generatedAt: timestamp,
      runSummary: summarizeRun(run),
      evidenceCount: run.evidence.length,
      artifactCount: run.artifacts.length,
      gapCount: run.gaps.length,
      agentResults: run.agentResults,
      precheckFindings,
      instructions,
    });

    const contextJson = `${JSON.stringify(contextPack, null, 2)}\n`;
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(contextJson, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "review-council-context",
    });

    const contextDirectory = path.join(
      this.dataDirectory,
      "agent-contexts",
      "review-council",
      run.id,
    );
    const contextPath = path.join(contextDirectory, "review-council-context.json");
    const instructionsPath = path.join(contextDirectory, "review-instructions.md");

    await mkdir(contextDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(contextPath, contextJson, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(instructionsPath, instructions, {
      encoding: "utf8",
      mode: 0o600,
    });

    const contextArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "log",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "review-council-v1",
        artifactRole: "context-pack",
        contextPath,
        instructionsPath,
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, contextArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return PrepareReviewCouncilResultSchema.parse({
      run: summarizeRun(nextRun),
      contextArtifactId: contextArtifact.id,
      contextPath,
      instructionsPath,
      precheckFindingCount: precheckFindings.length,
    });
  }

  public async getContext(rawInput: unknown) {
    const input = GetReviewCouncilContextInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const contextArtifact = findContextArtifact(run, input.contextArtifactId);
    const contextPath = contextArtifact.metadata["contextPath"];
    const instructionsPath = contextArtifact.metadata["instructionsPath"];

    if (typeof contextPath !== "string") {
      throw new Error("Review Council context artifact is missing contextPath metadata");
    }

    if (typeof instructionsPath !== "string") {
      throw new Error("Review Council context artifact is missing instructionsPath metadata");
    }

    const context = ReviewCouncilContextPackSchema.parse(
      JSON.parse(await readFile(contextPath, "utf8")),
    );

    return GetReviewCouncilContextResultSchema.parse({
      contextArtifactId: contextArtifact.id,
      contextPath,
      instructionsPath,
      context,
    });
  }

  public async record(rawInput: unknown) {
    const input = RecordReviewCouncilResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const contextArtifact = findContextArtifact(run, input.contextArtifactId);
    const result = ReviewCouncilResultSchema.parse(input.result);

    if (result.runId !== run.id) {
      throw new Error("Review council result runId does not match Run");
    }

    const reportMd = renderReviewCouncilReport(result);
    const reportBlob = await this.artifactStore.writeBlob({
      content: Buffer.from(reportMd, "utf8"),
      mediaType: "text/markdown",
      storedAt: timestamp,
      label: "review-council-report",
    });
    const resultBlob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "review-council-result",
    });

    const reportArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "log",
      uri: reportBlob.uri,
      mediaType: "text/markdown",
      digest: reportBlob.digest,
      producedBy: "review-council",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "review-council-v1",
        artifactRole: "report",
        contextArtifactId: contextArtifact.id,
      },
    });
    const resultArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "log",
      uri: resultBlob.uri,
      mediaType: "application/json",
      digest: resultBlob.digest,
      producedBy: "review-council",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "review-council-v1",
        artifactRole: "structured-result",
        contextArtifactId: contextArtifact.id,
      },
    });
    const newGaps = result.newGapDrafts.map((draft) =>
      GapSchema.parse({
        id: createGapId(),
        category: draft.category,
        severity: draft.severity,
        status: "open",
        title: draft.title,
        expected: draft.expected,
        observed: draft.observed,
        impact: draft.impact,
        sourceEvidenceIds: draft.sourceEvidenceIds,
        owner: draft.owner,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
          reviewFindingId: draft.findingId,
          source: "review-council",
        },
      }),
    );
    const blockerFinding = result.findings.some((finding) => finding.severity === "blocker");
    const referencedGapIds = Array.from(
      new Set([
        ...newGaps.map((gap) => gap.id),
        ...result.findings.flatMap((finding) => finding.gapIds),
      ]),
    );
    const verificationStatus =
      blockerFinding && referencedGapIds.length > 0
        ? "blocked"
        : blockerFinding
          ? "failed"
          : "passed";
    const agentResult = AgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: createAgentResultId(),
      runId: run.id,
      kind: "verification",
      agent: "review-council",
      status: verificationStatus,
      baseSha: run.baseCommit ?? "0000000",
      changedFiles: [],
      evidenceIds: [],
      artifactIds: [reportArtifact.id, resultArtifact.id],
      gapIds: referencedGapIds,
      checks: [],
      decisions: [],
      startedAt: result.generatedAt,
      completedAt: timestamp,
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      gaps: [...run.gaps, ...newGaps],
      artifacts: [...run.artifacts, reportArtifact, resultArtifact],
      agentResults: [...run.agentResults, agentResult],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordReviewCouncilResultSchema.parse({
      run: summarizeRun(nextRun),
      reportArtifactId: reportArtifact.id,
      resultArtifactId: resultArtifact.id,
      agentResultId: agentResult.id,
      newGapCount: newGaps.length,
      findingCount: result.findings.length,
      verdictCount: result.requirementVerdicts.length,
    });
  }
}

function findContextArtifact(
  run: Awaited<ReturnType<RunStore["get"]>>,
  contextArtifactId: string | undefined,
) {
  const candidates = run.artifacts.filter(
    (artifact) =>
      artifact.metadata["adapter"] === "review-council-v1" &&
      artifact.metadata["artifactRole"] === "context-pack",
  );
  const artifact =
    contextArtifactId === undefined
      ? candidates.at(-1)
      : candidates.find((item) => item.id === contextArtifactId);

  if (artifact === undefined) {
    throw new Error(
      contextArtifactId === undefined
        ? "Review Council context artifact not found"
        : `Review Council context artifact not found: ${contextArtifactId}`,
    );
  }

  return artifact;
}

function buildReviewInstructions(): string {
  return `# Review Council Instructions

You are the review-council verification agent.

## Mission

Cross-review Spec/BDD, API Contract, and Design/UI agent outputs.

## Rules

- Do not edit product code.
- Do not invent missing evidence.
- Convert missing evidence into findings or gap drafts.
- Reject completion claims that cite unresolved blocker gaps.
- API implementation claims must cite OpenAPI evidence.
- UI implementation claims must cite Figma or design contract evidence.
- Requirement verdicts must be accepted, partial, blocked, rejected, or unverified.
- Return only structured ReviewCouncilResult JSON.

## Required output

A JSON object matching ReviewCouncilResultSchema.
`;
}
