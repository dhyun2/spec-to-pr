import { z } from "zod";

export const RepairPolicySchema = z
  .object({
    maxAttempts: z.number().int().nonnegative().default(2),
    allowedChangePatterns: z
      .array(z.string())
      .default([
        "resolve-conflict-markers",
        "fix-import-paths",
        "fix-type-references",
        "formatting",
        "source-guard-import-correction",
      ]),
    forbiddenActions: z
      .array(z.string())
      .default([
        "add-undocumented-endpoint",
        "invent-figma-state",
        "delete-tests",
        "remove-gaps-without-evidence",
        "disable-quality-gates",
        "change-openspec-scope",
      ]),
  })
  .strict();

export type RepairPolicy = z.infer<typeof RepairPolicySchema>;

export function defaultRepairPolicy(maxAttempts = 2): RepairPolicy {
  return RepairPolicySchema.parse({
    maxAttempts,
  });
}
