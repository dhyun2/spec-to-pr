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
  "pr-report",
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
