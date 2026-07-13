import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import type { RunManifest } from "../run/run.js";
import type { RunStageName, StageState } from "../run/stages.js";
import type { RunStore } from "../store/run-store.js";
import {
  ReviewSubmissionSchema,
  WorkflowActionSchema,
  WorkflowScopeSchema,
  WorkflowStatusSchema,
  WorkflowSubmissionSchema,
  buildGatePlan,
  classifyWorkflowScope,
  type WorkflowScope,
  type WorkflowStatus,
  type WorkflowSubmission,
} from "../workflow/index.js";
import type { IntakeRequestService } from "./intake-request-service.js";
import type { OpenSpecArchiveService } from "./openspec-archive-service.js";
import type { ProjectProfileService } from "./profile-service.js";
import type { PublisherService } from "./publisher-service.js";
import type { RunService } from "./run-service.js";
import type { StageService } from "./stage-service.js";

const WORKER_ID = "workflow-orchestrator" as const;

export const WorkflowStartInputSchema = z
  .object({
    projectRoot: z.string().trim().min(1),
    requestText: z.string().trim().min(1).max(200_000),
    scope: z.enum(["auto", "ui", "non-ui", "docs"]).default("auto"),
  })
  .strict();

export const WorkflowAdvanceInputSchema = z
  .object({
    runId: RunIdSchema,
    until: z.enum(["boundary", "report", "publish-ready"]).default("boundary"),
  })
  .strict();

export const WorkflowSubmitInputSchema = z
  .object({
    runId: RunIdSchema,
    submission: WorkflowSubmissionSchema,
  })
  .strict();

export const WorkflowStatusInputSchema = z.object({ runId: RunIdSchema }).strict();

export const WorkflowPublishInputSchema = z
  .object({
    runId: RunIdSchema,
    mode: z.enum(["preview", "execute"]),
    sourceBranch: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1).default("main"),
    title: z.string().trim().min(1).optional(),
    remoteName: z.string().trim().min(1).default("origin"),
    pushBranch: z.boolean().default(true),
    confirm: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "execute" && !input.confirm) {
      context.addIssue({
        code: "custom",
        path: ["confirm"],
        message: "Executing publication requires confirm=true",
      });
    }
  });

export const WorkflowArchiveInputSchema = z
  .object({
    runId: RunIdSchema.optional(),
    mode: z.enum(["preview", "execute"]),
    changeName: z.string().trim().min(1).optional(),
    mergeEvidenceId: ArtifactIdSchema.optional(),
    confirm: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode !== "execute") {
      return;
    }
    if (!input.confirm) {
      context.addIssue({
        code: "custom",
        path: ["confirm"],
        message: "Executing archive requires confirm=true",
      });
    }
    if (
      input.runId === undefined ||
      input.changeName === undefined ||
      input.mergeEvidenceId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Executing archive requires runId, changeName, and mergeEvidenceId",
      });
    }
  });

export type WorkflowServiceDependencies = {
  runStore: RunStore;
  artifactStore: ArtifactBlobStore;
  runService: RunService;
  intakeRequestService: IntakeRequestService;
  profileService: ProjectProfileService;
  stageService: StageService;
  publisherService?: PublisherService;
  archiveService?: OpenSpecArchiveService;
  now?: () => string;
};

export class WorkflowService {
  private readonly now: () => string;

  public constructor(private readonly dependencies: WorkflowServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async start(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowStartInputSchema.parse(rawInput);
    const created = await this.dependencies.runService.createRun({
      projectRoot: input.projectRoot,
      sources: [],
    });
    const started = await this.dependencies.stageService.start({
      runId: created.id,
      stageName: "intake",
      workerId: WORKER_ID,
    });
    const parsed = await this.dependencies.intakeRequestService.parseIntakeRequest({
      runId: created.id,
      requestText: input.requestText,
    });
    await this.dependencies.profileService.inspectProject({
      runId: created.id,
      projectRoot: input.projectRoot,
    });

    const scope = classifyWorkflowScope({
      requestText: input.requestText,
      explicitScope: input.scope,
      figmaUrls: parsed.parsed.figmaUrls,
    });
    const gatePlan = buildGatePlan(scope);

    await this.dependencies.stageService.complete({
      runId: created.id,
      stageName: "intake",
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds: [parsed.artifact.id],
      checkpoint: {
        name: "scope-classified",
        data: { scope, gatePlan },
      },
    });

    return this.status({ runId: created.id });
  }

  public async advance(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowAdvanceInputSchema.parse(rawInput);

    for (let step = 0; step < 8; step += 1) {
      const run = await this.dependencies.runStore.get(input.runId);
      const scope = scopeFromRun(run);
      const designStage = stage(run, "design-review");
      const functionalStage = stage(run, "functional-review");
      const reportStage = stage(run, "report");

      if (!scope.ui && designStage.status === "pending") {
        await this.skipStage(run.id, "design-review", "No UI changes are in scope.");
        continue;
      }

      if (
        reportStage.status === "pending" &&
        functionalStage.status === "passed" &&
        ["passed", "skipped", "waived"].includes(stage(run, "design-review").status)
      ) {
        await this.generateReport(run.id);
        if (input.until === "report") {
          return this.status({ runId: run.id });
        }
        continue;
      }

      return this.status({ runId: input.runId });
    }

    throw new Error(`Workflow ${input.runId} exceeded the deterministic advance limit`);
  }

  public async submit(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowSubmitInputSchema.parse(rawInput);
    const run = await this.dependencies.runStore.get(input.runId);
    const submission = input.submission;

    if (submission.kind === "figma-bundle") {
      await this.recordSubmissionArtifact(run, submission);
      return this.status({ runId: run.id });
    }

    const stageName = stageForSubmission(submission);
    assertSubmissionPrerequisites(run, submission);
    const started = await this.dependencies.stageService.start({
      runId: run.id,
      stageName,
      workerId: WORKER_ID,
    });
    const artifact = await this.recordSubmissionArtifact(
      await this.dependencies.runStore.get(run.id),
      submission,
    );
    const outcome = submissionOutcome(submission);

    if (outcome === "passed") {
      await this.dependencies.stageService.complete({
        runId: run.id,
        stageName,
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [artifact.id],
        ...(submission.kind === "implementation"
          ? {
              checkpoint: {
                name: "api-ready",
                data: {
                  apiReady: submission.apiReady,
                  uiChanged: submission.uiChanged,
                },
              },
            }
          : {}),
      });
    } else {
      await this.dependencies.stageService.fail({
        runId: run.id,
        stageName,
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [artifact.id],
        error: {
          code: outcome === "blocked" ? "WORKFLOW_BLOCKED" : "CHANGES_REQUESTED",
          message: submission.summary,
          retryable: outcome !== "blocked",
        },
      });
    }

    return this.status({ runId: run.id });
  }

  public async status(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowStatusInputSchema.parse(rawInput);
    const run = await this.dependencies.runStore.get(input.runId);
    const scope = scopeFromRun(run);
    const nextActions = actionsForRun(run, scope);
    const currentStage = run.stages.find(
      (item) => !["passed", "skipped", "waived"].includes(item.status),
    );
    const blockers = run.stages.flatMap((item) =>
      item.error === undefined || item.error.retryable ? [] : [item.error.message],
    );
    const reportPassed = stage(run, "report").status === "passed";
    const publishPassed = stage(run, "publish").status === "passed";
    const status = publishPassed
      ? "completed"
      : reportPassed
        ? "publish-ready"
        : blockers.length > 0
          ? "blocked"
          : nextActions.length > 0
            ? "needs-external-action"
            : "running";

    return WorkflowStatusSchema.parse({
      runId: run.id,
      status,
      ...(currentStage === undefined ? {} : { currentStage: currentStage.name }),
      scope,
      stages: run.stages.map((item) => ({ name: item.name, status: item.status })),
      nextActions,
      blockers,
      artifactIds: run.artifacts.map((artifact) => artifact.id),
    });
  }

  public async publish(rawInput: unknown): Promise<unknown> {
    const input = WorkflowPublishInputSchema.parse(rawInput);
    const publisher = this.dependencies.publisherService;

    if (publisher === undefined) {
      throw new Error("Publishing is unavailable in this runtime");
    }

    const run = await this.dependencies.runStore.get(input.runId);
    const reportArtifact = latestArtifact(run, "pr-report", "pr-body-markdown");
    const baseInput = {
      runId: run.id,
      reportArtifactId: reportArtifact.id,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      ...(input.title === undefined ? {} : { title: input.title }),
      remoteName: input.remoteName,
      mode: "draft" as const,
      pushBranch: input.pushBranch,
      labels: ["spec-to-pr"],
      reviewers: [],
      assignees: [],
    };

    if (input.mode === "preview") {
      return publisher.plan(baseInput);
    }

    const started = await this.dependencies.stageService.start({
      runId: run.id,
      stageName: "publish",
      workerId: WORKER_ID,
    });
    const result = await publisher.publish({ ...baseInput, confirm: true });
    await this.dependencies.stageService.complete({
      runId: run.id,
      stageName: "publish",
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds: [result.publishResultArtifactId],
    });
    await this.skipStage(run.id, "archive", "Archive is an explicit post-merge action.");

    return { result, status: await this.status({ runId: run.id }) };
  }

  public async archive(rawInput: unknown): Promise<unknown> {
    const input = WorkflowArchiveInputSchema.parse(rawInput);
    const archiveService = this.dependencies.archiveService;

    if (archiveService === undefined) {
      throw new Error("OpenSpec archive is unavailable in this runtime");
    }

    if (input.mode === "preview") {
      const resolved = await archiveService.resolveTarget({
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.changeName === undefined ? {} : { changeName: input.changeName }),
      });

      if (!resolved.resolved) {
        return resolved;
      }

      return archiveService.plan({ runId: resolved.runId, changeName: resolved.changeName });
    }

    const runId = input.runId!;
    const started = await this.dependencies.stageService.start({
      runId,
      stageName: "archive",
      workerId: WORKER_ID,
    });
    const result = await archiveService.runArchive({
      runId,
      changeName: input.changeName!,
      mergeEvidenceId: input.mergeEvidenceId!,
      yes: true,
    });

    if (result.status === "passed") {
      await this.dependencies.stageService.complete({
        runId,
        stageName: "archive",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [result.reportArtifactId],
      });
    } else {
      await this.dependencies.stageService.fail({
        runId,
        stageName: "archive",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [result.reportArtifactId],
        error: {
          code: "ARCHIVE_FAILED",
          message: `OpenSpec archive ${result.status}`,
          retryable: result.status === "failed",
        },
      });
    }

    return { result, status: await this.status({ runId }) };
  }

  private async recordSubmissionArtifact(
    run: RunManifest,
    submission: WorkflowSubmission,
  ): Promise<ArtifactRef> {
    const timestamp = this.now();
    const content = `${JSON.stringify(submission, null, 2)}\n`;
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(content, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: `workflow-${submission.kind}`,
    });
    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: submission.kind === "figma-bundle" ? "figma-design-context" : "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: producerForSubmission(submission),
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "workflow-v2",
        workflowSubmissionKind: submission.kind,
        ...(submission.kind === "figma-bundle" ? {} : { summary: submission.summary }),
        ...("verdict" in submission ? { verdict: submission.verdict } : {}),
        ...("status" in submission ? { status: submission.status } : {}),
      },
    });
    const current = await this.dependencies.runStore.get(run.id);

    await this.dependencies.runStore.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        artifacts: [...current.artifacts, artifact],
      },
      current.revision,
    );

    return artifact;
  }

  private async generateReport(runId: string): Promise<void> {
    const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
    const timestamp = this.now();
    const summaries = run.artifacts
      .filter((artifact) => artifact.metadata["workflowSubmissionKind"] !== undefined)
      .map(
        (artifact) =>
          `- ${String(artifact.metadata["workflowSubmissionKind"])}: ${String(artifact.metadata["summary"] ?? "recorded")}`,
      );
    const markdown = [
      `# SpecToPR Run ${run.id}`,
      "",
      "## Decision",
      "",
      "Ready for draft review.",
      "",
      "## Evidence",
      "",
      ...(summaries.length === 0 ? ["- No external submissions recorded."] : summaries),
      "",
    ].join("\n");
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(markdown, "utf8"),
      mediaType: "text/markdown",
      storedAt: timestamp,
      label: "pr-report.md",
    });
    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "pr-report",
      uri: blob.uri,
      mediaType: "text/markdown",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "workflow-v2",
        reportKind: "pr-body-markdown",
        decision: "ready",
        locale: "ko",
      },
    });

    await this.dependencies.runStore.save(
      {
        ...run,
        revision: run.revision + 1,
        updatedAt: timestamp,
        artifacts: [...run.artifacts, artifact],
      },
      run.revision,
    );
    await this.completeStage(run.id, "report", [artifact.id]);
  }

  private async completeStage(
    runId: string,
    stageName: RunStageName,
    artifactIds: string[] = [],
  ): Promise<void> {
    const started = await this.dependencies.stageService.start({
      runId,
      stageName,
      workerId: WORKER_ID,
    });
    await this.dependencies.stageService.complete({
      runId,
      stageName,
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds,
    });
  }

  private async skipStage(runId: string, stageName: RunStageName, reason: string): Promise<void> {
    const started = await this.dependencies.stageService.start({
      runId,
      stageName,
      workerId: WORKER_ID,
    });
    await this.dependencies.stageService.skip({
      runId,
      stageName,
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      reason,
    });
  }
}

function scopeFromRun(run: RunManifest): WorkflowScope {
  const rawScope = stage(run, "intake").checkpoint?.data["scope"];
  const parsed = WorkflowScopeSchema.safeParse(rawScope);

  if (!parsed.success) {
    throw new Error(`Run ${run.id} uses an unsupported pre-v2 workflow contract`);
  }

  return parsed.data;
}

function stage(run: RunManifest, name: RunStageName): StageState {
  const value = run.stages.find((item) => item.name === name);

  if (value === undefined) {
    throw new Error(`Run ${run.id} is missing workflow stage ${name}`);
  }

  return value;
}

function actionsForRun(run: RunManifest, scope: WorkflowScope) {
  if (isActionable(stage(run, "contracts"))) {
    return [WorkflowActionSchema.parse({ kind: "prepare-contracts", runId: run.id })];
  }
  if (stage(run, "contracts").status === "passed" && isActionable(stage(run, "implementation"))) {
    return [
      WorkflowActionSchema.parse({ kind: "implement", runId: run.id, requireApiReady: true }),
    ];
  }
  if (stage(run, "implementation").status !== "passed") {
    return [];
  }

  const actions = [];
  if (isActionable(stage(run, "functional-review"))) {
    actions.push(WorkflowActionSchema.parse({ kind: "review-functional", runId: run.id }));
  }
  if (scope.ui && isActionable(stage(run, "design-review"))) {
    actions.push(WorkflowActionSchema.parse({ kind: "review-design", runId: run.id }));
  }
  if (stage(run, "report").status === "passed" && isActionable(stage(run, "publish"))) {
    actions.push(WorkflowActionSchema.parse({ kind: "publish-draft", runId: run.id }));
  }

  return actions;
}

function isActionable(value: StageState): boolean {
  return ["pending", "failed", "blocked"].includes(value.status);
}

function stageForSubmission(
  submission: Exclude<WorkflowSubmission, { kind: "figma-bundle" }>,
): RunStageName {
  if (submission.kind === "contracts") return "contracts";
  if (submission.kind === "implementation") return "implementation";
  return submission.kind;
}

function assertSubmissionPrerequisites(run: RunManifest, submission: WorkflowSubmission): void {
  if (submission.kind === "implementation" && stage(run, "contracts").status !== "passed") {
    throw new Error("The contracts stage must pass before implementation begins");
  }
  if (
    (submission.kind === "functional-review" || submission.kind === "design-review") &&
    stage(run, "implementation").status !== "passed"
  ) {
    throw new Error("The implementation stage must pass before review begins");
  }
  if (submission.kind === "design-review" && !scopeFromRun(run).ui) {
    throw new Error("Design review is not applicable to non-UI scope");
  }
}

function submissionOutcome(submission: Exclude<WorkflowSubmission, { kind: "figma-bundle" }>) {
  if ("verdict" in submission) {
    return submission.verdict === "approved"
      ? "passed"
      : submission.verdict === "blocked"
        ? "blocked"
        : "failed";
  }
  return submission.status;
}

function producerForSubmission(submission: WorkflowSubmission) {
  if (submission.kind === "implementation") return "implementation" as const;
  if (submission.kind === "functional-review") return "functional-reviewer" as const;
  if (submission.kind === "design-review") return "design-reviewer" as const;
  return "orchestrator" as const;
}

function latestArtifact(
  run: RunManifest,
  kind: ArtifactRef["kind"],
  reportKind: string,
): ArtifactRef {
  const artifact = [...run.artifacts]
    .reverse()
    .find((item) => item.kind === kind && item.metadata["reportKind"] === reportKind);

  if (artifact === undefined) {
    throw new Error(`Run ${run.id} has no ${reportKind} artifact`);
  }

  return artifact;
}
