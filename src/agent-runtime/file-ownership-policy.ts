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
  "spec-bdd": AgentFileOwnershipPolicySchema.parse({
    agent: "spec-bdd",
    read: [
      {
        pattern: "openspec/**",
        access: "read",
        reason: "Read generated OpenSpec change artifacts.",
      },
      {
        pattern: "docs/**",
        access: "read",
        reason: "Read documentation if referenced by evidence.",
      },
    ],
    write: [
      {
        pattern: "openspec/changes/**",
        access: "write",
        reason: "Refine OpenSpec, Gherkin, and test matrix artifacts.",
      },
      {
        pattern: "tests/acceptance/**",
        access: "write",
        reason: "Create acceptance test skeletons only when explicitly requested.",
      },
    ],
    forbidden: [
      {
        pattern: "src/shared/api/generated/**",
        access: "write",
        reason: "Generated API output belongs to API Contract Agent.",
      },
      {
        pattern: "src/**/ui/**",
        access: "write",
        reason: "UI implementation belongs to Design/UI Agent.",
      },
    ],
  }),

  "api-contract": AgentFileOwnershipPolicySchema.parse({
    agent: "api-contract",
    read: [
      {
        pattern: "openspec/**",
        access: "read",
        reason: "Read API-related requirements.",
      },
      {
        pattern: "src/shared/api/generated/**",
        access: "read",
        reason: "Inspect existing generated API clients.",
      },
    ],
    write: [
      {
        pattern: "src/shared/api/generated/**",
        access: "write",
        reason: "Update generated API output when generator policy allows it.",
      },
      {
        pattern: "src/entities/**/api/**",
        access: "write",
        reason: "Create entity-level API mappers or schemas.",
      },
      {
        pattern: "src/features/**/api/**",
        access: "write",
        reason: "Create feature API wrappers.",
      },
      {
        pattern: "tests/contract/**",
        access: "write",
        reason: "Create contract test skeletons.",
      },
    ],
    forbidden: [
      {
        pattern: "src/pages/**/ui/**",
        access: "write",
        reason: "Page UI belongs to Design/UI Agent.",
      },
      {
        pattern: "src/widgets/**/ui/**",
        access: "write",
        reason: "Widget UI belongs to Design/UI Agent.",
      },
    ],
  }),

  "design-ui": AgentFileOwnershipPolicySchema.parse({
    agent: "design-ui",
    read: [
      {
        pattern: "openspec/**",
        access: "read",
        reason: "Read behavior requirements and gaps.",
      },
      {
        pattern: "src/shared/ui/**",
        access: "read",
        reason: "Inspect existing design-system components.",
      },
    ],
    write: [
      {
        pattern: "src/pages/**",
        access: "write",
        reason: "Implement route-level pages when required.",
      },
      {
        pattern: "src/widgets/**",
        access: "write",
        reason: "Implement composed UI widgets.",
      },
      {
        pattern: "src/features/**/ui/**",
        access: "write",
        reason: "Implement feature UI states.",
      },
      {
        pattern: "src/entities/**/ui/**",
        access: "write",
        reason: "Implement entity UI parts.",
      },
      {
        pattern: "tests/component/**",
        access: "write",
        reason: "Create component test skeletons.",
      },
    ],
    forbidden: [
      {
        pattern: "src/shared/api/generated/**",
        access: "write",
        reason: "Generated API output belongs to API Contract Agent.",
      },
      {
        pattern: "src/features/**/api/**",
        access: "write",
        reason: "Feature API wrapper belongs to API Contract Agent.",
      },
    ],
  }),

  integrator: AgentFileOwnershipPolicySchema.parse({
    agent: "integrator",
    read: [
      {
        pattern: "**",
        access: "read",
        reason: "Integrator needs to inspect all agent outputs.",
      },
    ],
    write: [
      {
        pattern: "src/app/**",
        access: "write",
        reason: "Wire providers, routes, and application shell.",
      },
      {
        pattern: "src/pages/**/index.ts",
        access: "write",
        reason: "Update public page exports.",
      },
      {
        pattern: "src/widgets/**/index.ts",
        access: "write",
        reason: "Update public widget exports.",
      },
      {
        pattern: "src/features/**/index.ts",
        access: "write",
        reason: "Update public feature exports.",
      },
      {
        pattern: "src/entities/**/index.ts",
        access: "write",
        reason: "Update public entity exports.",
      },
    ],
    forbidden: [
      {
        pattern: "src/shared/api/generated/**",
        access: "write",
        reason: "Integrator must not edit generated code.",
      },
    ],
  }),
};

export function getAgentFileOwnershipPolicy(
  agent: RuntimeAgentKind,
): AgentFileOwnershipPolicy {
  return AGENT_FILE_POLICIES[RuntimeAgentKindSchema.parse(agent)];
}
