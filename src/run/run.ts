import { z } from "zod";

import {
  AgentResultSchema,
  ArtifactRefSchema,
  EvidenceRefSchema,
  GapSchema,
  RUNTIME_CONTRACT_VERSION,
  SourceRefSchema,
} from "../runtime/index.js";
import {
  AgentResultIdSchema,
  ArtifactIdSchema,
  EvidenceIdSchema,
  GapIdSchema,
  RunIdSchema,
  SourceIdSchema,
} from "../runtime/ids.js";
import {
  GitObjectIdSchema,
  IsoDateTimeSchema,
  RuntimeContractVersionSchema,
} from "../runtime/scalars.js";
import { createInitialStageStates, RUN_STAGE_NAMES, StageStateSchema } from "./stages.js";

export const RunStatusSchema = z.enum([
  "created",
  "running",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

export const RunManifestSchema = z
  .object({
    schemaVersion: RuntimeContractVersionSchema,
    id: RunIdSchema,
    pluginVersion: z.string().trim().min(1),
    projectRoot: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema.optional(),
    status: RunStatusSchema,
    revision: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    sources: z.array(SourceRefSchema).default([]),
    evidence: z.array(EvidenceRefSchema).default([]),
    artifacts: z.array(ArtifactRefSchema).default([]),
    gaps: z.array(GapSchema).default([]),
    agentResults: z.array(AgentResultSchema).default([]),
    stages: z.array(StageStateSchema),
  })
  .strict()
  .superRefine((run, context) => {
    if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt must be after createdAt",
        path: ["updatedAt"],
      });
    }

    addUniqueValueIssues(
      "sources",
      run.sources.map((source) => source.id),
      context,
    );

    addUniqueValueIssues(
      "evidence",
      run.evidence.map((evidence) => evidence.id),
      context,
    );

    addUniqueValueIssues(
      "artifacts",
      run.artifacts.map((artifact) => artifact.id),
      context,
    );

    addUniqueValueIssues(
      "gaps",
      run.gaps.map((gap) => gap.id),
      context,
    );

    addUniqueValueIssues(
      "agentResults",
      run.agentResults.map((result) => result.id),
      context,
    );

    const stageNames = run.stages.map((stage) => stage.name);
    addUniqueValueIssues("stages", stageNames, context);

    const presentStages = new Set(stageNames);

    RUN_STAGE_NAMES.forEach((stageName) => {
      if (!presentStages.has(stageName)) {
        context.addIssue({
          code: "custom",
          message: `Missing required stage ${stageName}`,
          path: ["stages"],
        });
      }
    });

    const sourceIds = new Set(run.sources.map((source) => source.id));
    const evidenceIds = new Set(run.evidence.map((evidence) => evidence.id));
    const artifactIds = new Set(run.artifacts.map((artifact) => artifact.id));
    const gapIds = new Set(run.gaps.map((gap) => gap.id));

    run.evidence.forEach((evidence, evidenceIndex) => {
      if (!sourceIds.has(evidence.sourceId)) {
        addReferenceIssue(context, ["evidence", evidenceIndex, "sourceId"], {
          kind: "source",
          id: evidence.sourceId,
        });
      }
    });

    run.artifacts.forEach((artifact, artifactIndex) => {
      artifact.evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIds.has(evidenceId)) {
          addReferenceIssue(context, ["artifacts", artifactIndex, "evidenceIds", evidenceIndex], {
            kind: "evidence",
            id: evidenceId,
          });
        }
      });
    });

    run.gaps.forEach((gap, gapIndex) => {
      gap.sourceEvidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIds.has(evidenceId)) {
          addReferenceIssue(context, ["gaps", gapIndex, "sourceEvidenceIds", evidenceIndex], {
            kind: "evidence",
            id: evidenceId,
          });
        }
      });

      gap.resolutionArtifactIds.forEach((artifactId, artifactIndex) => {
        if (!artifactIds.has(artifactId)) {
          addReferenceIssue(context, ["gaps", gapIndex, "resolutionArtifactIds", artifactIndex], {
            kind: "artifact",
            id: artifactId,
          });
        }
      });
    });

    run.stages.forEach((stage, stageIndex) => {
      stage.artifactIds.forEach((artifactId, artifactIndex) => {
        if (!artifactIds.has(artifactId)) {
          addReferenceIssue(context, ["stages", stageIndex, "artifactIds", artifactIndex], {
            kind: "artifact",
            id: artifactId,
          });
        }
      });

      stage.gapIds.forEach((gapId, gapIndex) => {
        if (!gapIds.has(gapId)) {
          addReferenceIssue(context, ["stages", stageIndex, "gapIds", gapIndex], {
            kind: "gap",
            id: gapId,
          });
        }
      });
    });

    run.agentResults.forEach((result, resultIndex) => {
      if (result.runId !== run.id) {
        context.addIssue({
          code: "custom",
          message: "Agent result runId must match the parent run id",
          path: ["agentResults", resultIndex, "runId"],
        });
      }

      result.evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIds.has(evidenceId)) {
          addReferenceIssue(context, ["agentResults", resultIndex, "evidenceIds", evidenceIndex], {
            kind: "evidence",
            id: evidenceId,
          });
        }
      });

      result.artifactIds.forEach((artifactId, artifactIndex) => {
        if (!artifactIds.has(artifactId)) {
          addReferenceIssue(context, ["agentResults", resultIndex, "artifactIds", artifactIndex], {
            kind: "artifact",
            id: artifactId,
          });
        }
      });

      result.gapIds.forEach((gapId, gapIndex) => {
        if (!gapIds.has(gapId)) {
          addReferenceIssue(context, ["agentResults", resultIndex, "gapIds", gapIndex], {
            kind: "gap",
            id: gapId,
          });
        }
      });

      result.checks.forEach((check, checkIndex) => {
        const checkArtifactReferences = [
          ["reportArtifactId", check.reportArtifactId],
          ["stdoutArtifactId", check.stdoutArtifactId],
          ["stderrArtifactId", check.stderrArtifactId],
        ] as const;

        checkArtifactReferences.forEach(([field, artifactId]) => {
          if (artifactId !== undefined && !artifactIds.has(artifactId)) {
            addReferenceIssue(context, ["agentResults", resultIndex, "checks", checkIndex, field], {
              kind: "artifact",
              id: artifactId,
            });
          }
        });
      });

      result.decisions.forEach((decision, decisionIndex) => {
        decision.evidenceIds.forEach((evidenceId, evidenceIndex) => {
          if (!evidenceIds.has(evidenceId)) {
            addReferenceIssue(
              context,
              [
                "agentResults",
                resultIndex,
                "decisions",
                decisionIndex,
                "evidenceIds",
                evidenceIndex,
              ],
              {
                kind: "evidence",
                id: evidenceId,
              },
            );
          }
        });
      });

      if (
        result.kind === "publishing" &&
        result.reportArtifactId !== undefined &&
        !artifactIds.has(result.reportArtifactId)
      ) {
        addReferenceIssue(context, ["agentResults", resultIndex, "reportArtifactId"], {
          kind: "artifact",
          id: result.reportArtifactId,
        });
      }
    });
  });

export const RunSummarySchema = z
  .object({
    schemaVersion: RuntimeContractVersionSchema,
    id: RunIdSchema,
    pluginVersion: z.string().trim().min(1),
    projectRoot: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema.optional(),
    status: RunStatusSchema,
    revision: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    stageCount: z.number().int().nonnegative(),
    gapCount: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    agentResultCount: z.number().int().nonnegative(),
  })
  .strict();

export const CreateInitialRunInputSchema = z
  .object({
    sources: z.array(SourceRefSchema).default([]),
    baseCommit: GitObjectIdSchema.optional(),
  })
  .strict();

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type CreateInitialRunInput = z.infer<typeof CreateInitialRunInputSchema>;

export function createInitialRun(
  rawInput: CreateInitialRunInput,
  options: {
    id: z.infer<typeof RunIdSchema>;
    pluginVersion: string;
    projectRoot: string;
    now: string;
  },
): RunManifest {
  const input = CreateInitialRunInputSchema.parse(rawInput);

  return RunManifestSchema.parse({
    schemaVersion: RUNTIME_CONTRACT_VERSION,
    id: options.id,
    pluginVersion: options.pluginVersion,
    projectRoot: options.projectRoot,
    ...(input.baseCommit === undefined ? {} : { baseCommit: input.baseCommit }),
    status: "created",
    revision: 0,
    createdAt: options.now,
    updatedAt: options.now,
    sources: input.sources,
    evidence: [],
    artifacts: [],
    gaps: [],
    agentResults: [],
    stages: createInitialStageStates(),
  });
}

export function summarizeRun(run: RunManifest): RunSummary {
  return RunSummarySchema.parse({
    schemaVersion: run.schemaVersion,
    id: run.id,
    pluginVersion: run.pluginVersion,
    projectRoot: run.projectRoot,
    ...(run.baseCommit === undefined ? {} : { baseCommit: run.baseCommit }),
    status: run.status,
    revision: run.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    stageCount: run.stages.length,
    gapCount: run.gaps.length,
    artifactCount: run.artifacts.length,
    evidenceCount: run.evidence.length,
    agentResultCount: run.agentResults.length,
  });
}

function addUniqueValueIssues(
  collectionName: string,
  values: string[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();

  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ${collectionName} value ${value}`,
        path: [collectionName, index],
      });
      return;
    }

    seen.add(value);
  });
}

function addReferenceIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  reference: {
    kind: "source" | "evidence" | "artifact" | "gap";
    id:
      | z.infer<typeof SourceIdSchema>
      | z.infer<typeof EvidenceIdSchema>
      | z.infer<typeof ArtifactIdSchema>
      | z.infer<typeof GapIdSchema>
      | z.infer<typeof AgentResultIdSchema>;
  },
): void {
  context.addIssue({
    code: "custom",
    message: `Unknown ${reference.kind} reference ${reference.id}`,
    path,
  });
}
