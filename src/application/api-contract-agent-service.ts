import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  ApiContractAgentContextSchema,
  ApiContractAgentRecordedResultSchema,
  ApiContractContextFileSchema,
} from "../api-agent/api-contract-agent-contracts.js";
import { buildApiContractAgentContext } from "../api-agent/api-contract-context-builder.js";
import { validateApiContractAgentResult } from "../api-agent/api-contract-result-validator.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const PrepareApiContractAgentInputSchema = z
  .object({
    runId: RunIdSchema,
    worktreePath: z.string().trim().min(1),
    baseSha: GitObjectIdSchema,
  })
  .strict();

export const GetApiContractAgentContextInputSchema = z
  .object({
    runId: RunIdSchema,
    contextArtifactId: ArtifactIdSchema,
  })
  .strict();

export const RecordApiContractAgentResultInputSchema = z
  .object({
    runId: RunIdSchema,
    contextArtifactId: ArtifactIdSchema,
    result: z.unknown(),
  })
  .strict();

export const PrepareApiContractAgentResultSchema = z
  .object({
    run: RunSummarySchema,
    context: ApiContractAgentContextSchema,
    contextArtifactId: ArtifactIdSchema,
    files: z.array(ApiContractContextFileSchema),
  })
  .strict();

export const GetApiContractAgentContextResultSchema = ApiContractAgentContextSchema;

export const RecordApiContractAgentResultSchema = ApiContractAgentRecordedResultSchema;

export class ApiContractAgentService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly dataDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async prepare(rawInput: unknown) {
    const input = PrepareApiContractAgentInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const outputRoot = path.join(this.dataDirectory, "agent-contexts", run.id);

    const built = await buildApiContractAgentContext({
      run,
      worktreePath: input.worktreePath,
      baseSha: input.baseSha,
      outputRoot,
      preparedAt: timestamp,
    });
    const contextFile = built.files.find((file) => path.basename(file.path) === "context.json");

    if (contextFile === undefined) {
      throw new Error("API Contract Agent context builder did not write context.json");
    }

    const contextArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "agent-context-pack",
      uri: `file://${contextFile.path}`,
      mediaType: "application/json",
      digest: contextFile.digest,
      producedBy: "orchestrator",
      evidenceIds: built.context.evidenceIds,
      createdAt: timestamp,
      metadata: {
        agent: "api-contract",
        artifactRole: "agent-context-pack",
        contextPackPath: built.context.contextPackPath,
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, contextArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return PrepareApiContractAgentResultSchema.parse({
      run: summarizeRun(nextRun),
      context: built.context,
      contextArtifactId: contextArtifact.id,
      files: built.files,
    });
  }

  public async getContext(rawInput: unknown) {
    const input = GetApiContractAgentContextInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const artifact = run.artifacts.find((item) => item.id === input.contextArtifactId);

    if (artifact === undefined) {
      throw new Error(`Context artifact not found: ${input.contextArtifactId}`);
    }

    if (artifact.kind !== "agent-context-pack") {
      throw new Error(`Artifact is not an API Contract Agent context pack: ${artifact.id}`);
    }

    const contextPackPath = artifact.metadata["contextPackPath"];

    if (typeof contextPackPath !== "string") {
      throw new Error("Context artifact is missing contextPackPath metadata");
    }

    const rawContext = await readFile(path.join(contextPackPath, "context.json"), "utf8");

    return GetApiContractAgentContextResultSchema.parse(JSON.parse(rawContext));
  }

  public async recordResult(rawInput: unknown) {
    const input = RecordApiContractAgentResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const context = await this.getContext({
      runId: input.runId,
      contextArtifactId: input.contextArtifactId,
    });
    const validation = validateApiContractAgentResult({
      context,
      result: input.result,
    });

    if (!validation.valid) {
      throw new Error(
        `Invalid API Contract Agent result: ${validation.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const parsedResult = AgentResultSchema.parse(input.result);

    if (parsedResult.kind !== "implementation") {
      throw new Error("API Contract Agent result must be an implementation result.");
    }

    const timestamp = IsoDateTimeSchema.parse(this.now());
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      agentResults: [...run.agentResults, parsedResult],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordApiContractAgentResultSchema.parse({
      resultId: parsedResult.id,
      runId: run.id,
      status: parsedResult.status,
      ...(parsedResult.commitSha === undefined ? {} : { commitSha: parsedResult.commitSha }),
      changedFiles: parsedResult.changedFiles,
      artifactIds: parsedResult.artifactIds,
      evidenceIds: parsedResult.evidenceIds,
      gapIds: parsedResult.gapIds,
      recordedAt: timestamp,
    });
  }
}
