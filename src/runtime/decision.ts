import { z } from "zod";

import { DecisionIdSchema, EvidenceIdSchema } from "./ids.js";
import { IsoDateTimeSchema } from "./scalars.js";

export const DecisionRiskSchema = z.enum(["low", "medium", "high"]);

export const DecisionSchema = z
  .object({
    id: DecisionIdSchema,
    statement: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(4_000),
    risk: DecisionRiskSchema,
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    madeAt: IsoDateTimeSchema,
  })
  .strict();

export type DecisionRisk = z.infer<typeof DecisionRiskSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
