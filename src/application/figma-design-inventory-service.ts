import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  FigmaDesignInventorySchema,
  FigmaProviderComparisonSchema,
  type FigmaDesignInventory,
} from "../figma/figma-design-inventory.js";
import {
  parseAssetsFromText,
  parseCodeConnectMap,
  parseComponentsFromText,
  parseTokensFromText,
} from "../figma/figma-raw-parser.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { GapSchema, type Gap } from "../runtime/gap.js";
import { createArtifactId, createGapId } from "../runtime/id-factory.js";
import { RunIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { SourceRef } from "../runtime/source.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RunStore } from "../store/run-store.js";

export const AnalyzeFigmaDesignInventoryInputSchema = z
  .object({
    runId: RunIdSchema,
    sourceId: SourceIdSchema,
  })
  .strict();

export const GetFigmaDesignInventoryInputSchema = AnalyzeFigmaDesignInventoryInputSchema;

const FIGMA_INTAKE_ADAPTER = "figma-intake-v1" as const;
const FIGMA_INVENTORY_ADAPTER = "figma-design-inventory-v1" as const;

export class FigmaDesignInventoryService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async analyze(rawInput: unknown) {
    const input = AnalyzeFigmaDesignInventoryInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const source = findFigmaSource(run.sources, input.sourceId);
    const figmaArtifacts = figmaRawArtifactsForSource(run, source.id);
    const rawArtifactSetDigest = digestArtifactSet(figmaArtifacts);

    const existing = findLatestInventoryArtifact(run.artifacts, source.id, rawArtifactSetDigest);

    if (existing !== undefined) {
      const inventory = await this.readInventory(existing);

      return {
        duplicate: true,
        run: summarizeRun(run),
        inventory,
        artifact: existing,
        providerComparisonArtifact: findProviderComparisonArtifact(
          run.artifacts,
          source.id,
          rawArtifactSetDigest,
          inventory.generatedAt,
        ),
        gaps: run.gaps.filter((gap) => inventory.gapIds.includes(gap.id)),
      };
    }

    const metadataArtifacts = figmaArtifacts.filter(
      (artifact) => artifact.kind === "figma-metadata",
    );
    const designContextArtifacts = figmaArtifacts.filter(
      (artifact) => artifact.kind === "figma-design-context",
    );
    const screenshotArtifacts = figmaArtifacts.filter(
      (artifact) => artifact.kind === "figma-screenshot",
    );
    const variableArtifacts = figmaArtifacts.filter(
      (artifact) => artifact.kind === "figma-variable-defs",
    );
    const codeConnectArtifacts = figmaArtifacts.filter(
      (artifact) => artifact.kind === "figma-code-connect-map",
    );

    const gaps: Gap[] = [];

    if (metadataArtifacts.length === 0) {
      gaps.push(createMissingArtifactGap("figma-metadata", source.id, timestamp));
    }
    if (designContextArtifacts.length === 0) {
      gaps.push(createMissingArtifactGap("figma-design-context", source.id, timestamp));
    }
    if (screenshotArtifacts.length === 0) {
      gaps.push(createMissingArtifactGap("figma-screenshot", source.id, timestamp));
    }
    if (variableArtifacts.length === 0) {
      gaps.push(createMissingArtifactGap("figma-variable-defs", source.id, timestamp));
    }
    if (codeConnectArtifacts.length === 0) {
      gaps.push(createMissingArtifactGap("figma-code-connect-map", source.id, timestamp));
    }

    const metadataText = await readAllText(this.artifactStore, metadataArtifacts);
    const designText = await readAllText(this.artifactStore, designContextArtifacts);
    const variableText = await readAllText(this.artifactStore, variableArtifacts);
    const codeConnectText = await readAllText(this.artifactStore, codeConnectArtifacts);

    const components = dedupeByNodeId([
      ...parseComponentsFromText(metadataText),
      ...parseComponentsFromText(designText),
    ]);

    const tokens = dedupeByName([
      ...parseTokensFromText(variableText),
      ...parseTokensFromText(designText),
    ]);

    const assets = dedupeByNodeId(parseAssetsFromText(`${metadataText}\n${designText}`));
    const codeConnectMap = parseCodeConnectMap(codeConnectText);

    const mappedComponents = components.map((component) => {
      const mapping = codeConnectMap.get(component.nodeId);

      return {
        ...component,
        ...(mapping?.componentName === undefined
          ? {}
          : { codeConnectComponent: mapping.componentName }),
        ...(mapping?.source === undefined ? {} : { codeConnectSource: mapping.source }),
        mapped: mapping !== undefined,
      };
    });

    for (const component of mappedComponents) {
      if (!component.mapped) {
        gaps.push(createUnmappedComponentGap(component.name, component.nodeId, timestamp));
      }
    }

    const providerComparison = FigmaProviderComparisonSchema.parse({
      comparedProviderIds: uniqueStrings(
        figmaArtifacts
          .map((artifact) => artifact.metadata["providerId"])
          .filter((value): value is string => typeof value === "string"),
      ),
      metadataMismatch:
        metadataArtifacts.length > 1 &&
        new Set(metadataArtifacts.map((artifact) => artifact.digest)).size > 1,
      screenshotMissing: screenshotArtifacts.length === 0,
      variableDefsMissing: variableArtifacts.length === 0,
      codeConnectMissing: codeConnectArtifacts.length === 0,
      notes: [],
    });

    if (providerComparison.metadataMismatch) {
      gaps.push(createProviderMismatchGap(timestamp));
    }

    const inventory = FigmaDesignInventorySchema.parse({
      sourceId: source.id,
      ...(source.digest === undefined ? {} : { sourceDigest: source.digest }),
      generatedAt: timestamp,
      sourceArtifactIds: figmaArtifacts.map((artifact) => artifact.id),
      components: mappedComponents,
      tokens,
      assets,
      providerComparison,
      gapIds: gaps.map((gap) => gap.id),
    });

    const inventoryArtifact = await this.writeJsonArtifact({
      kind: "figma-design-inventory",
      label: "figma-design-inventory",
      content: inventory,
      timestamp,
      metadata: {
        adapter: FIGMA_INVENTORY_ADAPTER,
        sourceId: source.id,
        sourceDigest: source.digest,
        rawArtifactSetDigest,
      },
    });

    const providerComparisonArtifact = await this.writeJsonArtifact({
      kind: "figma-provider-comparison",
      label: "figma-provider-comparison",
      content: providerComparison,
      timestamp,
      metadata: {
        adapter: FIGMA_INVENTORY_ADAPTER,
        sourceId: source.id,
        sourceDigest: source.digest,
        rawArtifactSetDigest,
        inventoryArtifactId: inventoryArtifact.id,
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, inventoryArtifact, providerComparisonArtifact],
      gaps: [...run.gaps, ...gaps],
    });

    await this.runStore.save(nextRun, run.revision);

    return {
      duplicate: false,
      run: summarizeRun(nextRun),
      inventory,
      artifact: inventoryArtifact,
      providerComparisonArtifact,
      gaps,
    };
  }

  public async getInventory(rawInput: unknown) {
    const input = GetFigmaDesignInventoryInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const source = findFigmaSource(run.sources, input.sourceId);
    const latest = findLatestInventoryArtifact(run.artifacts, source.id);

    if (latest === undefined) {
      throw new Error(`No Figma design inventory found for source ${source.id}`);
    }

    const inventory = await this.readInventory(latest);

    return {
      inventory,
      artifact: latest,
      providerComparisonArtifact: findProviderComparisonArtifact(
        run.artifacts,
        source.id,
        metadataString(latest, "rawArtifactSetDigest"),
        inventory.generatedAt,
      ),
      gaps: run.gaps.filter((gap) => inventory.gapIds.includes(gap.id)),
    };
  }

  private async readInventory(artifact: ArtifactRef): Promise<FigmaDesignInventory> {
    const content = await this.artifactStore.readContent(artifact.digest);

    return FigmaDesignInventorySchema.parse(JSON.parse(content.toString("utf8")));
  }

  private async writeJsonArtifact(input: {
    kind: "figma-design-inventory" | "figma-provider-comparison";
    label: string;
    content: unknown;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(input.content, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: input.kind,
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "evidence-verifier",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: compactMetadata(input.metadata),
    });
  }
}

function findFigmaSource(sources: SourceRef[], sourceId: string): SourceRef {
  const source = sources.find((item) => item.id === sourceId);

  if (source === undefined) throw new Error(`Source not found: ${sourceId}`);
  if (source.kind !== "figma" || source.locator.type !== "figma") {
    throw new Error(`Source is not a Figma source: ${sourceId}`);
  }

  return source;
}

function figmaRawArtifactsForSource(
  run: { artifacts: ArtifactRef[] },
  sourceId: string,
): ArtifactRef[] {
  return run.artifacts.filter(
    (artifact) =>
      artifact.metadata["adapter"] === FIGMA_INTAKE_ADAPTER &&
      artifact.metadata["sourceId"] === sourceId,
  );
}

async function readAllText(store: ArtifactBlobStore, artifacts: ArtifactRef[]): Promise<string> {
  const chunks = await Promise.all(
    artifacts.map(async (artifact) => (await store.readContent(artifact.digest)).toString("utf8")),
  );

  return chunks.join("\n");
}

function createMissingArtifactGap(kind: string, sourceId: string, timestamp: string): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "design",
    severity: kind === "figma-screenshot" || kind === "figma-design-context" ? "major" : "minor",
    status: "open",
    title: `Missing ${kind} artifact`,
    expected: `Figma source ${sourceId} should have a ${kind} artifact before design inventory analysis.`,
    observed: `No ${kind} artifact was found for this Figma source.`,
    impact:
      "Design inventory may be incomplete and downstream UI implementation needs manual review or fallback.",
    sourceEvidenceIds: [],
    owner: "evidence-verifier",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createUnmappedComponentGap(name: string, nodeId: string, timestamp: string): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "design",
    severity: "minor",
    status: "open",
    title: `Unmapped Figma component: ${name}`,
    expected:
      "Figma component instances should be mapped to project design-system components when possible.",
    observed: `No Code Connect mapping was found for node ${nodeId} (${name}).`,
    impact:
      "UI Agent may choose a less accurate component or create custom UI instead of reusing the design system.",
    sourceEvidenceIds: [],
    owner: "design-ui",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createProviderMismatchGap(timestamp: string): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "design",
    severity: "major",
    status: "open",
    title: "Figma provider metadata mismatch",
    expected:
      "Metadata from different Figma providers should describe the same target node consistently.",
    observed: "Multiple metadata artifacts for this Figma source have different digests.",
    impact: "Design inventory may depend on provider-specific output and requires manual review.",
    sourceEvidenceIds: [],
    owner: "evidence-verifier",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function findLatestInventoryArtifact(
  artifacts: ArtifactRef[],
  sourceId: string,
  rawArtifactSetDigest?: string,
): ArtifactRef | undefined {
  return artifacts
    .filter(
      (artifact) =>
        artifact.kind === "figma-design-inventory" &&
        artifact.metadata["adapter"] === FIGMA_INVENTORY_ADAPTER &&
        artifact.metadata["sourceId"] === sourceId &&
        (rawArtifactSetDigest === undefined ||
          artifact.metadata["rawArtifactSetDigest"] === rawArtifactSetDigest),
    )
    .at(-1);
}

function findProviderComparisonArtifact(
  artifacts: ArtifactRef[],
  sourceId: string,
  rawArtifactSetDigest: string | undefined,
  generatedAt: string,
): ArtifactRef | undefined {
  return artifacts
    .filter(
      (artifact) =>
        artifact.kind === "figma-provider-comparison" &&
        artifact.metadata["adapter"] === FIGMA_INVENTORY_ADAPTER &&
        artifact.metadata["sourceId"] === sourceId &&
        artifact.createdAt === generatedAt &&
        (rawArtifactSetDigest === undefined ||
          artifact.metadata["rawArtifactSetDigest"] === rawArtifactSetDigest),
    )
    .at(-1);
}

function digestArtifactSet(artifacts: ArtifactRef[]): string {
  const stable = artifacts
    .map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      digest: artifact.digest,
      providerId: artifact.metadata["providerId"],
      figmaArtifactKind: artifact.metadata["figmaArtifactKind"],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return sha256Digest(Buffer.from(JSON.stringify(stable), "utf8"));
}

function dedupeByNodeId<T extends { nodeId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.nodeId)) continue;

    seen.add(item.nodeId);
    result.push(item);
  }

  return result;
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.name)) continue;

    seen.add(item.name);
    result.push(item);
  }

  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function metadataString(artifact: ArtifactRef, key: string): string | undefined {
  const value = artifact.metadata[key];

  return typeof value === "string" ? value : undefined;
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as Record<string, unknown>;
}
