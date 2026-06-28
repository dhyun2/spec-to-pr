import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema } from "./ids.js";
import { AgentRoleSchema, IsoDateTimeSchema, Sha256DigestSchema } from "./scalars.js";

export const ArtifactKindSchema = z.enum([
  "project-profile",
  "source-snapshot",
  "figma-mcp-capability-report",
  "figma-provider-policy",
  "figma-metadata",
  "figma-design-context",
  "figma-screenshot",
  "figma-variable-defs",
  "figma-code-connect-map",
  "figma-design-inventory",
  "figma-provider-comparison",
  "figma-design-contract",
  "design-system-map",
  "ui-implementation-rules",
  "openapi-normalized-document",
  "openapi-operation-inventory",
  "openapi-schema-inventory",
  "openapi-security-inventory",
  "openapi-ref-inventory",
  "openapi-intake-report",
  "traceability-graph",
  "traceability-matrix",
  "requirement-graph",
  "openspec",
  "gherkin",
  "test-matrix",
  "source-code",
  "generated-code",
  "api-contract-report",
  "test-report",
  "coverage-report",
  "screenshot",
  "visual-diff",
  "visual-report",
  "accessibility-report",
  "performance-report",
  "telemetry-config",
  "agent-context-pack",
  "agent-result-report",
  "pr-report",
  "merge-evidence",
  "openspec-archive-plan",
  "openspec-archive-result",
  "openspec-archive-report",
  "log",
  "other",
]);

export const ArtifactRefSchema = z
  .object({
    id: ArtifactIdSchema,
    kind: ArtifactKindSchema,
    uri: z.string().trim().min(1),
    mediaType: z.string().trim().min(1),
    digest: Sha256DigestSchema,
    producedBy: AgentRoleSchema,
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    createdAt: IsoDateTimeSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
