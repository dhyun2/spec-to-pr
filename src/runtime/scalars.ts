import { z } from "zod";

import {
  AGENT_ROLES,
  IMPLEMENTATION_AGENT_ROLES,
  PUBLISHING_AGENT_ROLES,
  RESULT_STATUSES,
  RUNTIME_CONTRACT_VERSION,
  VERIFICATION_AGENT_ROLES,
} from "./constants.js";

export const RuntimeContractVersionSchema = z.literal(RUNTIME_CONTRACT_VERSION);

export const IsoDateTimeSchema = z.string().datetime({
  offset: true,
});

export const Sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 lowercase hex characters>");

export const GitObjectIdSchema = z.string().regex(/^[a-f0-9]{7,64}$/i, "Expected a Git object id");

export const RelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), {
    message: "Path must not have surrounding whitespace",
  })
  .refine((value) => !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value), {
    message: "Expected a relative path",
  })
  .refine((value) => !value.split(/[\\/]+/).includes(".."), {
    message: "Path traversal segments are not allowed",
  });

export const AgentRoleSchema = z.enum(AGENT_ROLES);
export const ImplementationAgentRoleSchema = z.enum(IMPLEMENTATION_AGENT_ROLES);
export const VerificationAgentRoleSchema = z.enum(VERIFICATION_AGENT_ROLES);
export const PublishingAgentRoleSchema = z.enum(PUBLISHING_AGENT_ROLES);
export const ResultStatusSchema = z.enum(RESULT_STATUSES);

export type RuntimeContractVersion = z.infer<typeof RuntimeContractVersionSchema>;
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type Sha256Digest = z.infer<typeof Sha256DigestSchema>;
export type GitObjectId = z.infer<typeof GitObjectIdSchema>;
export type RelativePath = z.infer<typeof RelativePathSchema>;
export type RuntimeAgentRole = z.infer<typeof AgentRoleSchema>;
export type RuntimeResultStatus = z.infer<typeof ResultStatusSchema>;
