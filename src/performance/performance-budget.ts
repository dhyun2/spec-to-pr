import { z } from "zod";

export const ResourceBudgetSchema = z
  .object({
    resourceType: z.enum(["script", "stylesheet", "image", "font", "document", "other"]),
    maxTransferBytes: z.number().int().positive(),
  })
  .strict();

export const BundleBudgetSchema = z
  .object({
    maxInitialJsBytes: z.number().int().positive().default(300_000),
    maxInitialCssBytes: z.number().int().positive().default(100_000),
    maxImageBytes: z.number().int().positive().default(500_000),
    maxFontBytes: z.number().int().positive().default(200_000),
    resources: z.array(ResourceBudgetSchema).default([]),
  })
  .strict();

export const BudgetCheckFailureSchema = z
  .object({
    kind: z.string().trim().min(1),
    observedBytes: z.number().int().nonnegative(),
    budgetBytes: z.number().int().positive(),
    message: z.string().trim().min(1),
  })
  .strict();

export const BudgetCheckResultSchema = z
  .object({
    passed: z.boolean(),
    failures: z.array(BudgetCheckFailureSchema),
  })
  .strict();

export type ResourceBudget = z.infer<typeof ResourceBudgetSchema>;
export type BundleBudget = z.infer<typeof BundleBudgetSchema>;
export type BudgetCheckFailure = z.infer<typeof BudgetCheckFailureSchema>;
export type BudgetCheckResult = z.infer<typeof BudgetCheckResultSchema>;
