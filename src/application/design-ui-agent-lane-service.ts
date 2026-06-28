import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { worktreePathFor } from "../agent-runtime/worktree-manager.js";
import {
  buildDesignUiContextPack,
  createAllowedFilesPolicy,
  createForbiddenImportsPolicy,
} from "../design-ui/design-ui-context-builder.js";
import {
  DesignUiAllowedFilesSchema,
  DesignUiContextPackSchema,
  DesignUiForbiddenImportsSchema,
} from "../design-ui/design-ui-context.js";
import { validateDesignUiAgentResult } from "../design-ui/design-ui-result-validator.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema, ImplementationAgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RunStore } from "../store/run-store.js";

export const PrepareDesignUiAgentInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    worktreePath: z.string().trim().min(1).optional(),
    contextRoot: z.string().trim().min(1).optional(),
    designContractArtifactId: ArtifactIdSchema.optional(),
    figmaInventoryArtifactId: ArtifactIdSchema.optional(),
    openSpecArtifactIds: z.array(ArtifactIdSchema).default([]),
    gherkinArtifactIds: z.array(ArtifactIdSchema).default([]),
    apiContractArtifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict();

export const GetDesignUiAgentContextInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1).optional(),
    contextArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const RecordDesignUiAgentResultInputSchema = z
  .object({
    runId: RunIdSchema,
    contextArtifactId: ArtifactIdSchema.optional(),
    result: AgentResultSchema,
  })
  .strict();

export const PrepareDesignUiAgentResultSchema = z
  .object({
    run: RunSummarySchema,
    context: DesignUiContextPackSchema,
    contextArtifactId: ArtifactIdSchema,
  })
  .strict();

export const GetDesignUiAgentContextResultSchema = DesignUiContextPackSchema;

export const RecordDesignUiAgentResultSchema = z
  .object({
    run: RunSummarySchema,
    result: ImplementationAgentResultSchema,
  })
  .strict();

export class DesignUiAgentLaneService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly dataDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async prepare(rawInput: unknown) {
    const input = PrepareDesignUiAgentInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const designContractArtifactId =
      input.designContractArtifactId ??
      latestArtifactId(run.artifacts, ["figma-design-contract", "figma-design-context"]);

    if (designContractArtifactId === undefined) {
      throw new Error(`Design contract artifact not found for run ${run.id}`);
    }

    assertArtifactExists(run, designContractArtifactId);

    const figmaInventoryArtifactId =
      input.figmaInventoryArtifactId ?? latestArtifactId(run.artifacts, ["figma-design-inventory"]);

    if (figmaInventoryArtifactId !== undefined) {
      assertArtifactExists(run, figmaInventoryArtifactId);
    }

    const openSpecArtifactIds =
      input.openSpecArtifactIds.length > 0
        ? input.openSpecArtifactIds
        : artifactIdsByKind(run.artifacts, [
            "openspec",
            "requirement-graph",
            "traceability-matrix",
          ]);
    const gherkinArtifactIds =
      input.gherkinArtifactIds.length > 0
        ? input.gherkinArtifactIds
        : artifactIdsByKind(run.artifacts, ["gherkin", "test-matrix"]);
    const apiContractArtifactIds =
      input.apiContractArtifactIds.length > 0
        ? input.apiContractArtifactIds
        : artifactIdsByKind(run.artifacts, ["api-contract-report", "agent-context-pack"]).filter(
            (artifactId) => artifactId !== undefined,
          );

    for (const artifactId of [
      ...openSpecArtifactIds,
      ...gherkinArtifactIds,
      ...apiContractArtifactIds,
    ]) {
      assertArtifactExists(run, artifactId);
    }

    const worktreePath =
      input.worktreePath ?? worktreePathFor(run.projectRoot, run.id, "design-ui");
    const contextRoot = input.contextRoot ?? path.join(this.dataDirectory, "agent-contexts");
    const context = await buildDesignUiContextPack({
      runId: run.id,
      changeName: input.changeName,
      worktreePath,
      contextRoot,
      designContractArtifactId,
      ...(figmaInventoryArtifactId === undefined ? {} : { figmaInventoryArtifactId }),
      openSpecArtifactIds,
      gherkinArtifactIds,
      apiContractArtifactIds,
      evidenceIds: collectEvidenceIds(run, [
        designContractArtifactId,
        figmaInventoryArtifactId,
        ...openSpecArtifactIds,
        ...gherkinArtifactIds,
        ...apiContractArtifactIds,
      ]),
      gapIds: run.gaps.map((gap) => gap.id),
    });
    const contextJsonPath = path.join(context.contextRoot, "context-pack.json");
    const contextJson = `${JSON.stringify(context, null, 2)}\n`;
    await writeFile(contextJsonPath, contextJson, {
      encoding: "utf8",
      mode: 0o600,
    });

    const contextArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "agent-context-pack",
      uri: `file://${contextJsonPath}`,
      mediaType: "application/json",
      digest: sha256Digest(Buffer.from(contextJson, "utf8")),
      producedBy: "orchestrator",
      evidenceIds: context.evidenceIds,
      createdAt: timestamp,
      metadata: {
        agent: "design-ui",
        changeName: input.changeName,
        artifactRole: "agent-context-pack",
        contextPackPath: context.contextRoot,
        contextJsonPath,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, contextArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return PrepareDesignUiAgentResultSchema.parse({
      run: summarizeRun(nextRun),
      context,
      contextArtifactId: contextArtifact.id,
    });
  }

  public async getContext(rawInput: unknown) {
    const input = GetDesignUiAgentContextInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const artifact = findContextArtifact(run.artifacts, {
      agent: "design-ui",
      ...(input.contextArtifactId === undefined
        ? {}
        : { contextArtifactId: input.contextArtifactId }),
      ...(input.changeName === undefined ? {} : { changeName: input.changeName }),
    });

    if (artifact === undefined) {
      throw new Error(`Design/UI context pack not prepared for run ${input.runId}`);
    }

    const contextJsonPath = metadataString(artifact.metadata["contextJsonPath"]);

    if (contextJsonPath === undefined) {
      throw new Error(`Design/UI context artifact is missing contextJsonPath: ${artifact.id}`);
    }

    const rawContext = await readFile(contextJsonPath, "utf8");

    return GetDesignUiAgentContextResultSchema.parse(JSON.parse(rawContext));
  }

  public async recordResult(rawInput: unknown) {
    const input = RecordDesignUiAgentResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const context = await this.getContext({
      runId: input.runId,
      ...(input.contextArtifactId === undefined
        ? {}
        : { contextArtifactId: input.contextArtifactId }),
    });
    const result = AgentResultSchema.parse(input.result);

    if (result.kind !== "implementation" || result.agent !== "design-ui") {
      throw new Error("Expected implementation result from design-ui agent");
    }

    const validation = await validateDesignUiAgentResult({
      result,
      allowedFiles: createAllowedFilesPolicy(),
      forbiddenImports: createForbiddenImportsPolicy(),
      worktreePath: context.worktreePath,
    });

    if (!validation.valid) {
      throw new Error(
        `Invalid Design/UI Agent result: ${validation.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const timestamp = IsoDateTimeSchema.parse(this.now());
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      agentResults: [...run.agentResults, result],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordDesignUiAgentResultSchema.parse({
      run: summarizeRun(nextRun),
      result,
    });
  }
}

function assertArtifactExists(run: Awaited<ReturnType<RunStore["get"]>>, artifactId: string): void {
  if (!run.artifacts.some((artifact) => artifact.id === artifactId)) {
    throw new Error(`Artifact not found in Run: ${artifactId}`);
  }
}

function collectEvidenceIds(
  run: Awaited<ReturnType<RunStore["get"]>>,
  artifactIds: Array<string | undefined>,
): string[] {
  const idSet = new Set(artifactIds.filter((id): id is string => id !== undefined));
  const evidence = new Set<string>();

  for (const artifact of run.artifacts) {
    if (idSet.has(artifact.id)) {
      artifact.evidenceIds.forEach((id) => evidence.add(id));
    }
  }

  return [...evidence];
}

function latestArtifactId(
  artifacts: Array<{ id: string; kind: string }>,
  kinds: string[],
): string | undefined {
  return [...artifacts].reverse().find((artifact) => kinds.includes(artifact.kind))?.id;
}

function artifactIdsByKind(
  artifacts: Array<{ id: string; kind: string }>,
  kinds: string[],
): string[] {
  return artifacts
    .filter((artifact) => kinds.includes(artifact.kind))
    .map((artifact) => artifact.id);
}

function findContextArtifact(
  artifacts: Array<{
    id: string;
    kind: string;
    metadata: Record<string, unknown>;
  }>,
  input: {
    agent: string;
    contextArtifactId?: string;
    changeName?: string;
  },
) {
  if (input.contextArtifactId !== undefined) {
    return artifacts.find((artifact) => artifact.id === input.contextArtifactId);
  }

  return [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "agent-context-pack" &&
        artifact.metadata["agent"] === input.agent &&
        (input.changeName === undefined || artifact.metadata["changeName"] === input.changeName),
    );
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
