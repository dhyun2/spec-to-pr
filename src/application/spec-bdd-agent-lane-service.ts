import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { TestMatrixSchema } from "../gherkin/test-matrix.js";
import { OpenSpecChangeNameSchema } from "../openspec/openspec-paths.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { CheckResultSchema } from "../runtime/check.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { DecisionSchema } from "../runtime/decision.js";
import { ImplementationAgentResultSchema } from "../runtime/agent-result.js";
import { createAgentResultId, createArtifactId } from "../runtime/id-factory.js";
import { GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import { writeAcceptanceSkeletons } from "../spec-bdd/acceptance-skeleton-writer.js";
import { SpecBddFindingSchema, SpecBddReviewReportSchema } from "../spec-bdd/spec-bdd-contracts.js";
import {
  buildSpecBddContextPack,
  renderSpecBddContextPackMarkdown,
  SpecBddContextPackSchema,
} from "../spec-bdd/spec-bdd-context.js";
import { renderSpecBddReviewMarkdown } from "../spec-bdd/spec-bdd-review-renderer.js";
import type { RunStore } from "../store/run-store.js";
import { runCommand } from "../agent-runtime/command-runner.js";

export const PrepareSpecBddAgentInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
  })
  .strict();

export const GetSpecBddAgentContextInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
  })
  .strict();

export const RecordSpecBddAgentResultInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    reviewedRequirements: z.number().int().nonnegative(),
    reviewedScenarios: z.number().int().nonnegative(),
    acceptanceSkeletonCount: z.number().int().nonnegative(),
    findings: z.array(SpecBddFindingSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    checks: z.array(CheckResultSchema).default([]),
    decisions: z.array(DecisionSchema).default([]),
    commitSha: GitObjectIdSchema.optional(),
    force: z.boolean().default(false),
  })
  .strict();

export const PrepareSpecBddAgentResultSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    preparedAt: IsoDateTimeSchema,
    contextPackJsonPath: z.string().trim().min(1),
    contextPackMarkdownPath: z.string().trim().min(1),
    allowedWritePaths: z.array(z.string().trim().min(1)),
    expectedOutputs: z.array(z.string().trim().min(1)),
  })
  .strict();

export const GetSpecBddAgentContextResultSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    contextPack: SpecBddContextPackSchema,
    contextPackMarkdown: z.string(),
    contextPackJsonPath: z.string().trim().min(1),
    contextPackMarkdownPath: z.string().trim().min(1),
  })
  .strict();

export const RecordSpecBddAgentResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactIds: z.array(z.string().trim().min(1)),
    agentResultId: z.string().trim().min(1),
    reportJsonPath: z.string().trim().min(1),
    reportMarkdownPath: z.string().trim().min(1),
    acceptanceSkeletonDirectory: z.string().trim().min(1),
    acceptanceSkeletonFiles: z.array(z.string().trim().min(1)),
  })
  .strict();

export class SpecBddAgentLaneService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async prepare(rawInput: unknown) {
    const input = PrepareSpecBddAgentInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const contextPack = await buildSpecBddContextPack({
      run,
      changeName: input.changeName,
    });
    const contextPaths = specBddContextPaths(run.projectRoot, run.id, input.changeName);
    const contextJson = `${JSON.stringify(contextPack, null, 2)}\n`;
    const contextMd = renderSpecBddContextPackMarkdown(contextPack);

    assertInsideProjectRoot(run.projectRoot, contextPaths.contextDirectory);
    await mkdir(contextPaths.contextDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(contextPaths.contextJsonPath, contextJson, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(contextPaths.contextMdPath, contextMd, {
      encoding: "utf8",
      mode: 0o600,
    });

    return PrepareSpecBddAgentResultSchema.parse({
      runId: run.id,
      changeName: input.changeName,
      preparedAt: timestamp,
      contextPackJsonPath: toRepoRelative(run.projectRoot, contextPaths.contextJsonPath),
      contextPackMarkdownPath: toRepoRelative(run.projectRoot, contextPaths.contextMdPath),
      allowedWritePaths: contextPack.allowedWritePaths,
      expectedOutputs: contextPack.expectedOutputs,
    });
  }

  public async getContext(rawInput: unknown) {
    const input = GetSpecBddAgentContextInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const contextPaths = specBddContextPaths(run.projectRoot, run.id, input.changeName);
    const rawContext = await readFile(contextPaths.contextJsonPath, "utf8");
    const contextPackMarkdown = await readFile(contextPaths.contextMdPath, "utf8");

    return GetSpecBddAgentContextResultSchema.parse({
      runId: run.id,
      changeName: input.changeName,
      contextPack: SpecBddContextPackSchema.parse(JSON.parse(rawContext)),
      contextPackMarkdown,
      contextPackJsonPath: toRepoRelative(run.projectRoot, contextPaths.contextJsonPath),
      contextPackMarkdownPath: toRepoRelative(run.projectRoot, contextPaths.contextMdPath),
    });
  }

  public async recordResult(rawInput: unknown) {
    const input = RecordSpecBddAgentResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const contextPack = await buildSpecBddContextPack({
      run,
      changeName: input.changeName,
    });
    const matrix = await readTestMatrix(run.projectRoot, contextPack.gherkin.testMatrixPath);
    const skeletons = await writeAcceptanceSkeletons({
      projectRoot: run.projectRoot,
      changeName: input.changeName,
      matrix,
      force: input.force,
    });
    const reportPaths = specBddReportPaths(run.projectRoot, input.changeName);
    const reportJsonArtifactId = createArtifactId();
    const reportMdArtifactId = createArtifactId();
    const report = SpecBddReviewReportSchema.parse({
      adapter: "spec-bdd-agent-v1",
      runId: run.id,
      changeName: input.changeName,
      status: input.status,
      reviewedAt: timestamp,
      reviewedRequirements: input.reviewedRequirements,
      reviewedScenarios: input.reviewedScenarios,
      acceptanceSkeletonCount: skeletons.files.length,
      findings: input.findings,
      artifactIds: [reportJsonArtifactId, reportMdArtifactId],
    });
    const reportJson = `${JSON.stringify(report, null, 2)}\n`;
    const reportMd = renderSpecBddReviewMarkdown(report);

    assertInsideProjectRoot(run.projectRoot, reportPaths.reportDirectory);
    await mkdir(reportPaths.reportDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(reportPaths.reportJsonPath, reportJson, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(reportPaths.reportMdPath, reportMd, {
      encoding: "utf8",
      mode: 0o600,
    });

    const reportJsonArtifact = ArtifactRefSchema.parse({
      id: reportJsonArtifactId,
      kind: "test-report",
      uri: `repo://${toRepoRelative(run.projectRoot, reportPaths.reportJsonPath)}`,
      mediaType: "application/json",
      digest: sha256Digest(Buffer.from(reportJson, "utf8")),
      producedBy: "spec-bdd",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        changeName: input.changeName,
        role: "spec-bdd",
        reportType: "spec-bdd-review-json",
        relativePath: toRepoRelative(run.projectRoot, reportPaths.reportJsonPath),
      },
    });
    const reportMdArtifact = ArtifactRefSchema.parse({
      id: reportMdArtifactId,
      kind: "test-report",
      uri: `repo://${toRepoRelative(run.projectRoot, reportPaths.reportMdPath)}`,
      mediaType: "text/markdown",
      digest: sha256Digest(Buffer.from(reportMd, "utf8")),
      producedBy: "spec-bdd",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        changeName: input.changeName,
        role: "spec-bdd",
        reportType: "spec-bdd-review-markdown",
        relativePath: toRepoRelative(run.projectRoot, reportPaths.reportMdPath),
      },
    });
    const baseSha = await currentHead(run.projectRoot, run.baseCommit);
    const knownGapIds = new Set(run.gaps.map((gap) => gap.id));
    const agentGapIds = unique([
      ...input.gapIds,
      ...input.findings.flatMap((finding) => finding.gapIds),
    ]).filter((gapId) => knownGapIds.has(gapId));

    if (input.status === "blocked" && agentGapIds.length === 0) {
      throw new Error("Blocked Spec/BDD results must reference at least one existing Run gap.");
    }

    const knownEvidenceIds = new Set(run.evidence.map((evidence) => evidence.id));
    const agentEvidenceIds = unique(
      input.findings.flatMap((finding) => finding.evidenceIds),
    ).filter((evidenceId) => knownEvidenceIds.has(evidenceId));
    const changedFiles = unique([
      toRepoRelative(run.projectRoot, reportPaths.reportJsonPath),
      toRepoRelative(run.projectRoot, reportPaths.reportMdPath),
      ...skeletons.files,
    ]);
    const agentResult = ImplementationAgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: createAgentResultId(),
      runId: run.id,
      kind: "implementation",
      agent: "spec-bdd",
      status: input.status,
      baseSha,
      ...(input.status === "passed" ? { commitSha: input.commitSha ?? baseSha } : {}),
      evidenceIds: agentEvidenceIds,
      artifactIds: [reportJsonArtifact.id, reportMdArtifact.id],
      gapIds: agentGapIds,
      checks: input.checks,
      decisions: input.decisions,
      changedFiles,
      startedAt: timestamp,
      completedAt: timestamp,
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, reportJsonArtifact, reportMdArtifact],
      agentResults: [...run.agentResults, agentResult],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordSpecBddAgentResultSchema.parse({
      run: summarizeRun(nextRun),
      artifactIds: [reportJsonArtifact.id, reportMdArtifact.id],
      agentResultId: agentResult.id,
      reportJsonPath: toRepoRelative(run.projectRoot, reportPaths.reportJsonPath),
      reportMarkdownPath: toRepoRelative(run.projectRoot, reportPaths.reportMdPath),
      acceptanceSkeletonDirectory: skeletons.directory,
      acceptanceSkeletonFiles: skeletons.files,
    });
  }
}

async function readTestMatrix(projectRoot: string, relativePath: string) {
  const absolutePath = path.join(projectRoot, relativePath);
  assertInsideProjectRoot(projectRoot, absolutePath);
  const content = await readFile(absolutePath, "utf8");

  return TestMatrixSchema.parse(JSON.parse(content));
}

function specBddContextPaths(projectRoot: string, runId: string, changeName: string) {
  const contextDirectory = path.join(
    projectRoot,
    ".spec-to-pr",
    "runs",
    runId,
    "agents",
    "spec-bdd",
    changeName,
  );

  return {
    contextDirectory,
    contextJsonPath: path.join(contextDirectory, "context-pack.json"),
    contextMdPath: path.join(contextDirectory, "context-pack.md"),
  };
}

function specBddReportPaths(projectRoot: string, changeName: string) {
  const reportDirectory = path.join(projectRoot, "openspec", "changes", changeName, "artifacts");

  return {
    reportDirectory,
    reportJsonPath: path.join(reportDirectory, "spec-bdd-review.json"),
    reportMdPath: path.join(reportDirectory, "spec-bdd-review.md"),
  };
}

async function currentHead(projectRoot: string, fallback?: string): Promise<string> {
  try {
    const output = await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["rev-parse", "HEAD"],
    });

    return GitObjectIdSchema.parse(output.stdout.trim());
  } catch (error: unknown) {
    if (fallback !== undefined) {
      return GitObjectIdSchema.parse(fallback);
    }

    throw error;
  }
}

function toRepoRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function assertInsideProjectRoot(projectRoot: string, absolutePath: string): void {
  const relative = path.relative(projectRoot, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access outside project root: ${absolutePath}`);
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
