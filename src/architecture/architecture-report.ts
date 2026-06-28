import { z } from "zod";

export const ArchitectureViolationSeveritySchema = z.enum([
  "blocker",
  "major",
  "minor",
  "info",
]);

export const ArchitectureViolationKindSchema = z.enum([
  "fsd-upward-import",
  "cross-slice-deep-import",
  "missing-public-api",
  "ui-direct-fetch",
  "ui-direct-http-client",
  "ui-direct-generated-client",
  "generated-client-outside-api-wrapper",
  "unresolved-internal-import",
]);

export const ArchitectureViolationSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: ArchitectureViolationKindSchema,
    severity: ArchitectureViolationSeveritySchema,
    file: z.string().trim().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    importSpecifier: z.string().optional(),
    message: z.string().trim().min(1),
    recommendation: z.string().trim().min(1),
  })
  .strict();

export const ArchitectureReportSchema = z
  .object({
    adapter: z.literal("architecture-guard-v1"),
    projectRoot: z.string().trim().min(1),
    analyzedAt: z.string().datetime({ offset: true }),
    fileCount: z.number().int().nonnegative(),
    importCount: z.number().int().nonnegative(),
    violationCount: z.number().int().nonnegative(),
    blockerCount: z.number().int().nonnegative(),
    majorCount: z.number().int().nonnegative(),
    minorCount: z.number().int().nonnegative(),
    infoCount: z.number().int().nonnegative(),
    violations: z.array(ArchitectureViolationSchema),
  })
  .strict();

export type ArchitectureViolationSeverity = z.infer<
  typeof ArchitectureViolationSeveritySchema
>;
export type ArchitectureViolationKind = z.infer<typeof ArchitectureViolationKindSchema>;
export type ArchitectureViolation = z.infer<typeof ArchitectureViolationSchema>;
export type ArchitectureReport = z.infer<typeof ArchitectureReportSchema>;

export function createViolationId(index: number): string {
  return `ARCH-${String(index + 1).padStart(4, "0")}`;
}
