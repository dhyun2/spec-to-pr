import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { Sha256DigestSchema } from "../runtime/scalars.js";

export const FigmaRecordedArtifactKindSchema = z.enum([
  "metadata",
  "design-context",
  "screenshot",
  "variable-defs",
  "code-connect-map",
]);

export const FigmaIntakeResultSchema = z
  .object({
    duplicate: z.boolean(),
    sourceId: SourceIdSchema,
    evidenceId: EvidenceIdSchema.optional(),
    artifactId: ArtifactIdSchema.optional(),
    artifactDigest: Sha256DigestSchema.optional(),
    kind: FigmaRecordedArtifactKindSchema.optional(),
  })
  .strict();

export type FigmaRecordedArtifactKind = z.infer<typeof FigmaRecordedArtifactKindSchema>;
export type FigmaIntakeResult = z.infer<typeof FigmaIntakeResultSchema>;

export function figmaKindToArtifactKind(kind: FigmaRecordedArtifactKind) {
  switch (kind) {
    case "metadata":
      return "figma-metadata";
    case "design-context":
      return "figma-design-context";
    case "screenshot":
      return "figma-screenshot";
    case "variable-defs":
      return "figma-variable-defs";
    case "code-connect-map":
      return "figma-code-connect-map";
  }
}
