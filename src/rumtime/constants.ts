export const RUNTIME_CONTRACT_VERSION = "0.1.0" as const;

export const AGENT_ROLES = [
  "orchestrator",
  "spec-bdd",
  "api-contract",
  "design-ui",
  "integrator",
  "review-council",
  "evidence-verifier",
  "pr-publisher",
] as const;

export const IMPLEMENTATION_AGENT_ROLES = [
  "spec-bdd",
  "api-contract",
  "design-ui",
  "integrator",
] as const;

export const VERIFICATION_AGENT_ROLES = ["review-council", "evidence-verifier"] as const;

export const PUBLISHING_AGENT_ROLES = ["pr-publisher"] as const;

export const RESULT_STATUSES = ["passed", "failed", "blocked"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type ImplementationAgentRole = (typeof IMPLEMENTATION_AGENT_ROLES)[number];
export type VerificationAgentRole = (typeof VERIFICATION_AGENT_ROLES)[number];
export type PublishingAgentRole = (typeof PUBLISHING_AGENT_ROLES)[number];
export type ResultStatus = (typeof RESULT_STATUSES)[number];
