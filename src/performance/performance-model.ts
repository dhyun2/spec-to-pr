import { z } from "zod";

export const ViewportProfileSchema = z
  .object({
    name: z.string().trim().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().default(1),
    isMobile: z.boolean().default(false),
  })
  .strict();

export const PerformanceRouteTargetSchema = z
  .object({
    id: z.string().trim().min(1),
    urlPath: z.string().trim().min(1),
    label: z.string().trim().min(1),
    source: z.enum(["openspec", "visual", "manual", "route-discovery"]),
    viewportProfiles: z.array(ViewportProfileSchema).min(1),
  })
  .strict();

export const CoreWebVitalsThresholdsSchema = z
  .object({
    lcpMs: z.number().positive().default(2500),
    inpMs: z.number().positive().default(200),
    cls: z.number().nonnegative().default(0.1),
    tbtMs: z.number().positive().default(200),
  })
  .strict();

export const PerformancePlanSchema = z
  .object({
    runId: z.string().trim().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    baseUrl: z.string().url(),
    routes: z.array(PerformanceRouteTargetSchema),
    thresholds: CoreWebVitalsThresholdsSchema,
    repeats: z.number().int().positive().default(3),
    notes: z.array(z.string()).default([]),
  })
  .strict();

export type ViewportProfile = z.infer<typeof ViewportProfileSchema>;
export type PerformanceRouteTarget = z.infer<typeof PerformanceRouteTargetSchema>;
export type CoreWebVitalsThresholds = z.infer<typeof CoreWebVitalsThresholdsSchema>;
export type PerformancePlan = z.infer<typeof PerformancePlanSchema>;
