import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import {
  OpenSpecArchiveExecutionResultSchema,
  type OpenSpecArchiveExecutionResult,
  type OpenSpecArchivePlan,
} from "./archive-contracts.js";

const execFileAsync = promisify(execFile);

export type ArchiveCommandRunner = (
  cwd: string,
  command: string,
  args: string[],
) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

export async function executeOpenSpecArchive(input: {
  plan: OpenSpecArchivePlan;
  projectRoot: string;
  artifactStore: ArtifactBlobStore;
  startedAt: string;
  completedAt: string;
  commandRunner?: ArchiveCommandRunner;
}): Promise<{
  result: OpenSpecArchiveExecutionResult;
  artifacts: Array<ReturnType<typeof ArtifactRefSchema.parse>>;
}> {
  if (!input.plan.canExecute) {
    return {
      result: OpenSpecArchiveExecutionResultSchema.parse({
        runId: input.plan.runId,
        changeName: input.plan.changeName,
        status: "blocked",
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        command: input.plan.command,
        summary:
          "Archive plan is not executable because one or more blocking preconditions failed.",
      }),
      artifacts: [],
    };
  }

  const [command, ...args] = input.plan.command;

  if (command !== "openspec") {
    throw new Error(`Unsupported archive command: ${command}`);
  }

  try {
    const execution = await (input.commandRunner ?? defaultArchiveCommandRunner)(
      input.projectRoot,
      command,
      args,
    );
    const stdoutArtifact = await writeLogArtifact({
      store: input.artifactStore,
      label: "openspec-archive-stdout",
      content: execution.stdout,
      storedAt: input.completedAt,
    });
    const stderrArtifact = await writeLogArtifact({
      store: input.artifactStore,
      label: "openspec-archive-stderr",
      content: execution.stderr,
      storedAt: input.completedAt,
    });
    const status = execution.exitCode === 0 ? "passed" : "failed";

    return {
      result: OpenSpecArchiveExecutionResultSchema.parse({
        runId: input.plan.runId,
        changeName: input.plan.changeName,
        status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        command: input.plan.command,
        exitCode: execution.exitCode,
        stdoutArtifactId: stdoutArtifact.id,
        stderrArtifactId: stderrArtifact.id,
        ...(status === "passed" ? { archivePath: input.plan.expectedArchiveRoot } : {}),
        summary:
          status === "passed"
            ? `Archived OpenSpec change ${input.plan.changeName}.`
            : `OpenSpec archive failed with exit code ${execution.exitCode}.`,
      }),
      artifacts: [stdoutArtifact, stderrArtifact],
    };
  } catch (error: unknown) {
    const stdout = getErrorText(error, "stdout");
    const stderr = getErrorText(error, "stderr") || errorMessage(error);
    const artifacts = [
      await writeLogArtifact({
        store: input.artifactStore,
        label: "openspec-archive-stdout",
        content: stdout,
        storedAt: input.completedAt,
      }),
      await writeLogArtifact({
        store: input.artifactStore,
        label: "openspec-archive-stderr",
        content: stderr,
        storedAt: input.completedAt,
      }),
    ];

    return {
      result: OpenSpecArchiveExecutionResultSchema.parse({
        runId: input.plan.runId,
        changeName: input.plan.changeName,
        status: "failed",
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        command: input.plan.command,
        exitCode: getExitCode(error),
        stdoutArtifactId: artifacts[0]?.id,
        stderrArtifactId: artifacts[1]?.id,
        summary: `OpenSpec archive failed: ${errorMessage(error)}`,
      }),
      artifacts,
    };
  }
}

async function defaultArchiveCommandRunner(
  cwd: string,
  command: string,
  args: string[],
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const execution = await execFileAsync(command, args, {
    cwd,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });

  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: 0,
  };
}

async function writeLogArtifact(input: {
  store: ArtifactBlobStore;
  label: string;
  content: string;
  storedAt: string;
}) {
  const blob = await input.store.writeBlob({
    content: Buffer.from(input.content, "utf8"),
    mediaType: "text/plain",
    storedAt: input.storedAt,
    label: input.label,
  });

  return ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: "log",
    uri: blob.uri,
    mediaType: "text/plain",
    digest: blob.digest,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: input.storedAt,
    metadata: {
      adapter: "openspec-archive-runner-v1",
      label: input.label,
      reportKind: "openspec-archive-log",
    },
  });
}

function getExitCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === "number" ? code : undefined;
  }

  return undefined;
}

function getErrorText(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return "";
  }

  const value = (error as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
