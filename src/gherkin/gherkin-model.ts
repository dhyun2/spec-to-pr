import { z } from "zod";

import { EvidenceIdSchema, GapIdSchema } from "../runtime/ids.js";

export const GherkinStepKeywordSchema = z.enum(["Given", "When", "Then", "And", "But"]);

export const GherkinTagSchema = z
  .string()
  .trim()
  .min(2)
  .regex(/^@[A-Za-z0-9_:.~-]+$/, "Expected a Gherkin tag such as @REQ:REQ-001");

export const GherkinStepSchema = z
  .object({
    keyword: GherkinStepKeywordSchema,
    text: z.string().trim().min(1),
  })
  .strict();

export const GherkinScenarioStatusSchema = z.enum([
  "automated-candidate",
  "review-needed",
  "manual",
  "blocked",
]);

export const GherkinScenarioSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    requirementId: z.string().trim().min(1),
    status: GherkinScenarioStatusSchema,
    tags: z.array(GherkinTagSchema).default([]),
    steps: z.array(GherkinStepSchema).min(1),
    briefEvidenceIds: z.array(EvidenceIdSchema).default([]),
    figmaEvidenceIds: z.array(EvidenceIdSchema).default([]),
    openApiEvidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const GherkinRuleSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    scenarios: z.array(GherkinScenarioSchema).default([]),
  })
  .strict();

export const GherkinFeatureSchema = z
  .object({
    area: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    tags: z.array(GherkinTagSchema).default([]),
    rules: z.array(GherkinRuleSchema).default([]),
  })
  .strict();

export const GherkinBundleSchema = z
  .object({
    changeName: z.string().trim().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    features: z.array(GherkinFeatureSchema),
  })
  .strict();

export type GherkinStepKeyword = z.infer<typeof GherkinStepKeywordSchema>;
export type GherkinTag = z.infer<typeof GherkinTagSchema>;
export type GherkinStep = z.infer<typeof GherkinStepSchema>;
export type GherkinScenarioStatus = z.infer<typeof GherkinScenarioStatusSchema>;
export type GherkinScenario = z.infer<typeof GherkinScenarioSchema>;
export type GherkinRule = z.infer<typeof GherkinRuleSchema>;
export type GherkinFeature = z.infer<typeof GherkinFeatureSchema>;
export type GherkinBundle = z.infer<typeof GherkinBundleSchema>;
