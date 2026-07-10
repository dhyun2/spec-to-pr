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
  "spec-bdd": AgentDescriptorSchema.parse({
    agent: "spec-bdd",
    displayName: "Spec/BDD Agent",
    purpose:
      "Refine OpenSpec, Gherkin, test matrix, and acceptance-test planning from evidence-backed requirements.",
    stageName: "spec-bdd",
    requiredArtifacts: ["openspec", "gherkin", "test-matrix", "requirement-graph"],
    expectedOutputs: [
      "OpenSpec refinement",
      "Gherkin refinement",
      "Acceptance test plan",
      "Spec gaps",
      "Implementation-independent validation",
    ],
    defaultBranchPrefix: "spec-bdd",
  }),

  "api-contract": AgentDescriptorSchema.parse({
    agent: "api-contract",
    displayName: "API Contract Agent",
    purpose:
      "Implement or refine API generated outputs, feature wrappers, mocks, and contract tests using OpenAPI evidence.",
    stageName: "api-agent",
    requiredArtifacts: ["openapi-intake-report", "api-contract-report", "test-matrix"],
    expectedOutputs: [
      "API wrapper changes",
      "Generated client verification",
      "Mock skeletons",
      "Contract test skeletons",
      "API gaps",
    ],
    defaultBranchPrefix: "api-contract",
  }),

  "design-ui": AgentDescriptorSchema.parse({
    agent: "design-ui",
    displayName: "Design/UI Agent",
    purpose:
      "Implement Figma-backed UI using the project design system and the generated design contract.",
    stageName: "design-ui",
    requiredArtifacts: [
      "figma-design-context",
      "figma-screenshot",
      "figma-variable-defs",
      "figma-design-contract",
      "test-matrix",
    ],
    expectedOutputs: [
      "FSD UI code",
      "Component states",
      "Fixture route or story",
      "Component tests",
      "Browser screenshot plan",
      "Design gaps",
    ],
    defaultBranchPrefix: "design-ui",
  }),

  integrator: AgentDescriptorSchema.parse({
    agent: "integrator",
    displayName: "Integrator",
    purpose:
      "Integrate isolated agent outputs into application wiring, route/provider composition, and public API exports.",
    stageName: "integration",
    requiredArtifacts: ["openspec", "test-matrix", "api-contract-report", "figma-design-contract"],
    expectedOutputs: [
      "Integration commit plan",
      "Conflict report",
      "Application wiring changes",
      "Integration gaps",
    ],
    defaultBranchPrefix: "integrator",
  }),
};

export function getAgentDescriptor(agent: RuntimeAgentKind): AgentDescriptor {
  return AGENT_DESCRIPTORS[ImplementationAgentRoleSchema.parse(agent)];
}

export function listAgentDescriptors(): AgentDescriptor[] {
  return Object.values(AGENT_DESCRIPTORS);
}
