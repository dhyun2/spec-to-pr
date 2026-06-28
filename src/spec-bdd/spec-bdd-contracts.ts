import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";

export const SpecBddFindingSeveritySchema = z.enum(["blocker", "major", "minor", "info"]);

export const SpecBddFindingCategorySchema = z.enum([
  "missing-evidence",
  "over-specified-scenario",
  "missing-scenario",
  "gap-hidden",
  "automation-status-mismatch",
  "acceptance-skeleton",
  "other",
]);

export const SpecBddFindingSchema = z
  .object({
    category: SpecBddFindingCategorySchema,
    severity: SpecBddFindingSeveritySchema,
    title: z.string().trim().min(1).max(200),
    requirementId: z.string().trim().min(1).optional(),
    scenarioId: z.string().trim().min(1).optional(),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    recommendation: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const SpecBddReviewReportSchema = z
  .object({
    adapter: z.literal("spec-bdd-agent-v1"),
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    status: z.enum(["passed", "failed", "blocked"]),
    reviewedAt: IsoDateTimeSchema,
    reviewedRequirements: z.number().int().nonnegative(),
    reviewedScenarios: z.number().int().nonnegative(),
    acceptanceSkeletonCount: z.number().int().nonnegative(),
    findings: z.array(SpecBddFindingSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.status === "passed") {
      const blockingFinding = report.findings.find(
        (finding) => finding.severity === "blocker" || finding.severity === "major",
      );

      if (blockingFinding !== undefined) {
        context.addIssue({
          code: "custom",
          message: "A passed Spec/BDD review cannot contain blocker or major findings",
          path: ["findings"],
        });
      }
    }

    if (report.status === "blocked" && report.findings.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A blocked Spec/BDD review requires at least one finding",
        path: ["findings"],
      });
    }
  });

export type SpecBddFindingSeverity = z.infer<typeof SpecBddFindingSeveritySchema>;
export type SpecBddFindingCategory = z.infer<typeof SpecBddFindingCategorySchema>;
export type SpecBddFinding = z.infer<typeof SpecBddFindingSchema>;
export type SpecBddReviewReport = z.infer<typeof SpecBddReviewReportSchema>;
