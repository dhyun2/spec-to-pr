import { createTraceEdgeId } from "./id-factory.js";
import { keywordOverlap } from "./keyword-extractor.js";
import { TraceEdgeSchema, type TraceEdge, type TraceNode } from "./traceability-contracts.js";

export type BuiltTraceLinks = {
  edges: TraceEdge[];
  requirementToApi: Map<string, TraceEdge[]>;
  requirementToFigma: Map<string, TraceEdge[]>;
};

export function buildTraceLinks(input: {
  requirementNodes: TraceNode[];
  apiNodes: TraceNode[];
  figmaNodes: TraceNode[];
  gapNodes: TraceNode[];
  artifactNodes: TraceNode[];
}): BuiltTraceLinks {
  const edges: TraceEdge[] = [];
  const requirementToApi = new Map<string, TraceEdge[]>();
  const requirementToFigma = new Map<string, TraceEdge[]>();

  for (const requirement of input.requirementNodes) {
    const apiEdges = input.apiNodes
      .map((apiNode) => createCandidateEdge(requirement, apiNode, "matches-api"))
      .filter((edge): edge is TraceEdge => edge !== undefined)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5);

    const figmaEdges = input.figmaNodes
      .map((figmaNode) => createCandidateEdge(requirement, figmaNode, "matches-figma"))
      .filter((edge): edge is TraceEdge => edge !== undefined)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5);

    if (apiEdges.length > 0) {
      requirementToApi.set(requirement.id, apiEdges);
      edges.push(...apiEdges);
    }

    if (figmaEdges.length > 0) {
      requirementToFigma.set(requirement.id, figmaEdges);
      edges.push(...figmaEdges);
    }
  }

  for (const requirement of input.requirementNodes) {
    for (const gapNode of input.gapNodes) {
      const sharedEvidence = requirement.evidenceIds.filter((evidenceId) =>
        gapNode.evidenceIds.includes(evidenceId),
      );

      if (sharedEvidence.length === 0) {
        continue;
      }

      edges.push(
        TraceEdgeSchema.parse({
          id: createTraceEdgeId(),
          kind: "blocked-by-gap",
          from: requirement.id,
          to: gapNode.id,
          confidence: 1,
          reasons: ["shared evidence with gap"],
          evidenceIds: sharedEvidence,
        }),
      );
    }
  }

  for (const artifact of input.artifactNodes) {
    for (const requirement of input.requirementNodes) {
      const sharedEvidence = artifact.evidenceIds.filter((evidenceId) =>
        requirement.evidenceIds.includes(evidenceId),
      );

      if (sharedEvidence.length === 0) {
        continue;
      }

      edges.push(
        TraceEdgeSchema.parse({
          id: createTraceEdgeId(),
          kind: "supported-by-artifact",
          from: requirement.id,
          to: artifact.id,
          confidence: 1,
          reasons: ["artifact references requirement evidence"],
          evidenceIds: sharedEvidence,
        }),
      );
    }
  }

  return {
    edges,
    requirementToApi,
    requirementToFigma,
  };
}

function createCandidateEdge(
  requirement: TraceNode,
  target: TraceNode,
  kind: "matches-api" | "matches-figma",
): TraceEdge | undefined {
  const overlap = keywordOverlap(requirement.keywords, target.keywords);

  if (overlap.score < 0.25 || overlap.count === 0) {
    return undefined;
  }

  const confidence = Math.min(0.95, 0.35 + overlap.score * 0.6);

  return TraceEdgeSchema.parse({
    id: createTraceEdgeId(),
    kind,
    from: requirement.id,
    to: target.id,
    confidence,
    reasons: [
      `shared keywords: ${overlap.shared.join(", ")}`,
      `keyword overlap score: ${overlap.score.toFixed(2)}`,
    ],
    evidenceIds: requirement.evidenceIds,
    metadata: {
      sharedKeywords: overlap.shared,
    },
  });
}
