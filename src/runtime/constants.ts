export const RUNTIME_CONTRACT_VERSION = "2.0.0" as const;

export const AGENT_ROLES = [
  "orchestrator",
  "implementation",
  "functional-reviewer",
  "design-reviewer",
  "pr-publisher",
] as const;

export const IMPLEMENTATION_AGENT_ROLES = ["implementation"] as const;

export const VERIFICATION_AGENT_ROLES = ["functional-reviewer", "design-reviewer"] as const;

export const PUBLISHING_AGENT_ROLES = ["pr-publisher"] as const;

export const RESULT_STATUSES = ["passed", "failed", "blocked"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type ImplementationAgentRole = (typeof IMPLEMENTATION_AGENT_ROLES)[number];
export type VerificationAgentRole = (typeof VERIFICATION_AGENT_ROLES)[number];
export type PublishingAgentRole = (typeof PUBLISHING_AGENT_ROLES)[number];
export type ResultStatus = (typeof RESULT_STATUSES)[number];
