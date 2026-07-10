import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  buildOpenSpecChangeModel,
  parseTraceabilityMatrixLike,
} from "../openspec/openspec-model-builder.js";
import { renderOpenSpecChange } from "../openspec/openspec-renderer.js";
import type { RenderedOpenSpecChange } from "../openspec/openspec-renderer.js";
import { writeOpenSpecChange } from "../openspec/openspec-writer.js";
import { OpenSpecChangeNameSchema, toOpenSpecChangeName } from "../openspec/openspec-paths.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import { RunIdSchema, ArtifactIdSchema } from "../runtime/ids.js";
import { createArtifactId } from "../runtime/id-factory.js";
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
    writeToProject: z.boolean().default(false),
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
      ...(changeName === undefined ? {} : { changeName }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      generatedAt: timestamp,
    });

    const existingOpenSpecArtifact = run.artifacts.find(
      (artifact) =>
        artifact.kind === "openspec" &&
        artifact.metadata["changeName"] === model.changeName &&
        artifactPathFor(artifact) ===
          changeArtifactPath(model.changeName, "artifacts/change-manifest.json"),
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

    const writeResult =
      input.writeToProject === true
        ? await writeOpenSpecChange({
            projectRoot: run.projectRoot,
            changeName: model.changeName,
            rendered,
            generatedAt: timestamp,
            policy: {
              force: input.force,
            },
          })
        : await this.writeOpenSpecArtifacts({
            changeName: model.changeName,
            rendered,
            generatedAt: timestamp,
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

    return parseTraceabilityMatrixLike(parsed);
  }

  private async writeOpenSpecArtifacts(input: {
    changeName: string;
    rendered: RenderedOpenSpecChange;
    generatedAt: string;
  }) {
    const files = renderedOpenSpecArtifactFiles(input.changeName, input.rendered);
    const artifactRefs: ArtifactRef[] = [];

    for (const file of files) {
      const content = Buffer.from(ensureFinalNewline(file.content), "utf8");
      const blob = await this.artifactStore.writeBlob({
        content,
        mediaType: file.mediaType,
        storedAt: input.generatedAt,
        label: file.artifactPath,
      });

      artifactRefs.push(
        ArtifactRefSchema.parse({
          id: createArtifactId(),
          kind: "openspec",
          uri: blob.uri,
          mediaType: file.mediaType,
          digest: blob.digest,
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: input.generatedAt,
          metadata: {
            artifactPath: file.artifactPath,
            relativePath: file.artifactPath,
            changed: false,
            changeName: input.changeName,
            storage: "artifact-store",
          },
        }),
      );
    }

    return {
      files: files.map((file) => ({
        absolutePath: file.artifactPath,
        relativePath: file.artifactPath,
        digest: artifactRefs.find(
          (artifact) => artifact.metadata["artifactPath"] === file.artifactPath,
        )!.digest,
        changed: false,
      })),
      artifactRefs,
    };
  }
}

function renderedOpenSpecArtifactFiles(
  changeName: string,
  rendered: RenderedOpenSpecChange,
): Array<{ artifactPath: string; content: string; mediaType: string }> {
  return [
    {
      artifactPath: changeArtifactPath(changeName, "proposal.md"),
      content: rendered.proposalMd,
      mediaType: "text/markdown",
    },
    {
      artifactPath: changeArtifactPath(changeName, "design.md"),
      content: rendered.designMd,
      mediaType: "text/markdown",
    },
    {
      artifactPath: changeArtifactPath(changeName, "tasks.md"),
      content: rendered.tasksMd,
      mediaType: "text/markdown",
    },
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/evidence-summary.md"),
      content: rendered.evidenceSummaryMd,
      mediaType: "text/markdown",
    },
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/traceability-matrix.md"),
      content: rendered.traceabilityMatrixMd,
      mediaType: "text/markdown",
    },
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/gap-summary.md"),
      content: rendered.gapSummaryMd,
      mediaType: "text/markdown",
    },
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/change-manifest.json"),
      content: rendered.manifestJson,
      mediaType: "application/json",
    },
    ...rendered.specs.map((spec) => ({
      artifactPath: changeArtifactPath(changeName, `specs/${spec.area}/spec.md`),
      content: spec.content,
      mediaType: "text/markdown",
    })),
  ];
}

function changeArtifactPath(changeName: string, suffix: string): string {
  return `openspec/changes/${changeName}/${suffix}`;
}

function artifactPathFor(artifact: { metadata: Record<string, unknown> }): string | undefined {
  const artifactPath = artifact.metadata["artifactPath"];
  const relativePath = artifact.metadata["relativePath"];

  return typeof artifactPath === "string"
    ? artifactPath
    : typeof relativePath === "string"
      ? relativePath
      : undefined;
}

function ensureFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
