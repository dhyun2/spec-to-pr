import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { RunManifestSchema } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { RunIdSchema } from "../runtime/ids.js";
import type { RunStore } from "../store/run-store.js";
import {
  buildTraceLinks,
  buildTraceNodes,
  detectTraceabilityGaps,
  EvidenceGraphSchema,
} from "../traceability/index.js";

export const BuildEvidenceGraphInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export const GetTraceabilityMatrixInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export const EvidenceGraphBuildResultSchema = z
  .object({
    duplicate: z.boolean(),
    runId: RunIdSchema,
    graphArtifactId: z.string().optional(),
    matrixArtifactId: z.string().optional(),
    requirementCount: z.number().int().nonnegative(),
    apiNodeCount: z.number().int().nonnegative(),
    figmaNodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    gapsAdded: z.number().int().nonnegative(),
    orphanApiCount: z.number().int().nonnegative(),
    orphanFigmaCount: z.number().int().nonnegative(),
  })
  .strict();

const EVIDENCE_GRAPH_ADAPTER = "evidence-graph-v1" as const;

export class EvidenceGraphService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async buildEvidenceGraph(rawInput: unknown) {
    const input = BuildEvidenceGraphInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = this.now();

    const existingGraph = run.artifacts.find(
      (artifact) =>
        artifact.kind === "traceability-graph" &&
        artifact.metadata["adapter"] === EVIDENCE_GRAPH_ADAPTER &&
        artifact.metadata["runRevision"] === run.revision,
    );

    if (existingGraph !== undefined) {
      const matrixArtifact = run.artifacts.find(
        (artifact) =>
          artifact.kind === "traceability-matrix" &&
          artifact.metadata["adapter"] === EVIDENCE_GRAPH_ADAPTER &&
          artifact.metadata["runRevision"] === run.revision,
      );

      return EvidenceGraphBuildResultSchema.parse({
        duplicate: true,
        runId: run.id,
        graphArtifactId: existingGraph.id,
        ...(matrixArtifact === undefined ? {} : { matrixArtifactId: matrixArtifact.id }),
        requirementCount: Number(existingGraph.metadata["requirementCount"] ?? 0),
        apiNodeCount: Number(existingGraph.metadata["apiNodeCount"] ?? 0),
        figmaNodeCount: Number(existingGraph.metadata["figmaNodeCount"] ?? 0),
        edgeCount: Number(existingGraph.metadata["edgeCount"] ?? 0),
        gapsAdded: 0,
        orphanApiCount: Number(existingGraph.metadata["orphanApiCount"] ?? 0),
        orphanFigmaCount: Number(existingGraph.metadata["orphanFigmaCount"] ?? 0),
      });
    }

    const nodes = buildTraceNodes(run);
    const links = buildTraceLinks(nodes);
    const gaps = detectTraceabilityGaps({
      requirementNodes: nodes.requirementNodes,
      apiNodes: nodes.apiNodes,
      figmaNodes: nodes.figmaNodes,
      edges: links.edges,
      now: timestamp,
    });

    const graph = EvidenceGraphSchema.parse({
      adapter: EVIDENCE_GRAPH_ADAPTER,
      runId: run.id,
      builtAt: timestamp,
      nodes: nodes.allNodes,
      edges: links.edges,
      matrix: gaps.matrix,
      orphanApiNodeIds: gaps.orphanApiNodeIds,
      orphanFigmaNodeIds: gaps.orphanFigmaNodeIds,
      gapIds: gaps.gaps.map((gap) => gap.id),
    });

    const graphBlob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(graph, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "traceability-graph",
    });

    const matrixBlob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(graph.matrix, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "traceability-matrix",
    });

    const graphArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "traceability-graph",
      uri: graphBlob.uri,
      mediaType: "application/json",
      digest: graphBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [...new Set(nodes.allNodes.flatMap((node) => node.evidenceIds))],
      createdAt: timestamp,
      metadata: {
        adapter: EVIDENCE_GRAPH_ADAPTER,
        runRevision: run.revision,
        requirementCount: nodes.requirementNodes.length,
        apiNodeCount: nodes.apiNodes.length,
        figmaNodeCount: nodes.figmaNodes.length,
        edgeCount: links.edges.length,
        orphanApiCount: gaps.orphanApiNodeIds.length,
        orphanFigmaCount: gaps.orphanFigmaNodeIds.length,
      },
    });

    const matrixArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "traceability-matrix",
      uri: matrixBlob.uri,
      mediaType: "application/json",
      digest: matrixBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [...new Set(nodes.requirementNodes.flatMap((node) => node.evidenceIds))],
      createdAt: timestamp,
      metadata: {
        adapter: EVIDENCE_GRAPH_ADAPTER,
        runRevision: run.revision,
        rowCount: graph.matrix.length,
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      gaps: [...run.gaps, ...gaps.gaps],
      artifacts: [...run.artifacts, graphArtifact, matrixArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return EvidenceGraphBuildResultSchema.parse({
      duplicate: false,
      runId: run.id,
      graphArtifactId: graphArtifact.id,
      matrixArtifactId: matrixArtifact.id,
      requirementCount: nodes.requirementNodes.length,
      apiNodeCount: nodes.apiNodes.length,
      figmaNodeCount: nodes.figmaNodes.length,
      edgeCount: links.edges.length,
      gapsAdded: gaps.gaps.length,
      orphanApiCount: gaps.orphanApiNodeIds.length,
      orphanFigmaCount: gaps.orphanFigmaNodeIds.length,
    });
  }

  public async getTraceabilityMatrix(rawInput: unknown) {
    const input = GetTraceabilityMatrixInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);

    const matrixArtifact = [...run.artifacts]
      .reverse()
      .find((artifact) => artifact.kind === "traceability-matrix");

    if (matrixArtifact === undefined) {
      throw new Error(`Traceability matrix artifact not found for run ${run.id}`);
    }

    const matrixBlob = await this.artifactStore.readContent(matrixArtifact.digest);

    return JSON.parse(matrixBlob.toString("utf8")) as unknown;
  }
}
