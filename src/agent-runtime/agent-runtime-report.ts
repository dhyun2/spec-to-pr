import { z } from "zod";

import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema } from "../runtime/scalars.js";
import { RuntimeAgentKindSchema } from "./agent-descriptor.js";

export const AgentWorktreeReportSchema = z
  .object({
    agent: RuntimeAgentKindSchema,
    worktreePath: z.string().trim().min(1),
    branchName: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema,
    contextPackJsonPath: z.string().trim().min(1),
    contextPackMarkdownPath: z.string().trim().min(1),
    contextPackJsonRelativePath: z.string().trim().min(1),
    contextPackMarkdownRelativePath: z.string().trim().min(1),
  })
  .strict();

export const AgentRuntimeReportSchema = z
  .object({
    adapter: z.literal("agent-runtime-v1"),
    runId: RunIdSchema,
    projectRoot: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema,
    worktrees: z.array(AgentWorktreeReportSchema),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const AgentRuntimePreparationResultSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema,
    worktrees: z.array(AgentWorktreeReportSchema),
  })
  .strict();

export type AgentWorktreeReport = z.infer<typeof AgentWorktreeReportSchema>;
export type AgentRuntimeReport = z.infer<typeof AgentRuntimeReportSchema>;
export type AgentRuntimePreparationResult = z.infer<typeof AgentRuntimePreparationResultSchema>;
