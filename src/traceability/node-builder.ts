import type { RunManifest } from "../run/index.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import type { Gap } from "../runtime/gap.js";
import type { EvidenceRef } from "../runtime/source.js";
import { createTraceNodeId } from "./id-factory.js";
import { extractKeywords } from "./keyword-extractor.js";
import { TraceNodeSchema, type TraceNode } from "./traceability-contracts.js";

export type BuiltTraceNodes = {
  requirementNodes: TraceNode[];
  apiNodes: TraceNode[];
  figmaNodes: TraceNode[];
  gapNodes: TraceNode[];
  artifactNodes: TraceNode[];
  allNodes: TraceNode[];
};

export function buildTraceNodes(run: RunManifest): BuiltTraceNodes {
  const requirementNodes = run.evidence
    .filter(isBriefRequirementEvidence)
    .map((evidence) => createRequirementNode(evidence));

  const apiNodes = run.evidence
    .filter(isOpenApiOperationEvidence)
    .map((evidence) => createApiOperationNode(evidence));

  const figmaNodes = run.evidence
    .filter(isFigmaNodeEvidence)
    .map((evidence) => createFigmaNode(evidence));

  const gapNodes = run.gaps.map((gap) => createGapNode(gap));

  const artifactNodes = run.artifacts
    .filter(isTraceableArtifact)
    .map((artifact) => createArtifactNode(artifact));

  const allNodes = [...requirementNodes, ...apiNodes, ...figmaNodes, ...gapNodes, ...artifactNodes];

  return {
    requirementNodes,
    apiNodes,
    figmaNodes,
    gapNodes,
    artifactNodes,
    allNodes,
  };
}

function isBriefRequirementEvidence(evidence: EvidenceRef): boolean {
  return (
    (evidence.metadata["adapter"] === "brief-adapter-v1" &&
      ["requirement", "policy", "api", "design", "test"].includes(
        String(evidence.metadata["itemType"] ?? ""),
      )) ||
    (evidence.location.type === "inline-text" &&
      evidence.metadata["parserVersion"] === "intake-request-parser-v1" &&
      ["requirement", "policy", "design", "test"].includes(
        String(evidence.metadata["itemType"] ?? ""),
      ))
  );
}

function isOpenApiOperationEvidence(evidence: EvidenceRef): boolean {
  return (
    (evidence.metadata["adapter"] === "openapi-intake-v1" ||
      evidence.metadata["parserVersion"] === "intake-request-parser-v1") &&
    (evidence.metadata["openapiEvidenceKind"] === "operation" ||
      evidence.metadata["evidenceType"] === "openapi-operation")
  );
}

function isFigmaNodeEvidence(evidence: EvidenceRef): boolean {
  return (
    evidence.location.type === "figma-node" &&
    String(evidence.metadata["adapter"] ?? "").startsWith("figma")
  );
}

function isTraceableArtifact(artifact: ArtifactRef): boolean {
  return [
    "figma-design-inventory",
    "figma-design-system-inventory",
    "openapi-intake-report",
    "figma-screenshot",
    "figma-design-context",
    "figma-variable-defs",
  ].includes(artifact.kind);
}

function createRequirementNode(evidence: EvidenceRef): TraceNode {
  const isInstruction = evidence.metadata["itemType"] === "instruction";
  const label = isInstruction ? summarizeInstructionLabel(evidence) : evidence.summary;
  const summary = isInstruction
    ? compactText(evidence.excerpt ?? evidence.summary, 2_000)
    : (evidence.excerpt ?? evidence.summary);
  const { keywords } = extractKeywords(
    [
      evidence.summary,
      evidence.excerpt ?? "",
      JSON.stringify(evidence.metadata["headingPath"] ?? []),
    ].join(" "),
  );

  return TraceNodeSchema.parse({
    id: createTraceNodeId(),
    kind: "requirement",
    label,
    summary,
    evidenceIds: [evidence.id],
    sourceIds: [evidence.sourceId],
    keywords,
    metadata: compactMetadata({
      itemType: evidence.metadata["itemType"],
      headingPath: evidence.metadata["headingPath"],
      parserVersion: evidence.metadata["parserVersion"],
      sourceKind: evidence.metadata["sourceKind"] ?? (isInstruction ? "instruction" : undefined),
    }),
  });
}

function summarizeInstructionLabel(evidence: EvidenceRef): string {
  const text = compactText(evidence.excerpt ?? evidence.summary, 300);
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return compactText(firstLine ?? evidence.summary, 300);
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function createApiOperationNode(evidence: EvidenceRef): TraceNode {
  const label = evidence.summary;
  const pointer = evidence.location.type === "json-pointer" ? evidence.location.pointer : undefined;
  const { keywords } = extractKeywords([evidence.summary, pointer ?? ""].join(" "));

  return TraceNodeSchema.parse({
    id: createTraceNodeId(),
    kind: "api-operation",
    label,
    summary: evidence.summary,
    evidenceIds: [evidence.id],
    sourceIds: [evidence.sourceId],
    keywords,
    metadata: compactMetadata({
      pointer,
      method: evidence.metadata["method"],
      path: evidence.metadata["path"],
      operationId: evidence.metadata["operationId"],
    }),
  });
}

function createFigmaNode(evidence: EvidenceRef): TraceNode {
  const label = evidence.summary;
  const nodeId = evidence.location.type === "figma-node" ? evidence.location.nodeId : undefined;
  const { keywords } = extractKeywords(
    [evidence.summary, nodeId ?? "", JSON.stringify(evidence.metadata)].join(" "),
  );

  return TraceNodeSchema.parse({
    id: createTraceNodeId(),
    kind: "figma-node",
    label,
    summary: evidence.summary,
    evidenceIds: [evidence.id],
    sourceIds: [evidence.sourceId],
    keywords,
    metadata:
      evidence.location.type === "figma-node"
        ? {
            fileKey: evidence.location.fileKey,
            nodeId: evidence.location.nodeId,
          }
        : {},
  });
}

function createGapNode(gap: Gap): TraceNode {
  const { keywords } = extractKeywords(
    [gap.title, gap.expected, gap.observed, gap.impact].join(" "),
  );

  return TraceNodeSchema.parse({
    id: createTraceNodeId(),
    kind: "gap",
    label: gap.title,
    summary: gap.impact,
    evidenceIds: gap.sourceEvidenceIds,
    artifactIds: gap.resolutionArtifactIds,
    gapIds: [gap.id],
    keywords,
    metadata: {
      category: gap.category,
      severity: gap.severity,
      status: gap.status,
    },
  });
}

function createArtifactNode(artifact: ArtifactRef): TraceNode {
  const { keywords } = extractKeywords(
    [artifact.kind, artifact.uri, JSON.stringify(artifact.metadata)].join(" "),
  );

  return TraceNodeSchema.parse({
    id: createTraceNodeId(),
    kind: "artifact",
    label: artifact.kind,
    summary: artifact.uri,
    artifactIds: [artifact.id],
    evidenceIds: artifact.evidenceIds,
    keywords,
    metadata: {
      kind: artifact.kind,
      uri: artifact.uri,
    },
  });
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as Record<string, unknown>;
}
