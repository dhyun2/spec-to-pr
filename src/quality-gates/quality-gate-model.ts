import { z } from "zod";

import { CheckKindSchema, CheckResultSchema } from "../runtime/check.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";

export const QUALITY_GATE_ORDER = [
  "lint",
  "typecheck",
  "build",
  "unit",
  "component",
  "contract",
  "acceptance",
] as const;

export const QualityGateNameSchema = z.enum(QUALITY_GATE_ORDER);

export const QualityGatePackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun", "unknown"]);

export const QualityGateCommandOverrideSchema = z
  .object({
    command: z.string().trim().min(1),
    args: z.array(z.string().min(1)).default([]),
    cwd: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict();

export const PlannedQualityGateSchema = z
  .object({
    gate: QualityGateNameSchema,
    kind: CheckKindSchema,
    status: z.literal("planned"),
    script: z.string().trim().min(1).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string().min(1)),
    cwd: z.string().trim().min(1),
    timeoutMs: z.number().int().positive().max(600_000),
  })
  .strict();

export const SkippedQualityGateSchema = z
  .object({
    gate: QualityGateNameSchema,
    kind: CheckKindSchema,
    status: z.literal("skipped"),
    skipReason: z.string().trim().min(1),
  })
  .strict();

export const QualityGatePlanItemSchema = z.discriminatedUnion("status", [
  PlannedQualityGateSchema,
  SkippedQualityGateSchema,
]);

export const QualityGatePlanSchema = z
  .object({
    packageManager: QualityGatePackageManagerSchema,
    projectRoot: z.string().trim().min(1),
    gates: z.array(QualityGatePlanItemSchema),
  })
  .strict();

export const QualityGateExecutionSchema = z
  .object({
    gate: QualityGateNameSchema,
    kind: CheckKindSchema,
    status: z.enum(["passed", "failed", "skipped"]),
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string().min(1)).default([]),
    cwd: z.string().trim().min(1).optional(),
    exitCode: z.number().int().optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    stdout: z.string().default(""),
    stderr: z.string().default(""),
    summary: z.string().trim().min(1),
    failureReason: z.string().trim().min(1).optional(),
    skipReason: z.string().trim().min(1).optional(),
  })
  .strict();

export const CoverageMetricSchema = z
  .object({
    total: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    pct: z.number().nonnegative(),
  })
  .strict();

export const CoverageSummarySchema = z
  .object({
    path: z.string().trim().min(1),
    lines: CoverageMetricSchema,
    statements: CoverageMetricSchema,
    functions: CoverageMetricSchema,
    branches: CoverageMetricSchema,
  })
  .strict();

export const QualityGateReportSchema = z
  .object({
    adapter: z.literal("quality-gate-runner-v1"),
    runId: RunIdSchema,
    projectRoot: z.string().trim().min(1),
    packageManager: QualityGatePackageManagerSchema,
    status: z.enum(["passed", "failed"]),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    durationMs: z.number().int().nonnegative(),
    gateCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    checks: z.array(CheckResultSchema),
    coverageSummary: CoverageSummarySchema.optional(),
    coverageArtifactId: ArtifactIdSchema.optional(),
    warnings: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type QualityGateName = z.infer<typeof QualityGateNameSchema>;
export type QualityGatePackageManager = z.infer<typeof QualityGatePackageManagerSchema>;
export type QualityGateCommandOverride = z.infer<typeof QualityGateCommandOverrideSchema>;
export type PlannedQualityGate = z.infer<typeof PlannedQualityGateSchema>;
export type SkippedQualityGate = z.infer<typeof SkippedQualityGateSchema>;
export type QualityGatePlanItem = z.infer<typeof QualityGatePlanItemSchema>;
export type QualityGatePlan = z.infer<typeof QualityGatePlanSchema>;
export type QualityGateExecution = z.infer<typeof QualityGateExecutionSchema>;
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;
export type QualityGateReport = z.infer<typeof QualityGateReportSchema>;
