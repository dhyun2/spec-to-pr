import { z } from "zod";

import { OpenSpecChangeNameSchema } from "../openspec/openspec-paths.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { OpenSpecArchivePlan } from "./archive-plan.js";

export const OpenSpecArchiveResultStatusSchema = z.enum(["passed", "failed", "blocked"]);

export const OpenSpecArchiveResultSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    status: OpenSpecArchiveResultStatusSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    archiveCommand: z.string().trim().min(1),
    polling: z.literal(false),
    exitCode: z.number().int().optional(),
    archivePath: z.string().trim().min(1).optional(),
    stdoutArtifactId: ArtifactIdSchema.optional(),
    stderrArtifactId: ArtifactIdSchema.optional(),
    reportArtifactId: ArtifactIdSchema.optional(),
    followUpCommitRequired: z.boolean(),
    summary: z.string().trim().min(1),
  })
  .strict();

export type OpenSpecArchiveResult = z.infer<typeof OpenSpecArchiveResultSchema>;

export function renderOpenSpecArchiveReport(input: {
  plan: OpenSpecArchivePlan;
  result: OpenSpecArchiveResult;
}): string {
  return [
    `# OpenSpec Archive Report - ${input.plan.changeName}`,
    "",
    "## Merge Evidence",
    "",
    `- Review request URL: ${input.plan.reviewRequestUrl ?? "-"}`,
    `- Merge evidence ID: ${input.plan.mergeEvidenceId ?? "-"}`,
    `- Polling: ${input.plan.polling}`,
    "",
    "## Plan",
    "",
    `- Status: ${input.plan.status}`,
    `- Execute allowed: ${input.plan.executeAllowed}`,
    `- Command: \`${input.plan.archiveCommand}\``,
    `- Expected change root: ${input.plan.expectedChangeRoot}`,
    `- Expected archive root: ${input.plan.expectedArchiveRoot}`,
    `- Follow-up commit required: ${input.plan.followUpCommitRequired}`,
    "",
    "## Blocking Reasons",
    "",
    ...(input.plan.blockingReasons.length === 0
      ? ["- None"]
      : input.plan.blockingReasons.map((reason) => `- ${reason}`)),
    "",
    "## Result",
    "",
    `- Status: ${input.result.status}`,
    `- Exit code: ${input.result.exitCode ?? "-"}`,
    `- Archive path: ${input.result.archivePath ?? "-"}`,
    `- Summary: ${input.result.summary}`,
    "",
  ].join("\n");
}
