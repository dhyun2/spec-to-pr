import { readFile } from "node:fs/promises";

import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { generateGherkinAndTestMatrix } from "../gherkin/gherkin-generator.js";
import { renderGherkinArtifacts } from "../gherkin/gherkin-renderer.js";
import type { RenderedGherkinArtifacts } from "../gherkin/gherkin-renderer.js";
import { writeGherkinArtifacts } from "../gherkin/gherkin-writer.js";
import { OpenSpecChangeModelSchema } from "../openspec/openspec-model.js";
import {
  OpenSpecChangeNameSchema,
  resolveOpenSpecChangePaths,
  toOpenSpecChangeName,
} from "../openspec/openspec-paths.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const GenerateGherkinTestMatrixInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(3),
    force: z.boolean().default(false),
    writeToProject: z.boolean().default(false),
  })
  .strict();

export const GenerateGherkinTestMatrixResultSchema = z
  .object({
    duplicate: z.boolean(),
    run: z.custom<ReturnType<typeof summarizeRun>>(),
    changeName: OpenSpecChangeNameSchema,
    artifactIds: z.array(ArtifactIdSchema),
    changedFiles: z.array(z.string()),
    requirementCount: z.number().int().nonnegative(),
    scenarioCount: z.number().int().nonnegative(),
    automatedCandidateCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
  })
  .strict();

export class GherkinTestMatrixService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generate(rawInput: unknown) {
    const input = GenerateGherkinTestMatrixInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const changeName = toOpenSpecChangeName(input.changeName);

    const existingMatrix = run.artifacts.find(
      (artifact) =>
        artifact.kind === "test-matrix" &&
        artifact.metadata["changeName"] === changeName &&
        artifactPathFor(artifact) === changeArtifactPath(changeName, "artifacts/test-matrix.json"),
    );

    if (existingMatrix !== undefined && !input.force) {
      return GenerateGherkinTestMatrixResultSchema.parse({
        duplicate: true,
        run: summarizeRun(run),
        changeName,
        artifactIds: [existingMatrix.id],
        changedFiles: [],
        requirementCount: 0,
        scenarioCount: 0,
        automatedCandidateCount: 0,
        blockedCount: 0,
      });
    }

    const model = await this.readOpenSpecChangeModel(run, changeName);

    const generated = generateGherkinAndTestMatrix({
      model,
      gaps: run.gaps,
    });

    const rendered = renderGherkinArtifacts(generated);

    const writeResult =
      input.writeToProject === true
        ? await writeGherkinArtifacts({
            projectRoot: run.projectRoot,
            changeName,
            rendered,
            generatedAt: timestamp,
            force: input.force,
          })
        : await this.writeGherkinArtifactsToStore({
            changeName,
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

    return GenerateGherkinTestMatrixResultSchema.parse({
      duplicate: false,
      run: summarizeRun(nextRun),
      changeName,
      artifactIds: writeResult.artifactRefs.map((artifact) => artifact.id),
      changedFiles: writeResult.files
        .filter((file) => file.changed)
        .map((file) => file.relativePath),
      requirementCount: generated.matrix.requirementCount,
      scenarioCount: generated.matrix.scenarioCount,
      automatedCandidateCount: generated.matrix.automatedCandidateCount,
      blockedCount: generated.matrix.blockedCount,
    });
  }

  private async readOpenSpecChangeModel(
    run: {
      projectRoot: string;
      artifacts: Array<{ kind: string; digest: string; metadata: Record<string, unknown> }>;
    },
    changeName: string,
  ) {
    const artifactPath = changeArtifactPath(changeName, "artifacts/change-manifest.json");
    const manifestArtifact = run.artifacts.find(
      (artifact) => artifact.kind === "openspec" && artifactPathFor(artifact) === artifactPath,
    );

    if (manifestArtifact !== undefined) {
      const content = await this.artifactStore.readContent(manifestArtifact.digest as never);

      return OpenSpecChangeModelSchema.parse(JSON.parse(content.toString("utf8")));
    }

    const paths = resolveOpenSpecChangePaths({
      projectRoot: run.projectRoot,
      changeName: OpenSpecChangeNameSchema.parse(changeName),
    });

    const raw = await readFile(paths.manifestPath, "utf8");

    return OpenSpecChangeModelSchema.parse(JSON.parse(raw));
  }

  private async writeGherkinArtifactsToStore(input: {
    changeName: string;
    rendered: RenderedGherkinArtifacts;
    generatedAt: string;
  }) {
    const files = renderedGherkinArtifactFiles(input.changeName, input.rendered);
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
          kind: file.kind,
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

function renderedGherkinArtifactFiles(
  changeName: string,
  rendered: RenderedGherkinArtifacts,
): Array<{
  artifactPath: string;
  content: string;
  mediaType: string;
  kind: "gherkin" | "test-matrix";
}> {
  return [
    ...rendered.featureFiles.map((file) => ({
      artifactPath: changeArtifactPath(changeName, `artifacts/gherkin/${file.fileName}`),
      content: file.content,
      mediaType: "text/x-gherkin",
      kind: "gherkin" as const,
    })),
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/gherkin-index.json"),
      content: rendered.gherkinIndexJson,
      mediaType: "application/json",
      kind: "gherkin" as const,
    },
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/test-matrix.json"),
      content: rendered.testMatrixJson,
      mediaType: "application/json",
      kind: "test-matrix" as const,
    },
    {
      artifactPath: changeArtifactPath(changeName, "artifacts/test-matrix.md"),
      content: rendered.testMatrixMd,
      mediaType: "text/markdown",
      kind: "test-matrix" as const,
    },
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
