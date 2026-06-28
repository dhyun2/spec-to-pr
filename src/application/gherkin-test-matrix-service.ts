import { readFile } from "node:fs/promises";

import { z } from "zod";

import { generateGherkinAndTestMatrix } from "../gherkin/gherkin-generator.js";
import { renderGherkinArtifacts } from "../gherkin/gherkin-renderer.js";
import { writeGherkinArtifacts } from "../gherkin/gherkin-writer.js";
import { OpenSpecChangeModelSchema } from "../openspec/openspec-model.js";
import {
  OpenSpecChangeNameSchema,
  resolveOpenSpecChangePaths,
  toOpenSpecChangeName,
} from "../openspec/openspec-paths.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const GenerateGherkinTestMatrixInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(3),
    force: z.boolean().default(false),
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
        artifact.metadata["relativePath"] ===
          `openspec/changes/${changeName}/artifacts/test-matrix.json`,
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

    const model = await this.readOpenSpecChangeModel(run.projectRoot, changeName);

    const generated = generateGherkinAndTestMatrix({
      model,
      gaps: run.gaps,
    });

    const rendered = renderGherkinArtifacts(generated);

    const writeResult = await writeGherkinArtifacts({
      projectRoot: run.projectRoot,
      changeName,
      rendered,
      generatedAt: timestamp,
      force: input.force,
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

  private async readOpenSpecChangeModel(projectRoot: string, changeName: string) {
    const paths = resolveOpenSpecChangePaths({
      projectRoot,
      changeName: OpenSpecChangeNameSchema.parse(changeName),
    });

    const raw = await readFile(paths.manifestPath, "utf8");

    return OpenSpecChangeModelSchema.parse(JSON.parse(raw));
  }
}
