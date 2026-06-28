import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  buildOpenSpecChangeModel,
  TraceabilityMatrixLikeSchema,
} from "../openspec/openspec-model-builder.js";
import { renderOpenSpecChange } from "../openspec/openspec-renderer.js";
import { writeOpenSpecChange } from "../openspec/openspec-writer.js";
import { OpenSpecChangeNameSchema, toOpenSpecChangeName } from "../openspec/openspec-paths.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { RunIdSchema, ArtifactIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const GenerateOpenSpecChangeInputSchema = z
  .object({
    runId: RunIdSchema,
    traceabilityArtifactId: ArtifactIdSchema,
    changeName: z.string().trim().min(3).optional(),
    title: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    force: z.boolean().default(false),
  })
  .strict();

export const GenerateOpenSpecChangeResultSchema = z
  .object({
    duplicate: z.boolean(),
    run: z.custom<ReturnType<typeof summarizeRun>>(),
    changeName: OpenSpecChangeNameSchema,
    artifactIds: z.array(ArtifactIdSchema),
    changedFiles: z.array(z.string()),
  })
  .strict();

export class OpenSpecChangeService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generateOpenSpecChange(rawInput: unknown) {
    const input = GenerateOpenSpecChangeInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const traceabilityArtifact = run.artifacts.find(
      (artifact) => artifact.id === input.traceabilityArtifactId,
    );

    if (traceabilityArtifact === undefined) {
      throw new Error(`Traceability artifact not found: ${input.traceabilityArtifactId}`);
    }

    const matrix = await this.readTraceabilityMatrix(traceabilityArtifact.digest);

    const changeName =
      input.changeName === undefined ? undefined : toOpenSpecChangeName(input.changeName);

    const model = buildOpenSpecChangeModel({
      run,
      matrix,
      changeName: changeName ?? "",
      title: input.title ?? "",
      summary: input.summary ?? "",
      generatedAt: timestamp,
    });

    const existingOpenSpecArtifact = run.artifacts.find(
      (artifact) =>
        artifact.kind === "openspec" &&
        artifact.metadata["changeName"] === model.changeName &&
        artifact.metadata["relativePath"] ===
          `openspec/changes/${model.changeName}/artifacts/change-manifest.json`,
    );

    if (existingOpenSpecArtifact !== undefined && !input.force) {
      return GenerateOpenSpecChangeResultSchema.parse({
        duplicate: true,
        run: summarizeRun(run),
        changeName: model.changeName,
        artifactIds: [existingOpenSpecArtifact.id],
        changedFiles: [],
      });
    }

    const rendered = renderOpenSpecChange({
      model,
      run,
    });

    const writeResult = await writeOpenSpecChange({
      projectRoot: run.projectRoot,
      changeName: model.changeName,
      rendered,
      generatedAt: timestamp,
      policy: {
        force: input.force,
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...writeResult.artifactRefs],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateOpenSpecChangeResultSchema.parse({
      duplicate: false,
      run: summarizeRun(nextRun),
      changeName: model.changeName,
      artifactIds: writeResult.artifactRefs.map((artifact) => artifact.id),
      changedFiles: writeResult.files
        .filter((file) => file.changed)
        .map((file) => file.relativePath),
    });
  }

  private async readTraceabilityMatrix(digest: string) {
    const content = await this.artifactStore.readContent(digest as never);
    const parsed = JSON.parse(content.toString("utf8"));

    return TraceabilityMatrixLikeSchema.parse(parsed);
  }
}
