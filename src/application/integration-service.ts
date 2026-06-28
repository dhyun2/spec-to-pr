import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { CherryPickIntegrationRunner } from "../integration/cherry-pick-runner.js";
import {
  IntegrationConflictReportSchema,
  IntegrationPlanSchema,
  IntegrationResultSchema,
  RepairAttemptSchema,
} from "../integration/integration-contracts.js";
import type {
  IntegrationConflictReport,
  IntegrationPlan,
  IntegrationResult,
  RepairAttempt,
} from "../integration/integration-contracts.js";
import { buildIntegrationCandidates } from "../integration/integration-order.js";
import { IntegrationWorktreeManager } from "../integration/integration-worktree.js";
import { defaultRepairPolicy, RepairPolicySchema } from "../integration/repair-policy.js";
import { RepairHistorySchema } from "../integration/repair-history.js";
import { GitCommandRunner, detectConflictedFiles } from "../integration/git-integration-runner.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { createAgentResultId, createArtifactId } from "../runtime/id-factory.js";
import { AgentResultIdSchema, ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import type { AgentRole } from "../runtime/constants.js";
import type { RunStore } from "../store/run-store.js";

export const PrepareIntegrationInputSchema = z
  .object({
    runId: RunIdSchema,
    approvedAgentResultIds: z.array(AgentResultIdSchema).min(1),
    maxRepairAttempts: z.number().int().nonnegative().default(2),
  })
  .strict();

export const GetIntegrationPlanInputSchema = z
  .object({
    runId: RunIdSchema,
    planArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const ApplyIntegrationInputSchema = z
  .object({
    runId: RunIdSchema,
    planArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const RecordIntegrationRepairInputSchema = z
  .object({
    runId: RunIdSchema,
    resultArtifactId: ArtifactIdSchema.optional(),
    attempt: RepairAttemptSchema,
  })
  .strict();

export const FinalizeIntegrationInputSchema = z
  .object({
    runId: RunIdSchema,
    resultArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const PrepareIntegrationResultSchema = z
  .object({
    run: RunSummarySchema,
    plan: IntegrationPlanSchema,
    planArtifactId: ArtifactIdSchema,
    repairPolicyArtifactId: ArtifactIdSchema,
    contextDirectory: z.string().trim().min(1),
  })
  .strict();

export const GetIntegrationPlanResultSchema = z
  .object({
    runId: RunIdSchema,
    planArtifactId: ArtifactIdSchema,
    plan: IntegrationPlanSchema,
  })
  .strict();

export const ApplyIntegrationResultSchema = z
  .object({
    run: RunSummarySchema,
    result: IntegrationResultSchema,
    resultArtifactId: ArtifactIdSchema,
    conflictReportArtifactIds: z.array(ArtifactIdSchema),
  })
  .strict();

export const RecordIntegrationRepairResultSchema = z
  .object({
    run: RunSummarySchema,
    result: IntegrationResultSchema,
    resultArtifactId: ArtifactIdSchema,
    repairHistoryArtifactId: ArtifactIdSchema,
    repairAttemptCount: z.number().int().nonnegative(),
    remainingRepairAttempts: z.number().int().nonnegative(),
  })
  .strict();

export const FinalizeIntegrationResultSchema = z
  .object({
    run: RunSummarySchema,
    result: IntegrationResultSchema,
    resultArtifactId: ArtifactIdSchema,
    agentResultId: AgentResultIdSchema,
    message: z.string().trim().min(1),
  })
  .strict();

export class IntegrationService {
  private readonly git: GitCommandRunner;
  private readonly worktreeManager: IntegrationWorktreeManager;
  private readonly cherryPickRunner: CherryPickIntegrationRunner;

  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly dataDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
    git = new GitCommandRunner(),
  ) {
    this.git = git;
    this.worktreeManager = new IntegrationWorktreeManager(this.git);
    this.cherryPickRunner = new CherryPickIntegrationRunner(this.git);
  }

  public async prepareIntegration(rawInput: unknown) {
    const input = PrepareIntegrationInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    assertReviewCouncilAllowsIntegration(run);

    const worktree = await this.worktreeManager.ensureIntegrationWorktree(run);
    const candidates = buildIntegrationCandidates({
      agentResults: run.agentResults,
      approvedAgentResultIds: input.approvedAgentResultIds,
    });
    const repairPolicy = defaultRepairPolicy(input.maxRepairAttempts);
    const repairPolicyArtifact = await this.writeJsonArtifact({
      label: "integration-repair-policy",
      artifactRole: "repair-policy",
      value: repairPolicy,
      createdAt: timestamp,
    });
    const plan = IntegrationPlanSchema.parse({
      runId: run.id,
      status: "planned",
      strategy: "cherry-pick",
      baseCommit: worktree.baseCommit,
      integrationBranch: worktree.branch,
      integrationWorktreePath: worktree.path,
      candidates,
      maxRepairAttempts: repairPolicy.maxAttempts,
      repairPolicyArtifactId: repairPolicyArtifact.id,
      createdAt: timestamp,
    });
    const planArtifact = await this.writeJsonArtifact({
      label: "integration-plan",
      artifactRole: "integration-plan",
      value: plan,
      createdAt: timestamp,
    });
    const contextDirectory = await writeIntegrationContextPack({
      dataDirectory: this.dataDirectory,
      runId: run.id,
      plan,
      repairPolicy,
      approvedAgentResults: run.agentResults.filter((result) =>
        input.approvedAgentResultIds.includes(result.id),
      ),
      reviewCouncilResult: await this.latestReviewCouncilStructuredResult(run),
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, repairPolicyArtifact, planArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return PrepareIntegrationResultSchema.parse({
      run: summarizeRun(nextRun),
      plan,
      planArtifactId: planArtifact.id,
      repairPolicyArtifactId: repairPolicyArtifact.id,
      contextDirectory,
    });
  }

  public async getIntegrationPlan(rawInput: unknown) {
    const input = GetIntegrationPlanInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const planArtifact = findIntegrationArtifact(run, {
      artifactId: input.planArtifactId,
      artifactRole: "integration-plan",
    });
    const plan = await this.readJsonArtifact(planArtifact.id, run, IntegrationPlanSchema);

    return GetIntegrationPlanResultSchema.parse({
      runId: run.id,
      planArtifactId: planArtifact.id,
      plan,
    });
  }

  public async applyIntegration(rawInput: unknown) {
    const input = ApplyIntegrationInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const planArtifact = findIntegrationArtifact(run, {
      artifactId: input.planArtifactId,
      artifactRole: "integration-plan",
    });
    const plan = await this.readJsonArtifact(planArtifact.id, run, IntegrationPlanSchema);
    const applied = [];
    const conflictReports: IntegrationConflictReport[] = [];

    for (const candidate of plan.candidates) {
      const result = await this.cherryPickRunner.applyCandidate({
        runId: run.id,
        worktreePath: plan.integrationWorktreePath,
        candidate,
        now: timestamp,
      });

      if (!result.ok) {
        conflictReports.push(result.conflictReport);
        break;
      }

      applied.push(candidate);
    }

    const conflictArtifacts = [];

    for (const report of conflictReports) {
      conflictArtifacts.push(
        await this.writeJsonArtifact({
          label: "integration-conflict-report",
          artifactRole: "conflict-report",
          value: report,
          createdAt: timestamp,
        }),
      );
    }

    const status = conflictReports.length > 0 ? "conflicted" : "passed";
    const headSha =
      status === "passed" ? await currentHead(plan.integrationWorktreePath, this.git) : undefined;
    const integrationResult = IntegrationResultSchema.parse({
      runId: run.id,
      status,
      integrationBranch: plan.integrationBranch,
      integrationWorktreePath: plan.integrationWorktreePath,
      ...(headSha === undefined ? {} : { headSha }),
      appliedCandidates: applied,
      skippedCandidates: plan.candidates.slice(applied.length),
      conflictReportArtifactIds: conflictArtifacts.map((artifact) => artifact.id),
      repairAttempts: [],
      artifactIds: [planArtifact.id, ...conflictArtifacts.map((artifact) => artifact.id)],
      startedAt: plan.createdAt,
      ...(status === "passed" ? { completedAt: timestamp } : {}),
    });
    const resultArtifact = await this.writeJsonArtifact({
      label: "integration-result",
      artifactRole: "integration-result",
      value: integrationResult,
      createdAt: timestamp,
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...conflictArtifacts, resultArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return ApplyIntegrationResultSchema.parse({
      run: summarizeRun(nextRun),
      result: integrationResult,
      resultArtifactId: resultArtifact.id,
      conflictReportArtifactIds: conflictArtifacts.map((artifact) => artifact.id),
    });
  }

  public async recordRepair(rawInput: unknown) {
    const input = RecordIntegrationRepairInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const resultArtifact = findIntegrationArtifact(run, {
      artifactId: input.resultArtifactId,
      artifactRole: "integration-result",
    });
    const result = await this.readJsonArtifact(resultArtifact.id, run, IntegrationResultSchema);
    const plan = await this.planForResult(run, result);

    if (result.repairAttempts.length >= plan.maxRepairAttempts) {
      throw new Error("Integration repair budget exhausted");
    }

    if (input.attempt.attempt !== result.repairAttempts.length + 1) {
      throw new Error(`Expected repair attempt ${result.repairAttempts.length + 1}`);
    }

    const policy = plan.repairPolicyArtifactId
      ? await this.readJsonArtifact(plan.repairPolicyArtifactId, run, RepairPolicySchema)
      : defaultRepairPolicy(plan.maxRepairAttempts);
    const conflictReports = await Promise.all(
      result.conflictReportArtifactIds.map((artifactId) =>
        this.readJsonArtifact(artifactId, run, IntegrationConflictReportSchema),
      ),
    );
    const nextAttempts = [...result.repairAttempts, input.attempt];
    const repairHistory = RepairHistorySchema.parse({
      runId: run.id,
      policy,
      conflictReports,
      attempts: nextAttempts,
    });
    const repairHistoryArtifact = await this.writeJsonArtifact({
      label: "integration-repair-history",
      artifactRole: "repair-history",
      value: repairHistory,
      createdAt: timestamp,
      producedBy: "integrator",
    });
    const nextResult = IntegrationResultSchema.parse({
      ...result,
      status: input.attempt.status === "applied" ? "repairing" : "failed",
      repairAttempts: nextAttempts,
      artifactIds: unique([...result.artifactIds, repairHistoryArtifact.id]),
    });
    const nextResultArtifact = await this.writeJsonArtifact({
      label: "integration-result",
      artifactRole: "integration-result",
      value: nextResult,
      createdAt: timestamp,
      producedBy: "integrator",
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, repairHistoryArtifact, nextResultArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordIntegrationRepairResultSchema.parse({
      run: summarizeRun(nextRun),
      result: nextResult,
      resultArtifactId: nextResultArtifact.id,
      repairHistoryArtifactId: repairHistoryArtifact.id,
      repairAttemptCount: nextAttempts.length,
      remainingRepairAttempts: plan.maxRepairAttempts - nextAttempts.length,
    });
  }

  public async finalizeIntegration(rawInput: unknown) {
    const input = FinalizeIntegrationInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const resultArtifact = findIntegrationArtifact(run, {
      artifactId: input.resultArtifactId,
      artifactRole: "integration-result",
    });
    const result = await this.readJsonArtifact(resultArtifact.id, run, IntegrationResultSchema);
    const conflictedFiles = await detectConflictedFiles(result.integrationWorktreePath, this.git);
    const headSha = await currentHead(result.integrationWorktreePath, this.git);
    const finalStatus =
      result.status === "passed" || (result.status === "repairing" && conflictedFiles.length === 0)
        ? "passed"
        : "failed";
    const finalResult = IntegrationResultSchema.parse({
      ...result,
      status: finalStatus,
      headSha,
      completedAt: timestamp,
    });
    const finalResultArtifact = await this.writeJsonArtifact({
      label: "integration-result",
      artifactRole: "integration-result",
      value: finalResult,
      createdAt: timestamp,
      producedBy: "integrator",
    });
    const agentResult = AgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: createAgentResultId(),
      runId: run.id,
      kind: "implementation",
      agent: "integrator",
      status: finalStatus === "passed" ? "passed" : "failed",
      baseSha: await this.baseShaForResult(run, finalResult),
      ...(finalStatus === "passed" ? { commitSha: headSha } : {}),
      changedFiles: unique([
        ...finalResult.appliedCandidates.flatMap((candidate) => candidate.changedFiles),
        ...finalResult.repairAttempts.flatMap((attempt) => attempt.changedFiles),
      ]),
      evidenceIds: [],
      artifactIds: unique([...finalResult.artifactIds, finalResultArtifact.id]),
      gapIds: finalResult.gapIds,
      checks: [],
      decisions: [],
      startedAt: finalResult.startedAt,
      completedAt: timestamp,
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, finalResultArtifact],
      agentResults: [...run.agentResults, agentResult],
    });

    await this.runStore.save(nextRun, run.revision);

    return FinalizeIntegrationResultSchema.parse({
      run: summarizeRun(nextRun),
      result: finalResult,
      resultArtifactId: finalResultArtifact.id,
      agentResultId: agentResult.id,
      message:
        "Integration finalize recorded integration metadata. Full quality gates run in later tasks.",
    });
  }

  private async baseShaForResult(
    run: Awaited<ReturnType<RunStore["get"]>>,
    result: IntegrationResult,
  ): Promise<string> {
    const planArtifactId = result.artifactIds[0];

    if (planArtifactId !== undefined) {
      const plan = await this.readJsonArtifact(planArtifactId, run, IntegrationPlanSchema);
      return plan.baseCommit;
    }

    return GitObjectIdSchema.parse(
      run.baseCommit ?? (await currentHead(run.projectRoot, this.git)),
    );
  }

  private async planForResult(
    run: Awaited<ReturnType<RunStore["get"]>>,
    result: IntegrationResult,
  ): Promise<IntegrationPlan> {
    const planArtifactId = result.artifactIds[0];

    if (planArtifactId === undefined) {
      throw new Error("Integration result is missing plan artifact reference");
    }

    return this.readJsonArtifact(planArtifactId, run, IntegrationPlanSchema);
  }

  private async latestReviewCouncilStructuredResult(
    run: Awaited<ReturnType<RunStore["get"]>>,
  ): Promise<unknown> {
    const artifact = [...run.artifacts]
      .reverse()
      .find(
        (item) =>
          item.metadata["adapter"] === "review-council-v1" &&
          item.metadata["artifactRole"] === "structured-result",
      );

    if (artifact === undefined) {
      return {};
    }

    return JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8"));
  }

  private async readJsonArtifact<T>(
    artifactId: string,
    run: Awaited<ReturnType<RunStore["get"]>>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const artifact = run.artifacts.find((item) => item.id === artifactId);

    if (artifact === undefined) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const content = await this.artifactStore.readContent(Sha256DigestSchema.parse(artifact.digest));

    return schema.parse(JSON.parse(content.toString("utf8")));
  }

  private async writeJsonArtifact(input: {
    label: string;
    artifactRole: string;
    value: unknown;
    createdAt: string;
    producedBy?: AgentRole;
  }) {
    const content = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`, "utf8");
    const blob = await this.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: input.createdAt,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "log",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: input.producedBy ?? "orchestrator",
      evidenceIds: [],
      createdAt: input.createdAt,
      metadata: {
        adapter: "integration-v1",
        artifactRole: input.artifactRole,
        label: input.label,
      },
    });
  }
}

function assertReviewCouncilAllowsIntegration(run: Awaited<ReturnType<RunStore["get"]>>): void {
  const reviewResult = [...run.agentResults]
    .reverse()
    .find((result) => result.agent === "review-council");

  if (reviewResult === undefined) {
    throw new Error("Review Council result is required before integration");
  }

  if (reviewResult.status !== "passed") {
    throw new Error(
      `Review Council result must be passed before integration: ${reviewResult.status}`,
    );
  }

  const openBlockerGap = run.gaps.find(
    (gap) => gap.status === "open" && gap.severity === "blocker",
  );

  if (openBlockerGap !== undefined) {
    throw new Error(`Open blocker gap prevents integration: ${openBlockerGap.id}`);
  }
}

function findIntegrationArtifact(
  run: Awaited<ReturnType<RunStore["get"]>>,
  input: {
    artifactId: string | undefined;
    artifactRole: string;
  },
) {
  const candidates = run.artifacts.filter(
    (artifact) =>
      artifact.metadata["adapter"] === "integration-v1" &&
      artifact.metadata["artifactRole"] === input.artifactRole,
  );
  const artifact =
    input.artifactId === undefined
      ? candidates.at(-1)
      : candidates.find((item) => item.id === input.artifactId);

  if (artifact === undefined) {
    throw new Error(
      input.artifactId === undefined
        ? `Integration artifact not found for role: ${input.artifactRole}`
        : `Integration artifact not found: ${input.artifactId}`,
    );
  }

  return artifact;
}

async function currentHead(worktreePath: string, git: GitCommandRunner): Promise<string> {
  const result = await git.exec({
    cwd: worktreePath,
    args: ["rev-parse", "HEAD"],
  });

  return GitObjectIdSchema.parse(result.stdout.trim());
}

async function writeIntegrationContextPack(input: {
  dataDirectory: string;
  runId: string;
  plan: IntegrationPlan;
  repairPolicy: unknown;
  approvedAgentResults: unknown[];
  reviewCouncilResult: unknown;
}): Promise<string> {
  const contextDirectory = path.join(
    input.dataDirectory,
    "agent-contexts",
    "integration",
    input.runId,
  );

  await mkdir(contextDirectory, {
    recursive: true,
    mode: 0o700,
  });
  await Promise.all([
    writeJsonFile(path.join(contextDirectory, "integration-plan.json"), input.plan),
    writeJsonFile(
      path.join(contextDirectory, "review-council-result.json"),
      input.reviewCouncilResult,
    ),
    writeJsonFile(
      path.join(contextDirectory, "approved-agent-results.json"),
      input.approvedAgentResults,
    ),
    writeJsonFile(path.join(contextDirectory, "repair-policy.json"), input.repairPolicy),
    writeJsonFile(path.join(contextDirectory, "allowed-files.json"), {
      changedFiles: unique(input.plan.candidates.flatMap((candidate) => candidate.changedFiles)),
    }),
    writeJsonFile(path.join(contextDirectory, "forbidden-actions.json"), {
      forbiddenActions:
        typeof input.repairPolicy === "object" &&
        input.repairPolicy !== null &&
        "forbiddenActions" in input.repairPolicy
          ? (input.repairPolicy as { forbiddenActions: unknown }).forbiddenActions
          : [],
    }),
    writeJsonFile(path.join(contextDirectory, "conflict-report.json"), {
      reports: [],
    }),
    writeFile(path.join(contextDirectory, "instructions.md"), renderIntegratorInstructions(), {
      encoding: "utf8",
      mode: 0o600,
    }),
  ]);

  return contextDirectory;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function renderIntegratorInstructions(): string {
  return `# Integration Repair Instructions

Use this context only inside the prepared integration worktree.

Allowed repair is limited to conflict markers, import paths, type references, formatting, and small glue code inconsistencies.

Do not add undocumented API endpoints, invent Figma states, delete tests, close gaps without evidence, or expand OpenSpec scope.
`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
