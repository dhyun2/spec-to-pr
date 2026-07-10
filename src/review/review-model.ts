import { z } from "zod";

import { GapCategorySchema, GapSeveritySchema } from "../runtime/gap.js";
import {
  AgentResultIdSchema,
  ArtifactIdSchema,
  EvidenceIdSchema,
  GapIdSchema,
  RunIdSchema,
} from "../runtime/ids.js";
import { AgentRoleSchema, IsoDateTimeSchema } from "../runtime/scalars.js";

const ReviewFindingIdSchema = z.string().regex(/^rf_[a-f0-9]{32}$/);
const ReviewContradictionIdSchema = z.string().regex(/^rc_[a-f0-9]{32}$/);

export const ReviewFindingCategorySchema = z.enum([
  "missing-evidence",
  "contradiction",
  "gap-policy",
  "ownership",
  "api-contract",
  "design-contract",
  "test-coverage",
  "implementation-claim",
  "security",
  "other",
]);

export const ReviewSeveritySchema = z.enum(["blocker", "major", "minor", "info"]);

export const ReviewFindingStatusSchema = z.enum([
  "open",
  "converted-to-gap",
  "accepted",
  "rejected",
]);

export const RequirementVerdictSchema = z.enum([
  "accepted",
  "partial",
  "blocked",
  "rejected",
  "unverified",
]);

export const ReviewFindingSchema = z
  .object({
    id: ReviewFindingIdSchema,
    category: ReviewFindingCategorySchema,
    severity: ReviewSeveritySchema,
    status: ReviewFindingStatusSchema,
    title: z.string().trim().min(1).max(200),
    expected: z.string().trim().min(1).max(4_000),
    observed: z.string().trim().min(1).max(4_000),
    recommendation: z.string().trim().min(1).max(2_000),
    requirementId: z.string().trim().min(1).optional(),
    agentResultIds: z.array(AgentResultIdSchema).default([]),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const RequirementReviewVerdictSchema = z
  .object({
    requirementId: z.string().trim().min(1),
    verdict: RequirementVerdictSchema,
    reason: z.string().trim().min(1).max(2_000),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    findingIds: z.array(ReviewFindingIdSchema).default([]),
  })
  .strict();

export const ReviewContradictionSchema = z
  .object({
    id: ReviewContradictionIdSchema,
    severity: ReviewSeveritySchema,
    left: z
      .object({
        kind: z.enum(["requirement", "agent-result", "artifact", "gap", "evidence"]),
        id: z.string().trim().min(1),
        summary: z.string().trim().min(1),
      })
      .strict(),
    right: z
      .object({
        kind: z.enum(["requirement", "agent-result", "artifact", "gap", "evidence"]),
        id: z.string().trim().min(1),
        summary: z.string().trim().min(1),
      })
      .strict(),
    explanation: z.string().trim().min(1).max(2_000),
    findingIds: z.array(ReviewFindingIdSchema).default([]),
  })
  .strict();

export const ReviewCouncilResultSchema = z
  .object({
    schemaVersion: z.literal("review-council-v1"),
    runId: RunIdSchema,
    agent: z.literal("review-council"),
    reviewer: AgentRoleSchema.default("review-council"),
    generatedAt: IsoDateTimeSchema,
    summary: z.string().trim().min(1).max(4_000),
    findings: z.array(ReviewFindingSchema).default([]),
    requirementVerdicts: z.array(RequirementReviewVerdictSchema).default([]),
    contradictions: z.array(ReviewContradictionSchema).default([]),
    newGapDrafts: z
      .array(
        z
          .object({
            findingId: ReviewFindingIdSchema,
            category: GapCategorySchema,
            severity: GapSeveritySchema,
            title: z.string().trim().min(1).max(200),
            expected: z.string().trim().min(1).max(4_000),
            observed: z.string().trim().min(1).max(4_000),
            impact: z.string().trim().min(1).max(2_000),
            sourceEvidenceIds: z.array(EvidenceIdSchema).default([]),
            owner: AgentRoleSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    sourceArtifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict()
  .superRefine((result, context) => {
    const findingIds = new Set(result.findings.map((finding) => finding.id));

    result.requirementVerdicts.forEach((verdict, verdictIndex) => {
      verdict.findingIds.forEach((findingId, findingIndex) => {
        if (!findingIds.has(findingId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown finding reference ${findingId}`,
            path: ["requirementVerdicts", verdictIndex, "findingIds", findingIndex],
          });
        }
      });
    });

    result.contradictions.forEach((contradiction, contradictionIndex) => {
      contradiction.findingIds.forEach((findingId, findingIndex) => {
        if (!findingIds.has(findingId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown finding reference ${findingId}`,
            path: ["contradictions", contradictionIndex, "findingIds", findingIndex],
          });
        }
      });
    });

    result.newGapDrafts.forEach((gapDraft, gapIndex) => {
      if (!findingIds.has(gapDraft.findingId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown finding reference ${gapDraft.findingId}`,
          path: ["newGapDrafts", gapIndex, "findingId"],
        });
      }
    });
  });

export type ReviewFindingCategory = z.infer<typeof ReviewFindingCategorySchema>;
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type RequirementReviewVerdict = z.infer<typeof RequirementReviewVerdictSchema>;
export type ReviewContradiction = z.infer<typeof ReviewContradictionSchema>;
export type ReviewCouncilResult = z.infer<typeof ReviewCouncilResultSchema>;
