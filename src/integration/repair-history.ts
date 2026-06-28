import { z } from "zod";

import { RunIdSchema } from "../runtime/ids.js";
import { IntegrationConflictReportSchema, RepairAttemptSchema } from "./integration-contracts.js";

export const RepairHistorySchema = z
  .object({
    runId: RunIdSchema,
    policy: z.record(z.string(), z.unknown()),
    conflictReports: z.array(IntegrationConflictReportSchema).default([]),
    attempts: z.array(RepairAttemptSchema).default([]),
  })
  .strict();

export type RepairHistory = z.infer<typeof RepairHistorySchema>;
