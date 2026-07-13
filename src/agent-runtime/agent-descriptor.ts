import { z } from "zod";

import { IMPLEMENTATION_AGENT_ROLES } from "../runtime/constants.js";
import { ImplementationAgentRoleSchema } from "../runtime/scalars.js";

export const RuntimeAgentKindSchema = z.enum(IMPLEMENTATION_AGENT_ROLES);

export const AgentDescriptorSchema = z
  .object({
    agent: RuntimeAgentKindSchema,
    displayName: z.string().trim().min(1),
    purpose: z.string().trim().min(1),
    stageName: z.string().trim().min(1),
    requiredArtifacts: z.array(z.string().trim().min(1)).default([]),
    expectedOutputs: z.array(z.string().trim().min(1)).default([]),
    defaultBranchPrefix: z.string().trim().min(1),
  })
  .strict();

export type RuntimeAgentKind = z.infer<typeof RuntimeAgentKindSchema>;
export type AgentDescriptor = z.infer<typeof AgentDescriptorSchema>;

export const AGENT_DESCRIPTORS: Record<RuntimeAgentKind, AgentDescriptor> = {
  implementation: AgentDescriptorSchema.parse({
    agent: "implementation",
    displayName: "Implementation Agent",
    purpose:
      "Implement the complete change in one context, including contracts, API code, UI, tests, and application wiring.",
    stageName: "implementation",
    requiredArtifacts: [
      "openspec",
      "gherkin",
      "requirement-graph",
      "openapi-intake-report",
      "api-contract-report",
      "figma-design-context",
      "figma-screenshot",
      "figma-variable-defs",
      "figma-design-contract",
      "test-matrix",
    ],
    expectedOutputs: [
      "API wrapper changes",
      "Generated client verification",
      "FSD UI code",
      "Component states",
      "Fixture route or story",
      "Contract and component tests",
      "Application wiring changes",
      "Browser screenshot plan",
      "Evidence-backed implementation gaps",
    ],
    defaultBranchPrefix: "implementation",
  }),
};

export function getAgentDescriptor(agent: RuntimeAgentKind): AgentDescriptor {
  return AGENT_DESCRIPTORS[ImplementationAgentRoleSchema.parse(agent)];
}

export function listAgentDescriptors(): AgentDescriptor[] {
  return Object.values(AGENT_DESCRIPTORS);
}
