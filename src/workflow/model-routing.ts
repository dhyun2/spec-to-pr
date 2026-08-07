import { z } from "zod";

/**
 * The workflow core deliberately knows roles, not vendor model names. Host
 * adapters resolve these roles to their own catalog before workflow_start.
 */
export const ModelRoleSchema = z.enum(["fast", "build", "expert"]);
export const ModelProviderSchema = z.enum(["codex", "claude"]);
export const ModelRoutingStrategySchema = z.enum(["adaptive-verified", "pinned", "custom"]);

const NamedRoleModelsSchema = z
  .object({
    fast: z.string().trim().min(1).max(200),
    build: z.string().trim().min(1).max(200),
    expert: z.string().trim().min(1).max(200),
  })
  .strict();

export const ModelRoutingQualityGapSchema = z
  .object({
    role: ModelRoleSchema,
    requestedModel: z.string().trim().min(1).max(200),
    actualModel: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const ModelRoutingRequestSchema = z
  .object({
    strategy: ModelRoutingStrategySchema.default("adaptive-verified"),
    pinnedModel: z.string().trim().min(1).max(200).optional(),
    customModels: NamedRoleModelsSchema.optional(),
    qualityGaps: z.array(ModelRoutingQualityGapSchema).max(10).default([]),
  })
  .strict()
  .superRefine((routing, context) => {
    if (routing.strategy === "pinned" && routing.pinnedModel === undefined) {
      context.addIssue({
        code: "custom",
        path: ["pinnedModel"],
        message: "pinned model routing requires pinnedModel",
      });
    }
    if (routing.strategy === "custom" && routing.customModels === undefined) {
      context.addIssue({
        code: "custom",
        path: ["customModels"],
        message: "custom model routing requires fast, build, and expert models",
      });
    }
    if (routing.strategy === "adaptive-verified" && routing.pinnedModel !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["pinnedModel"],
        message: "adaptive-verified routing cannot pin a model",
      });
    }
    if (routing.strategy !== "custom" && routing.customModels !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["customModels"],
        message: "customModels are valid only with custom routing",
      });
    }
  });

export const ModelRoutingSchema = ModelRoutingRequestSchema.extend({
  provider: ModelProviderSchema,
}).strict();

export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelRoutingRequest = z.infer<typeof ModelRoutingRequestSchema>;
export type ModelRouting = z.infer<typeof ModelRoutingSchema>;

export function resolveModelRouting(input: {
  provider: ModelProvider;
  routing?: ModelRoutingRequest;
}): ModelRouting {
  return ModelRoutingSchema.parse({
    provider: input.provider,
    ...(input.routing ?? { strategy: "adaptive-verified" }),
  });
}
