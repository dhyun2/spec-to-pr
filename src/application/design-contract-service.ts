import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { buildFigmaDesignContract } from "../design-contract/design-contract-mapper.js";
import { renderDesignContract } from "../design-contract/design-contract-renderer.js";
import { writeDesignContractArtifacts } from "../design-contract/design-contract-writer.js";
import { FigmaDesignContractSchema } from "../design-contract/design-contract-model.js";
import { scanProjectDesignSystem } from "../design-contract/project-design-system-scanner.js";
import { OpenSpecChangeNameSchema, toOpenSpecChangeName } from "../openspec/openspec-paths.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const GenerateDesignContractInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(3),
    figmaInventoryArtifactId: ArtifactIdSchema,
    force: z.boolean().default(false),
  })
  .strict();

export const GetDesignContractSummaryInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(3),
  })
  .strict();

export const DesignContractSummarySchema = z
  .object({
    changeName: OpenSpecChangeNameSchema,
    artifactId: ArtifactIdSchema,
    componentMappings: z.number().int().nonnegative(),
    tokenMappings: z.number().int().nonnegative(),
    typographyMappings: z.number().int().nonnegative(),
    assetMappings: z.number().int().nonnegative(),
    gapIds: z.array(GapIdSchema),
    relativePath: z.string().trim().min(1),
  })
  .strict();

export const GenerateDesignContractResultSchema = z
  .object({
    duplicate: z.boolean(),
    run: z.custom<ReturnType<typeof summarizeRun>>(),
    changeName: OpenSpecChangeNameSchema,
    artifactIds: z.array(ArtifactIdSchema),
    gapIds: z.array(GapIdSchema),
    changedFiles: z.array(z.string()),
    componentMappings: z.number().int().nonnegative(),
    tokenMappings: z.number().int().nonnegative(),
    typographyMappings: z.number().int().nonnegative(),
    assetMappings: z.number().int().nonnegative(),
  })
  .strict();

export class DesignContractService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generate(rawInput: unknown) {
    const input = GenerateDesignContractInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const changeName = toOpenSpecChangeName(input.changeName);

    const existing = findDesignContractArtifact(run.artifacts, changeName);

    if (existing !== undefined && !input.force) {
      return GenerateDesignContractResultSchema.parse({
        duplicate: true,
        run: summarizeRun(run),
        changeName,
        artifactIds: [existing.id],
        gapIds: [],
        changedFiles: [],
        componentMappings: 0,
        tokenMappings: 0,
        typographyMappings: 0,
        assetMappings: 0,
      });
    }

    const inventoryArtifact = run.artifacts.find(
      (artifact) => artifact.id === input.figmaInventoryArtifactId,
    );

    if (inventoryArtifact === undefined) {
      throw new Error(`Figma inventory artifact not found: ${input.figmaInventoryArtifactId}`);
    }

    if (inventoryArtifact.kind !== "figma-design-inventory") {
      throw new Error(`Artifact is not a Figma design inventory: ${inventoryArtifact.id}`);
    }

    const inventoryContent = await this.artifactStore.readContent(
      Sha256DigestSchema.parse(inventoryArtifact.digest),
    );
    const figmaInventory = JSON.parse(inventoryContent.toString("utf8"));
    const projectDesignSystem = await scanProjectDesignSystem(run.projectRoot);
    const built = buildFigmaDesignContract({
      runId: run.id,
      changeName,
      generatedAt: timestamp,
      figmaInventory,
      projectDesignSystem,
      evidence: run.evidence,
    });

    const rendered = renderDesignContract({
      contract: built.contract,
      gaps: built.gaps,
    });

    const written = await writeDesignContractArtifacts({
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
      gaps: [...run.gaps, ...built.gaps],
      artifacts: [...run.artifacts, ...written.artifactRefs],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateDesignContractResultSchema.parse({
      duplicate: false,
      run: summarizeRun(nextRun),
      changeName,
      artifactIds: written.artifactRefs.map((artifact) => artifact.id),
      gapIds: built.gaps.map((gap) => gap.id),
      changedFiles: written.files.filter((file) => file.changed).map((file) => file.relativePath),
      componentMappings: built.contract.componentMappings.length,
      tokenMappings: built.contract.tokenMappings.length,
      typographyMappings: built.contract.typographyMappings.length,
      assetMappings: built.contract.assetMappings.length,
    });
  }

  public async getSummary(rawInput: unknown) {
    const input = GetDesignContractSummaryInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const changeName = toOpenSpecChangeName(input.changeName);
    const artifact = findDesignContractArtifact(run.artifacts, changeName);

    if (artifact === undefined) {
      throw new Error(`Design contract not found for change ${changeName}`);
    }

    const relativePath = metadataString(artifact.metadata["relativePath"]);

    if (relativePath === undefined) {
      throw new Error(`Design contract artifact has no relativePath metadata: ${artifact.id}`);
    }

    const content = await readRepoArtifact(run.projectRoot, relativePath);
    const contract = FigmaDesignContractSchema.parse(JSON.parse(content));

    return DesignContractSummarySchema.parse({
      changeName,
      artifactId: artifact.id,
      componentMappings: contract.componentMappings.length,
      tokenMappings: contract.tokenMappings.length,
      typographyMappings: contract.typographyMappings.length,
      assetMappings: contract.assetMappings.length,
      gapIds: contract.gapIds,
      relativePath,
    });
  }
}

function findDesignContractArtifact(
  artifacts: Array<{
    id: string;
    kind: string;
    metadata: Record<string, unknown>;
  }>,
  changeName: string,
) {
  return artifacts.find(
    (artifact) =>
      artifact.kind === "figma-design-contract" &&
      artifact.metadata["changeName"] === changeName &&
      artifact.metadata["relativePath"] ===
        `openspec/changes/${changeName}/artifacts/design-contract/figma-design-contract.json`,
  );
}

async function readRepoArtifact(projectRoot: string, relativePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const absolutePath = path.join(projectRoot, relativePath);
  const relative = path.relative(projectRoot, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to read outside project root: ${absolutePath}`);
  }

  return readFile(absolutePath, "utf8");
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
