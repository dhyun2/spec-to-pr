import path from "node:path";

import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  executeQualityGate,
  planQualityGates,
  QualityGateCommandOverrideSchema,
  QualityGateNameSchema,
  QualityGateReportSchema,
  readCoverageSummary,
  renderQualityGateReportMarkdown,
  skippedByFailFast,
} from "../quality-gates/index.js";
import type { QualityGateExecution, QualityGateReport } from "../quality-gates/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { CheckResultSchema } from "../runtime/check.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { GapSchema } from "../runtime/gap.js";
import {
  createAgentResultId,
  createArtifactId,
  createCheckId,
  createGapId,
} from "../runtime/id-factory.js";
import {
  AgentResultIdSchema,
  ArtifactIdSchema,
  CheckIdSchema,
  GapIdSchema,
  RunIdSchema,
} from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef, CheckResult, Gap } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

export const RunQualityGatesInputSchema = z
  .object({
    runId: RunIdSchema,
    gates: z.array(QualityGateNameSchema).min(1).optional(),
    commands: z.record(z.string(), QualityGateCommandOverrideSchema).optional(),
    timeoutMs: z.number().int().positive().max(600_000).default(120_000),
    failFast: z.boolean().default(false),
    coverageSummaryPath: z.string().trim().min(1).default("coverage/coverage-summary.json"),
  })
  .strict();

export const RunQualityGatesResultSchema = z
  .object({
    run: RunSummarySchema,
    status: z.enum(["passed", "failed"]),
    reportArtifactId: ArtifactIdSchema,
    markdownReportArtifactId: ArtifactIdSchema,
    coverageArtifactId: ArtifactIdSchema.optional(),
    agentResultId: AgentResultIdSchema,
    gateCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    checkIds: z.array(CheckIdSchema),
    gapIds: z.array(GapIdSchema),
  })
  .strict();

type ProducedArtifacts = {
  artifacts: ArtifactRef[];
  coverageArtifactId?: string;
};

export class QualityGateService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async run(rawInput: unknown) {
    const input = RunQualityGatesInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const startedAt = IsoDateTimeSchema.parse(this.now());
    const plan = await planQualityGates({
      projectRoot: run.projectRoot,
      ...(input.gates === undefined ? {} : { gates: input.gates }),
      ...(input.commands === undefined ? {} : { commands: input.commands }),
      timeoutMs: input.timeoutMs,
    });
    const executions: QualityGateExecution[] = [];
    let stoppedByFailFast = false;

    for (const gate of plan.gates) {
      if (stoppedByFailFast) {
        executions.push(skippedByFailFast(gate));
        continue;
      }

      const execution = await executeQualityGate(gate, this.now);

      executions.push(execution);

      if (input.failFast && execution.status === "failed") {
        stoppedByFailFast = true;
      }
    }

    const completedAt = IsoDateTimeSchema.parse(this.now());
    const coverage = await readCoverageSummary({
      projectRoot: run.projectRoot,
      relativePath: input.coverageSummaryPath,
    });
    const produced = await this.writeExecutionArtifacts({
      executions,
      createdAt: completedAt,
      ...(coverage.coverageSummary === undefined
        ? {}
        : { coverageSummary: coverage.coverageSummary }),
    });
    const checks = executions.map((execution) =>
      checkFromExecution(
        checkInputFromExecution({
          projectRoot: run.projectRoot,
          execution,
          artifacts: produced.artifacts,
        }),
      ),
    );
    const failedChecks = checks.filter((check) => check.status === "failed");
    const warnings = coverage.warning === undefined ? [] : [coverage.warning];
    const report = QualityGateReportSchema.parse({
      adapter: "quality-gate-runner-v1",
      runId: run.id,
      projectRoot: run.projectRoot,
      packageManager: plan.packageManager,
      status: failedChecks.length === 0 ? "passed" : "failed",
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      gateCount: checks.length,
      passedCount: checks.filter((check) => check.status === "passed").length,
      failedCount: failedChecks.length,
      skippedCount: checks.filter((check) => check.status === "skipped").length,
      checks,
      ...(coverage.coverageSummary === undefined
        ? {}
        : { coverageSummary: coverage.coverageSummary }),
      ...(produced.coverageArtifactId === undefined
        ? {}
        : { coverageArtifactId: produced.coverageArtifactId }),
      warnings,
    });
    const reportArtifacts = await this.writeReportArtifacts({
      report,
      createdAt: completedAt,
    });
    const gaps = failedChecks.map((check) => gapFromFailedCheck(check, completedAt));
    const artifactIds = [
      reportArtifacts.json.id,
      reportArtifacts.markdown.id,
      ...produced.artifacts.map((artifact) => artifact.id),
    ];
    const agentResult = AgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: createAgentResultId(),
      runId: run.id,
      kind: "verification",
      agent: "evidence-verifier",
      status: report.status,
      baseSha: run.baseCommit ?? "0000000",
      changedFiles: [],
      evidenceIds: [],
      artifactIds,
      gapIds: gaps.map((gap) => gap.id),
      checks,
      decisions: [],
      startedAt,
      completedAt,
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: completedAt,
      artifacts: [
        ...run.artifacts,
        reportArtifacts.json,
        reportArtifacts.markdown,
        ...produced.artifacts,
      ],
      gaps: [...run.gaps, ...gaps],
      agentResults: [...run.agentResults, agentResult],
    });

    await this.runStore.save(nextRun, run.revision);

    return RunQualityGatesResultSchema.parse({
      run: summarizeRun(nextRun),
      status: report.status,
      reportArtifactId: reportArtifacts.json.id,
      markdownReportArtifactId: reportArtifacts.markdown.id,
      ...(produced.coverageArtifactId === undefined
        ? {}
        : { coverageArtifactId: produced.coverageArtifactId }),
      agentResultId: agentResult.id,
      gateCount: report.gateCount,
      passedCount: report.passedCount,
      failedCount: report.failedCount,
      skippedCount: report.skippedCount,
      checkIds: checks.map((check) => check.id),
      gapIds: gaps.map((gap) => gap.id),
    });
  }

  private async writeExecutionArtifacts(input: {
    executions: QualityGateExecution[];
    createdAt: string;
    coverageSummary?: QualityGateReport["coverageSummary"];
  }): Promise<ProducedArtifacts> {
    const artifacts: ArtifactRef[] = [];

    for (const execution of input.executions) {
      artifacts.push(
        await this.writeArtifact({
          label: `quality-gate-${execution.gate}-report`,
          kind: "test-report",
          mediaType: "application/json",
          value: execution,
          createdAt: input.createdAt,
          metadata: {
            adapter: "quality-gate-runner-v1",
            reportKind: "gate-report",
            gate: execution.gate,
            status: execution.status,
          },
        }),
      );

      if (execution.stdout.length > 0) {
        artifacts.push(
          await this.writeTextArtifact({
            label: `quality-gate-${execution.gate}-stdout`,
            mediaType: "text/plain",
            content: execution.stdout,
            createdAt: input.createdAt,
            metadata: {
              adapter: "quality-gate-runner-v1",
              reportKind: "stdout",
              gate: execution.gate,
              stream: "stdout",
            },
          }),
        );
      }

      if (execution.stderr.length > 0) {
        artifacts.push(
          await this.writeTextArtifact({
            label: `quality-gate-${execution.gate}-stderr`,
            mediaType: "text/plain",
            content: execution.stderr,
            createdAt: input.createdAt,
            metadata: {
              adapter: "quality-gate-runner-v1",
              reportKind: "stderr",
              gate: execution.gate,
              stream: "stderr",
            },
          }),
        );
      }
    }

    if (input.coverageSummary !== undefined) {
      const coverageArtifact = await this.writeArtifact({
        label: "quality-gate-coverage-summary",
        kind: "coverage-report",
        mediaType: "application/json",
        value: input.coverageSummary,
        createdAt: input.createdAt,
        metadata: {
          adapter: "quality-gate-runner-v1",
          reportKind: "coverage-summary",
          sourcePath: input.coverageSummary.path,
        },
      });

      artifacts.push(coverageArtifact);

      return {
        artifacts,
        coverageArtifactId: coverageArtifact.id,
      };
    }

    return { artifacts };
  }

  private async writeReportArtifacts(input: { report: QualityGateReport; createdAt: string }) {
    const json = await this.writeArtifact({
      label: "quality-gate-report",
      kind: "test-report",
      mediaType: "application/json",
      value: input.report,
      createdAt: input.createdAt,
      metadata: {
        adapter: "quality-gate-runner-v1",
        reportKind: "quality-gate-report",
        status: input.report.status,
        failedCount: input.report.failedCount,
        skippedCount: input.report.skippedCount,
      },
    });
    const markdown = await this.writeTextArtifact({
      label: "quality-gate-report-markdown",
      mediaType: "text/markdown",
      content: renderQualityGateReportMarkdown(input.report),
      createdAt: input.createdAt,
      metadata: {
        adapter: "quality-gate-runner-v1",
        reportKind: "quality-gate-report-markdown",
        status: input.report.status,
      },
    });

    return {
      json,
      markdown,
    };
  }

  private async writeArtifact(input: {
    label: string;
    kind: ArtifactRef["kind"];
    mediaType: string;
    value: unknown;
    createdAt: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    return this.writeTextArtifact({
      label: input.label,
      kind: input.kind,
      mediaType: input.mediaType,
      content: `${JSON.stringify(input.value, null, 2)}\n`,
      createdAt: input.createdAt,
      metadata: input.metadata,
    });
  }

  private async writeTextArtifact(input: {
    label: string;
    kind?: ArtifactRef["kind"];
    mediaType: string;
    content: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: input.mediaType,
      storedAt: input.createdAt,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: input.kind ?? "log",
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

function checkFromExecution(input: {
  projectRoot: string;
  execution: QualityGateExecution;
  reportArtifactId?: string;
  stdoutArtifactId?: string;
  stderrArtifactId?: string;
}): CheckResult {
  const command =
    input.execution.command === undefined
      ? undefined
      : [input.execution.command, ...input.execution.args].join(" ");
  const workingDirectory =
    input.execution.cwd === undefined
      ? undefined
      : relativeWorkingDirectory(input.projectRoot, input.execution.cwd);

  return CheckResultSchema.parse({
    id: createCheckId(),
    name: input.execution.gate,
    kind: input.execution.kind,
    status: input.execution.status,
    ...(command === undefined ? {} : { command }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(input.execution.exitCode === undefined ? {} : { exitCode: input.execution.exitCode }),
    ...(input.execution.startedAt === undefined ? {} : { startedAt: input.execution.startedAt }),
    ...(input.execution.completedAt === undefined
      ? {}
      : { completedAt: input.execution.completedAt }),
    ...(input.execution.durationMs === undefined ? {} : { durationMs: input.execution.durationMs }),
    ...(input.reportArtifactId === undefined ? {} : { reportArtifactId: input.reportArtifactId }),
    ...(input.stdoutArtifactId === undefined ? {} : { stdoutArtifactId: input.stdoutArtifactId }),
    ...(input.stderrArtifactId === undefined ? {} : { stderrArtifactId: input.stderrArtifactId }),
    summary: input.execution.summary,
    ...(input.execution.failureReason === undefined
      ? {}
      : { failureReason: input.execution.failureReason }),
    ...(input.execution.skipReason === undefined ? {} : { skipReason: input.execution.skipReason }),
  });
}

function checkInputFromExecution(input: {
  projectRoot: string;
  execution: QualityGateExecution;
  artifacts: ArtifactRef[];
}): Parameters<typeof checkFromExecution>[0] {
  const reportArtifactId = reportArtifactForGate(input.artifacts, input.execution.gate)?.id;
  const stdoutArtifactId = logArtifactForGate(input.artifacts, input.execution.gate, "stdout")?.id;
  const stderrArtifactId = logArtifactForGate(input.artifacts, input.execution.gate, "stderr")?.id;

  return {
    projectRoot: input.projectRoot,
    execution: input.execution,
    ...(reportArtifactId === undefined ? {} : { reportArtifactId }),
    ...(stdoutArtifactId === undefined ? {} : { stdoutArtifactId }),
    ...(stderrArtifactId === undefined ? {} : { stderrArtifactId }),
  };
}

function gapFromFailedCheck(check: CheckResult, timestamp: string): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: ["unit", "component", "contract", "acceptance"].includes(check.kind)
      ? "test"
      : "implementation",
    severity: ["typecheck", "build", "contract", "acceptance"].includes(check.kind)
      ? "blocker"
      : "major",
    status: "open",
    title: `Quality gate failed: ${check.name}`,
    expected: `${check.name} quality gate should pass.`,
    observed: check.failureReason ?? check.summary,
    impact: "Failed quality gates block reliable verification and publishing.",
    sourceEvidenceIds: [],
    owner: "integrator",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      checkId: check.id,
      checkKind: check.kind,
      command: check.command,
    },
  });
}

function reportArtifactForGate(artifacts: ArtifactRef[], gate: string): ArtifactRef | undefined {
  return artifacts.find(
    (artifact) =>
      artifact.metadata["reportKind"] === "gate-report" && artifact.metadata["gate"] === gate,
  );
}

function logArtifactForGate(
  artifacts: ArtifactRef[],
  gate: string,
  stream: "stdout" | "stderr",
): ArtifactRef | undefined {
  return artifacts.find(
    (artifact) => artifact.metadata["reportKind"] === stream && artifact.metadata["gate"] === gate,
  );
}

function relativeWorkingDirectory(projectRoot: string, cwd: string): string | undefined {
  const relative = path.relative(projectRoot, cwd) || ".";

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }

  return relative;
}
