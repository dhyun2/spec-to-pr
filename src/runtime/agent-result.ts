import { z } from "zod";

import {
  AgentResultIdSchema,
  ArtifactIdSchema,
  EvidenceIdSchema,
  GapIdSchema,
  RunIdSchema,
} from "./ids.js";
import {
  GitObjectIdSchema,
  ImplementationAgentRoleSchema,
  IsoDateTimeSchema,
  PublishingAgentRoleSchema,
  RelativePathSchema,
  ResultStatusSchema,
  RuntimeContractVersionSchema,
  VerificationAgentRoleSchema,
} from "./scalars.js";
import { CheckResultSchema } from "./check.js";
import { DecisionSchema } from "./decision.js";

const BaseAgentResultShape = {
  schemaVersion: RuntimeContractVersionSchema,
  id: AgentResultIdSchema,
  runId: RunIdSchema,
  status: ResultStatusSchema,
  baseSha: GitObjectIdSchema,
  evidenceIds: z.array(EvidenceIdSchema).default([]),
  artifactIds: z.array(ArtifactIdSchema).default([]),
  gapIds: z.array(GapIdSchema).default([]),
  checks: z.array(CheckResultSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
} as const;

type CommonResult = {
  status: "passed" | "failed" | "blocked";
  gapIds: string[];
  checks: Array<{ status: "passed" | "failed" | "skipped" }>;
  startedAt: string;
  completedAt: string;
};

function addCommonResultIssues(result: CommonResult, context: z.RefinementCtx): void {
  if (Date.parse(result.completedAt) < Date.parse(result.startedAt)) {
    context.addIssue({
      code: "custom",
      message: "completedAt must be after startedAt",
      path: ["completedAt"],
    });
  }

  if (result.status === "passed" && result.checks.some((check) => check.status === "failed")) {
    context.addIssue({
      code: "custom",
      message: "A passed agent result cannot contain failed checks",
      path: ["checks"],
    });
  }

  if (result.status === "blocked" && result.gapIds.length === 0) {
    context.addIssue({
      code: "custom",
      message: "A blocked agent result must reference at least one gap",
      path: ["gapIds"],
    });
  }
}

export const ImplementationAgentResultSchema = z
  .object({
    ...BaseAgentResultShape,
    kind: z.literal("implementation"),
    agent: ImplementationAgentRoleSchema,
    commitSha: GitObjectIdSchema.optional(),
    changedFiles: z.array(RelativePathSchema).default([]),
  })
  .strict()
  .superRefine((result, context) => {
    addCommonResultIssues(result, context);

    if (result.status === "passed" && result.commitSha === undefined) {
      context.addIssue({
        code: "custom",
        message: "A passed implementation result requires commitSha",
        path: ["commitSha"],
      });
    }
  });

export const VerificationAgentResultSchema = z
  .object({
    ...BaseAgentResultShape,
    kind: z.literal("verification"),
    agent: VerificationAgentRoleSchema,
    changedFiles: z.array(RelativePathSchema).default([]),
  })
  .strict()
  .superRefine((result, context) => {
    addCommonResultIssues(result, context);

    if (result.changedFiles.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Verification results must not change repository files",
        path: ["changedFiles"],
      });
    }

    if (result.status === "passed" && result.artifactIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A passed verification result requires at least one report artifact",
        path: ["artifactIds"],
      });
    }
  });

export const PublishingAgentResultSchema = z
  .object({
    ...BaseAgentResultShape,
    kind: z.literal("publishing"),
    agent: PublishingAgentRoleSchema,
    target: z.enum(["github", "gitlab"]),
    prUrl: z.string().url().optional(),
    prNumber: z.string().trim().min(1).optional(),
    draft: z.boolean(),
    reportArtifactId: ArtifactIdSchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    addCommonResultIssues(result, context);

    if (result.status === "passed" && result.prUrl === undefined) {
      context.addIssue({
        code: "custom",
        message: "A passed publishing result requires prUrl",
        path: ["prUrl"],
      });
    }

    if (result.status === "passed" && result.reportArtifactId === undefined) {
      context.addIssue({
        code: "custom",
        message: "A passed publishing result requires reportArtifactId",
        path: ["reportArtifactId"],
      });
    }
  });

export const AgentResultSchema = z.discriminatedUnion("kind", [
  ImplementationAgentResultSchema,
  VerificationAgentResultSchema,
  PublishingAgentResultSchema,
]);

export type ImplementationAgentResult = z.infer<typeof ImplementationAgentResultSchema>;
export type VerificationAgentResult = z.infer<typeof VerificationAgentResultSchema>;
export type PublishingAgentResult = z.infer<typeof PublishingAgentResultSchema>;
export type AgentResult = z.infer<typeof AgentResultSchema>;
