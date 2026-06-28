import { z } from "zod";

import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import { ObservabilityGapSchema, ObservabilityPlanSchema } from "./telemetry-plan.js";

export const ObservabilityReportSchema = z
  .object({
    adapter: z.literal("observability-v1"),
    runId: RunIdSchema,
    generatedAt: IsoDateTimeSchema,
    plan: ObservabilityPlanSchema,
    gaps: z.array(ObservabilityGapSchema),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    summary: z.string().trim().min(1),
  })
  .strict();

export type ObservabilityReport = z.infer<typeof ObservabilityReportSchema>;
