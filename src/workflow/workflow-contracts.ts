import { z } from "zod";

import { RunIdSchema } from "../runtime/ids.js";

export const WorkflowScopeSchema = z
  .object({
    code: z.boolean(),
    ui: z.boolean(),
    api: z.boolean(),
    specification: z.boolean(),
    hasVisualBaseline: z.boolean(),
    securitySensitive: z.boolean(),
    performanceSensitive: z.boolean(),
    observabilityRequested: z.boolean(),
  })
  .strict();

export const ReviewVerdictSchema = z.enum(["approved", "changes-requested", "blocked"]);
export const ReviewFindingSeveritySchema = z.enum(["minor", "major", "blocker"]);
export const RequirementVerdictSchema = z.enum(["accepted", "rejected", "blocked"]);
export const WorkflowGateIdSchema = z.enum([
  "functional",
  "openspec",
  "architecture",
  "security",
  "visual",
  "accessibility",
  "performance",
  "observability",
  "release",
]);

const ReviewFindingSchema = z
  .object({
    severity: ReviewFindingSeveritySchema,
    title: z.string().trim().min(1).max(500),
    evidence: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const ReviewRequirementSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    verdict: RequirementVerdictSchema,
  })
  .strict();

const ReviewGateResultSchema = z
  .object({
    id: WorkflowGateIdSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    evidencePaths: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const ReviewSubmissionSchema = z
  .object({
    kind: z.enum(["functional-review", "design-review"]),
    verdict: ReviewVerdictSchema,
    summary: z.string().trim().min(1).max(4_000),
    findings: z.array(ReviewFindingSchema).default([]),
    requirements: z.array(ReviewRequirementSchema).default([]),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
    gateResults: z.array(ReviewGateResultSchema).default([]),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.verdict !== "approved") {
      return;
    }

    if (review.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Approved reviews require concrete evidence artifacts",
      });
    }

    if (review.requirements.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requirements"],
        message: "Approved reviews require at least one reviewed requirement",
      });
    }

    if (review.gateResults.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["gateResults"],
        message: "Approved reviews require structured gate results",
      });
    }

    const seenGateIds = new Set<string>();
    review.gateResults.forEach((gate, index) => {
      if (seenGateIds.has(gate.id)) {
        context.addIssue({
          code: "custom",
          path: ["gateResults", index, "id"],
          message: `Duplicate gate result ${gate.id}`,
        });
      }
      seenGateIds.add(gate.id);

      if (gate.status !== "passed") {
        context.addIssue({
          code: "custom",
          path: ["gateResults", index, "status"],
          message: "Approved reviews require every reported gate to pass",
        });
      }

      gate.evidencePaths.forEach((evidencePath, evidenceIndex) => {
        if (!review.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["gateResults", index, "evidencePaths", evidenceIndex],
            message: "Gate evidence must be included in artifactPaths",
          });
        }
      });
    });

    review.findings.forEach((finding, index) => {
      if (finding.severity === "major" || finding.severity === "blocker") {
        context.addIssue({
          code: "custom",
          path: ["findings", index, "severity"],
          message: "Approved reviews cannot contain major or blocker findings",
        });
      }
    });

    review.requirements.forEach((requirement, index) => {
      if (requirement.verdict !== "accepted") {
        context.addIssue({
          code: "custom",
          path: ["requirements", index, "verdict"],
          message: "Approved reviews require every reviewed requirement to be accepted",
        });
      }
    });
  });

export const ContractsSubmissionSchema = z
  .object({
    kind: z.literal("contracts"),
    status: z.enum(["passed", "failed", "blocked"]),
    summary: z.string().trim().min(1).max(4_000),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "passed" && submission.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Passed contracts require generated contract artifacts",
      });
    }
  });

export const ImplementationSubmissionSchema = z
  .object({
    kind: z.literal("implementation"),
    status: z.enum(["passed", "failed", "blocked"]),
    summary: z.string().trim().min(1).max(4_000),
    apiReady: z.boolean(),
    uiChanged: z.boolean(),
    changedFiles: z.array(z.string().trim().min(1)).default([]),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "passed" && submission.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Passed implementation requires executable evidence artifacts",
      });
    }

    if (submission.status === "passed" && submission.uiChanged && !submission.apiReady) {
      context.addIssue({
        code: "custom",
        path: ["apiReady"],
        message: "UI implementation requires the api-ready checkpoint",
      });
    }
  });

export const FigmaBundleSubmissionSchema = z
  .object({
    kind: z.literal("figma-bundle"),
    fileUrl: z.string().url(),
    nodeIds: z.array(z.string().trim().min(1)).default([]),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const WorkflowSubmissionSchema = z.union([
  ContractsSubmissionSchema,
  ImplementationSubmissionSchema,
  ReviewSubmissionSchema,
  FigmaBundleSubmissionSchema,
]);

export const WorkflowActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prepare-contracts"), runId: RunIdSchema }).strict(),
  z
    .object({
      kind: z.literal("implement"),
      runId: RunIdSchema,
      requireApiReady: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("review-functional"), runId: RunIdSchema }).strict(),
  z.object({ kind: z.literal("review-design"), runId: RunIdSchema }).strict(),
  z.object({ kind: z.literal("publish-draft"), runId: RunIdSchema }).strict(),
  z.object({ kind: z.literal("archive-after-merge"), runId: RunIdSchema }).strict(),
]);

export const WorkflowStageSummarySchema = z
  .object({
    name: z.string().trim().min(1),
    status: z.enum(["pending", "running", "passed", "failed", "blocked", "skipped", "waived"]),
  })
  .strict();

export const WorkflowStatusSchema = z
  .object({
    runId: RunIdSchema,
    status: z.enum(["running", "needs-external-action", "blocked", "publish-ready", "completed"]),
    currentStage: z.string().trim().min(1).optional(),
    scope: WorkflowScopeSchema,
    stages: z.array(WorkflowStageSummarySchema),
    nextActions: z.array(WorkflowActionSchema),
    blockers: z.array(z.string().trim().min(1)),
    artifactIds: z.array(z.string().trim().min(1)),
  })
  .strict();

export type WorkflowScope = z.infer<typeof WorkflowScopeSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type WorkflowSubmission = z.infer<typeof WorkflowSubmissionSchema>;
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
