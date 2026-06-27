import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema } from "./ids.js";
import { AgentRoleSchema, IsoDateTimeSchema } from "./scalars.js";
import { DecisionRiskSchema } from "./decision.js";

export const GapCategorySchema = z.enum([
  "requirement",
  "design",
  "api",
  "implementation",
  "test",
  "visual",
  "accessibility",
  "performance",
  "observability",
  "security",
  "architecture",
]);

export const GapSeveritySchema = z.enum(["blocker", "major", "minor", "info"]);

export const GapStatusSchema = z.enum(["open", "assumed", "waived", "resolved"]);

export const GapAssumptionSchema = z
  .object({
    statement: z.string().trim().min(1).max(2_000),
    risk: DecisionRiskSchema,
    expiresAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const GapWaiverSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    approvedBy: z.string().trim().min(1).max(200),
    approvedAt: IsoDateTimeSchema,
  })
  .strict();

export const GapSchema = z
  .object({
    id: GapIdSchema,
    category: GapCategorySchema,
    severity: GapSeveritySchema,
    status: GapStatusSchema,
    title: z.string().trim().min(1).max(200),
    expected: z.string().trim().min(1).max(4_000),
    observed: z.string().trim().min(1).max(4_000),
    impact: z.string().trim().min(1).max(2_000),
    sourceEvidenceIds: z.array(EvidenceIdSchema).default([]),
    owner: AgentRoleSchema.optional(),
    resolutionArtifactIds: z.array(ArtifactIdSchema).default([]),
    assumption: GapAssumptionSchema.optional(),
    waiver: GapWaiverSchema.optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((gap, context) => {
    if (Date.parse(gap.updatedAt) < Date.parse(gap.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt must be after createdAt",
        path: ["updatedAt"],
      });
    }

    if (gap.status === "assumed" && gap.assumption === undefined) {
      context.addIssue({
        code: "custom",
        message: "An assumed gap requires assumption",
        path: ["assumption"],
      });
    }

    if (gap.status !== "assumed" && gap.assumption !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only assumed gaps may include assumption",
        path: ["assumption"],
      });
    }

    if (gap.status === "waived" && gap.waiver === undefined) {
      context.addIssue({
        code: "custom",
        message: "A waived gap requires waiver",
        path: ["waiver"],
      });
    }

    if (gap.status !== "waived" && gap.waiver !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only waived gaps may include waiver",
        path: ["waiver"],
      });
    }

    if (gap.status === "resolved" && gap.resolutionArtifactIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A resolved gap requires at least one resolution artifact",
        path: ["resolutionArtifactIds"],
      });
    }

    if (gap.status !== "resolved" && gap.resolutionArtifactIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Only resolved gaps may include resolutionArtifactIds",
        path: ["resolutionArtifactIds"],
      });
    }
  });

export type GapCategory = z.infer<typeof GapCategorySchema>;
export type GapSeverity = z.infer<typeof GapSeveritySchema>;
export type GapStatus = z.infer<typeof GapStatusSchema>;
export type GapAssumption = z.infer<typeof GapAssumptionSchema>;
export type GapWaiver = z.infer<typeof GapWaiverSchema>;
export type Gap = z.infer<typeof GapSchema>;
