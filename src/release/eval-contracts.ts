import { z } from "zod";

export const EvalCaseKindSchema = z.enum([
  "brief",
  "figma",
  "openapi",
  "traceability",
  "openspec",
  "gherkin",
  "api-pipeline",
  "design-contract",
  "quality",
  "visual",
  "security",
  "release",
]);

export const EvalCaseExpectedOutcomeSchema = z
  .object({
    mustPass: z.boolean(),
    expectedArtifacts: z.array(z.string()).default([]),
    expectedGaps: z.array(z.string()).default([]),
    forbiddenArtifacts: z.array(z.string()).default([]),
    forbiddenClaims: z.array(z.string()).default([]),
  })
  .strict();

export const EvalCaseSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    kind: EvalCaseKindSchema,
    description: z.string().trim().min(1),
    fixturePath: z.string().trim().min(1),
    expected: EvalCaseExpectedOutcomeSchema,
  })
  .strict();

export const EvalCaseStatusSchema = z.enum(["passed", "failed", "skipped"]);

export const EvalCaseResultSchema = z
  .object({
    caseId: z.string().trim().min(1),
    status: EvalCaseStatusSchema,
    durationMs: z.number().int().nonnegative(),
    summary: z.string().trim().min(1),
    failures: z.array(z.string()).default([]),
    artifacts: z.array(z.string()).default([]),
  })
  .strict();

export const EvalSuiteReportSchema = z
  .object({
    suiteId: z.string().trim().min(1),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    status: z.enum(["passed", "failed"]),
    caseCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    results: z.array(EvalCaseResultSchema),
  })
  .strict();

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;
export type EvalSuiteReport = z.infer<typeof EvalSuiteReportSchema>;
