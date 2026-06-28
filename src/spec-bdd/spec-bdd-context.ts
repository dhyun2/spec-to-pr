import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  OpenSpecChangeNameSchema,
  resolveOpenSpecChangePaths,
  toRepoRelativePath,
} from "../openspec/openspec-paths.js";
import type { RunManifest } from "../run/index.js";
import { RunIdSchema } from "../runtime/ids.js";

export const SpecBddContextPackSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    projectRoot: z.string().trim().min(1),
    baseRevision: z.number().int().nonnegative(),
    openSpec: z
      .object({
        proposalPath: z.string().trim().min(1),
        designPath: z.string().trim().min(1),
        tasksPath: z.string().trim().min(1),
        manifestPath: z.string().trim().min(1),
        evidenceSummaryPath: z.string().trim().min(1),
        traceabilityMatrixPath: z.string().trim().min(1),
        gapSummaryPath: z.string().trim().min(1),
      })
      .strict(),
    gherkin: z
      .object({
        indexPath: z.string().trim().min(1),
        testMatrixPath: z.string().trim().min(1),
        testMatrixMdPath: z.string().trim().min(1),
        featureDirectory: z.string().trim().min(1),
      })
      .strict(),
    allowedWritePaths: z.array(z.string().trim().min(1)).default([]),
    expectedOutputs: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type SpecBddContextPack = z.infer<typeof SpecBddContextPackSchema>;

export async function buildSpecBddContextPack(input: {
  run: RunManifest;
  changeName: string;
}): Promise<SpecBddContextPack> {
  const changeName = OpenSpecChangeNameSchema.parse(input.changeName);
  const paths = resolveOpenSpecChangePaths({
    projectRoot: input.run.projectRoot,
    changeName,
  });

  const featureDirectory = path.join(paths.artifactsRoot, "gherkin");
  const indexPath = path.join(paths.artifactsRoot, "gherkin-index.json");
  const testMatrixPath = path.join(paths.artifactsRoot, "test-matrix.json");
  const testMatrixMdPath = path.join(paths.artifactsRoot, "test-matrix.md");

  await assertReadable(paths.manifestPath);
  await assertReadable(testMatrixPath);

  return SpecBddContextPackSchema.parse({
    runId: input.run.id,
    changeName,
    projectRoot: input.run.projectRoot,
    baseRevision: input.run.revision,
    openSpec: {
      proposalPath: toRepoRelativePath(input.run.projectRoot, paths.proposalPath),
      designPath: toRepoRelativePath(input.run.projectRoot, paths.designPath),
      tasksPath: toRepoRelativePath(input.run.projectRoot, paths.tasksPath),
      manifestPath: toRepoRelativePath(input.run.projectRoot, paths.manifestPath),
      evidenceSummaryPath: toRepoRelativePath(input.run.projectRoot, paths.evidenceSummaryPath),
      traceabilityMatrixPath: toRepoRelativePath(
        input.run.projectRoot,
        paths.traceabilityMatrixPath,
      ),
      gapSummaryPath: toRepoRelativePath(input.run.projectRoot, paths.gapSummaryPath),
    },
    gherkin: {
      indexPath: toRepoRelativePath(input.run.projectRoot, indexPath),
      testMatrixPath: toRepoRelativePath(input.run.projectRoot, testMatrixPath),
      testMatrixMdPath: toRepoRelativePath(input.run.projectRoot, testMatrixMdPath),
      featureDirectory: toRepoRelativePath(input.run.projectRoot, featureDirectory),
    },
    allowedWritePaths: [
      `openspec/changes/${changeName}/artifacts/spec-bdd-review.md`,
      `openspec/changes/${changeName}/artifacts/spec-bdd-review.json`,
      `tests/acceptance/generated/${changeName}/**`,
    ],
    expectedOutputs: [
      `openspec/changes/${changeName}/artifacts/spec-bdd-review.md`,
      `openspec/changes/${changeName}/artifacts/spec-bdd-review.json`,
      `tests/acceptance/generated/${changeName}/`,
    ],
  });
}

export function renderSpecBddContextPackMarkdown(contextPack: SpecBddContextPack): string {
  return `# Spec/BDD Context Pack

## Run

- Run ID: ${contextPack.runId}
- Change: ${contextPack.changeName}
- Base revision: ${contextPack.baseRevision}

## OpenSpec

- Proposal: ${contextPack.openSpec.proposalPath}
- Design: ${contextPack.openSpec.designPath}
- Tasks: ${contextPack.openSpec.tasksPath}
- Manifest: ${contextPack.openSpec.manifestPath}
- Evidence Summary: ${contextPack.openSpec.evidenceSummaryPath}
- Traceability Matrix: ${contextPack.openSpec.traceabilityMatrixPath}
- Gap Summary: ${contextPack.openSpec.gapSummaryPath}

## Gherkin

- Index: ${contextPack.gherkin.indexPath}
- Test Matrix: ${contextPack.gherkin.testMatrixPath}
- Test Matrix Markdown: ${contextPack.gherkin.testMatrixMdPath}
- Feature Directory: ${contextPack.gherkin.featureDirectory}

## Allowed Write Paths

${contextPack.allowedWritePaths.map((item) => `- ${item}`).join("\n")}

## Expected Outputs

${contextPack.expectedOutputs.map((item) => `- ${item}`).join("\n")}
`;
}

async function assertReadable(filePath: string): Promise<void> {
  await readFile(filePath, "utf8");
}
