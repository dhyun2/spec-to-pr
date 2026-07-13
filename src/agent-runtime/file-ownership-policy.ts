import { z } from "zod";

import { RuntimeAgentKindSchema } from "./agent-descriptor.js";
import type { RuntimeAgentKind } from "./agent-descriptor.js";

export const FileOwnershipRuleSchema = z
  .object({
    pattern: z.string().trim().min(1),
    access: z.enum(["read", "write"]),
    reason: z.string().trim().min(1),
  })
  .strict();

export const AgentFileOwnershipPolicySchema = z
  .object({
    agent: RuntimeAgentKindSchema,
    read: z.array(FileOwnershipRuleSchema).default([]),
    write: z.array(FileOwnershipRuleSchema).default([]),
    forbidden: z.array(FileOwnershipRuleSchema).default([]),
  })
  .strict();

export type FileOwnershipRule = z.infer<typeof FileOwnershipRuleSchema>;
export type AgentFileOwnershipPolicy = z.infer<typeof AgentFileOwnershipPolicySchema>;

export const AGENT_FILE_POLICIES: Record<RuntimeAgentKind, AgentFileOwnershipPolicy> = {
  implementation: AgentFileOwnershipPolicySchema.parse({
    agent: "implementation",
    read: [
      {
        pattern: "**",
        access: "read",
        reason:
          "Inspect requirements, contracts, source, tests, and design evidence in one context.",
      },
    ],
    write: [
      {
        pattern: "src/**",
        access: "write",
        reason: "Implement generated API output, wrappers, UI, and application wiring.",
      },
      {
        pattern: "openspec/changes/**",
        access: "write",
        reason: "Keep implementation-facing specifications and acceptance artifacts aligned.",
      },
      {
        pattern: "tests/**",
        access: "write",
        reason: "Add contract, component, acceptance, and integration evidence.",
      },
    ],
    forbidden: [
      {
        pattern: ".git/**",
        access: "write",
        reason: "Git internals are managed by the runtime.",
      },
      {
        pattern: ".spec-to-pr/**",
        access: "write",
        reason: "Runtime state and context packs are written by the orchestrator.",
      },
    ],
  }),
};

export function getAgentFileOwnershipPolicy(agent: RuntimeAgentKind): AgentFileOwnershipPolicy {
  return AGENT_FILE_POLICIES[RuntimeAgentKindSchema.parse(agent)];
}
