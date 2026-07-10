import { z } from "zod";

import {
  ArtifactIdSchema,
  EvidenceIdSchema,
  GapIdSchema,
  RunIdSchema,
  SourceIdSchema,
} from "../runtime/ids.js";
import { IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";

export const TraceNodeIdSchema = z
  .string()
  .regex(/^tn_[a-f0-9]{32}$/, "Expected tn_<32 lowercase hex characters>");

export const TraceEdgeIdSchema = z
  .string()
  .regex(/^te_[a-f0-9]{32}$/, "Expected te_<32 lowercase hex characters>");

export const TraceNodeKindSchema = z.enum([
  "requirement",
  "api-operation",
  "api-schema",
  "figma-node",
  "figma-component",
  "figma-token",
  "gap",
  "artifact",
]);

export const TraceEdgeKindSchema = z.enum([
  "derived-from",
  "mentions",
  "requires-api",
  "requires-design",
  "matches-api",
  "matches-figma",
  "blocked-by-gap",
  "supported-by-artifact",
]);

export const TraceLinkConfidenceSchema = z.number().min(0).max(1);

export const TraceNodeSchema = z
  .object({
    id: TraceNodeIdSchema,
    kind: TraceNodeKindSchema,
    label: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(2_000),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    sourceIds: z.array(SourceIdSchema).default([]),
    keywords: z.array(z.string().trim().min(1)).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const TraceEdgeSchema = z
  .object({
    id: TraceEdgeIdSchema,
    kind: TraceEdgeKindSchema,
    from: TraceNodeIdSchema,
    to: TraceNodeIdSchema,
    confidence: TraceLinkConfidenceSchema,
    reasons: z.array(z.string().trim().min(1).max(500)).default([]),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const TraceabilityMatrixRowSchema = z
  .object({
    requirementNodeId: TraceNodeIdSchema,
    requirementLabel: z.string().trim().min(1),
    briefEvidenceIds: z.array(EvidenceIdSchema).default([]),
    apiNodeIds: z.array(TraceNodeIdSchema).default([]),
    figmaNodeIds: z.array(TraceNodeIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    status: z.enum(["linked", "missing-api", "missing-figma", "missing-api-and-figma", "blocked"]),
  })
  .strict();

export const EvidenceGraphSchema = z
  .object({
    adapter: z.literal("evidence-graph-v1"),
    runId: RunIdSchema,
    builtAt: IsoDateTimeSchema,
    sourceDigest: Sha256DigestSchema.optional(),
    nodes: z.array(TraceNodeSchema),
    edges: z.array(TraceEdgeSchema),
    matrix: z.array(TraceabilityMatrixRowSchema),
    orphanApiNodeIds: z.array(TraceNodeIdSchema).default([]),
    orphanFigmaNodeIds: z.array(TraceNodeIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict()
  .superRefine((graph, context) => {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));

    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from)) {
        context.addIssue({
          code: "custom",
          message: `Edge references unknown from node ${edge.from}`,
          path: ["edges"],
        });
      }

      if (!nodeIds.has(edge.to)) {
        context.addIssue({
          code: "custom",
          message: `Edge references unknown to node ${edge.to}`,
          path: ["edges"],
        });
      }
    }

    for (const row of graph.matrix) {
      if (!nodeIds.has(row.requirementNodeId)) {
        context.addIssue({
          code: "custom",
          message: `Matrix row references unknown requirement node ${row.requirementNodeId}`,
          path: ["matrix"],
        });
      }
    }
  });

export type TraceNodeId = z.infer<typeof TraceNodeIdSchema>;
export type TraceEdgeId = z.infer<typeof TraceEdgeIdSchema>;
export type TraceNodeKind = z.infer<typeof TraceNodeKindSchema>;
export type TraceEdgeKind = z.infer<typeof TraceEdgeKindSchema>;
export type TraceNode = z.infer<typeof TraceNodeSchema>;
export type TraceEdge = z.infer<typeof TraceEdgeSchema>;
export type TraceabilityMatrixRow = z.infer<typeof TraceabilityMatrixRowSchema>;
export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;
