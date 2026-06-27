import { z } from "zod";

function prefixedId(prefix: string) {
  return z
    .string()
    .regex(
      new RegExp(`^${prefix}_[a-f0-9]{32}$`),
      `Expected ${prefix}_ followed by 32 lowercase hex characters`,
    );
}

export const RunIdSchema = prefixedId("run");
export const SourceIdSchema = prefixedId("src");
export const EvidenceIdSchema = prefixedId("ev");
export const ArtifactIdSchema = prefixedId("art");
export const GapIdSchema = prefixedId("gap");
export const DecisionIdSchema = prefixedId("dec");
export const AgentResultIdSchema = prefixedId("ar");
export const CheckIdSchema = prefixedId("chk");

export type RunId = z.infer<typeof RunIdSchema>;
export type SourceId = z.infer<typeof SourceIdSchema>;
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type GapId = z.infer<typeof GapIdSchema>;
export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type AgentResultId = z.infer<typeof AgentResultIdSchema>;
export type CheckId = z.infer<typeof CheckIdSchema>;
