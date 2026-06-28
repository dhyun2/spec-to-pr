import { createGapId } from "../runtime/id-factory.js";
import { GapSchema, type Gap } from "../runtime/gap.js";
import {
  TraceabilityMatrixRowSchema,
  type TraceEdge,
  type TraceNode,
  type TraceabilityMatrixRow,
} from "./traceability-contracts.js";

export type TraceabilityGapDetectionResult = {
  matrix: TraceabilityMatrixRow[];
  gaps: Gap[];
  orphanApiNodeIds: string[];
  orphanFigmaNodeIds: string[];
};

export function detectTraceabilityGaps(input: {
  requirementNodes: TraceNode[];
  apiNodes: TraceNode[];
  figmaNodes: TraceNode[];
  edges: TraceEdge[];
  now: string;
}): TraceabilityGapDetectionResult {
  const apiByRequirement = new Map<string, string[]>();
  const figmaByRequirement = new Map<string, string[]>();
  const blockedByRequirement = new Map<string, string[]>();

  for (const edge of input.edges) {
    if (edge.kind === "matches-api") {
      append(apiByRequirement, edge.from, edge.to);
    }

    if (edge.kind === "matches-figma") {
      append(figmaByRequirement, edge.from, edge.to);
    }

    if (edge.kind === "blocked-by-gap") {
      append(blockedByRequirement, edge.from, edge.to);
    }
  }

  const gaps: Gap[] = [];
  const matrix: TraceabilityMatrixRow[] = [];

  for (const requirement of input.requirementNodes) {
    const apiNodeIds = apiByRequirement.get(requirement.id) ?? [];
    const figmaNodeIds = figmaByRequirement.get(requirement.id) ?? [];
    const blockedNodeIds = blockedByRequirement.get(requirement.id) ?? [];

    const missingApi = apiNodeIds.length === 0;
    const missingFigma = figmaNodeIds.length === 0;

    const gapIds = [...requirement.gapIds];

    if (missingApi) {
      const gap = GapSchema.parse({
        id: createGapId(),
        category: "api",
        severity: "major",
        status: "open",
        title: `Requirement has no linked API evidence: ${requirement.label}`,
        expected:
          "Every implementation-facing requirement should be linked to API evidence or explicitly marked as non-API.",
        observed:
          "No API operation candidate was linked by the deterministic traceability builder.",
        impact: "API Agent may not know which backend contract supports this requirement.",
        sourceEvidenceIds: requirement.evidenceIds,
        owner: "api-contract",
        createdAt: input.now,
        updatedAt: input.now,
      });

      gaps.push(gap);
      gapIds.push(gap.id);
    }

    if (missingFigma) {
      const gap = GapSchema.parse({
        id: createGapId(),
        category: "design",
        severity: "major",
        status: "open",
        title: `Requirement has no linked Figma evidence: ${requirement.label}`,
        expected:
          "Every user-facing requirement should be linked to Figma evidence or explicitly marked as non-visual.",
        observed: "No Figma node candidate was linked by the deterministic traceability builder.",
        impact: "UI Agent may need to guess layout, component, state, or token decisions.",
        sourceEvidenceIds: requirement.evidenceIds,
        owner: "design-ui",
        createdAt: input.now,
        updatedAt: input.now,
      });

      gaps.push(gap);
      gapIds.push(gap.id);
    }

    const status = computeRowStatus({
      missingApi,
      missingFigma,
      blocked: blockedNodeIds.length > 0,
    });

    matrix.push(
      TraceabilityMatrixRowSchema.parse({
        requirementNodeId: requirement.id,
        requirementLabel: requirement.label,
        briefEvidenceIds: requirement.evidenceIds,
        apiNodeIds,
        figmaNodeIds,
        gapIds,
        status,
      }),
    );
  }

  const linkedApiNodeIds = new Set([...apiByRequirement.values()].flat());
  const linkedFigmaNodeIds = new Set([...figmaByRequirement.values()].flat());

  return {
    matrix,
    gaps,
    orphanApiNodeIds: input.apiNodes
      .filter((node) => !linkedApiNodeIds.has(node.id))
      .map((node) => node.id),
    orphanFigmaNodeIds: input.figmaNodes
      .filter((node) => !linkedFigmaNodeIds.has(node.id))
      .map((node) => node.id),
  };
}

function append(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

function computeRowStatus(input: {
  missingApi: boolean;
  missingFigma: boolean;
  blocked: boolean;
}): TraceabilityMatrixRow["status"] {
  if (input.blocked) {
    return "blocked";
  }

  if (input.missingApi && input.missingFigma) {
    return "missing-api-and-figma";
  }

  if (input.missingApi) {
    return "missing-api";
  }

  if (input.missingFigma) {
    return "missing-figma";
  }

  return "linked";
}
