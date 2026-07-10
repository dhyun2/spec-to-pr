import { z } from "zod";

export const PolicyVerdictSchema = z.enum(["allow", "requires_approval", "deny"]);

export const PolicyRiskSchema = z.enum(["low", "medium", "high", "critical"]);

export const PolicyReasonSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const PolicyDecisionSchema = z
  .object({
    verdict: PolicyVerdictSchema,
    risk: PolicyRiskSchema,
    reasons: z.array(PolicyReasonSchema).min(1),
    requiresApproval: z.boolean(),
    auditTags: z.array(z.string().trim().min(1).max(100)).default([]),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.verdict === "requires_approval" && !decision.requiresApproval) {
      context.addIssue({
        code: "custom",
        message: "requires_approval verdict must set requiresApproval=true",
        path: ["requiresApproval"],
      });
    }

    if (decision.verdict !== "requires_approval" && decision.requiresApproval) {
      context.addIssue({
        code: "custom",
        message: "Only requires_approval verdict may set requiresApproval=true",
        path: ["requiresApproval"],
      });
    }
  });

export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;
export type PolicyRisk = z.infer<typeof PolicyRiskSchema>;
export type PolicyReason = z.infer<typeof PolicyReasonSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export function allow(code: string, message: string, auditTags: string[] = []): PolicyDecision {
  return PolicyDecisionSchema.parse({
    verdict: "allow",
    risk: "low",
    reasons: [{ code, message }],
    requiresApproval: false,
    auditTags,
  });
}

export function requireApproval(
  code: string,
  message: string,
  risk: Exclude<PolicyRisk, "low"> = "medium",
  auditTags: string[] = [],
): PolicyDecision {
  return PolicyDecisionSchema.parse({
    verdict: "requires_approval",
    risk,
    reasons: [{ code, message }],
    requiresApproval: true,
    auditTags,
  });
}

export function deny(
  code: string,
  message: string,
  risk: Extract<PolicyRisk, "high" | "critical"> = "high",
  auditTags: string[] = [],
): PolicyDecision {
  return PolicyDecisionSchema.parse({
    verdict: "deny",
    risk,
    reasons: [{ code, message }],
    requiresApproval: false,
    auditTags,
  });
}

export function combinePolicyDecisions(decisions: PolicyDecision[]): PolicyDecision {
  if (decisions.length === 0) {
    return allow("NO_POLICY", "No policy checks were requested.");
  }

  const denied = decisions.find((decision) => decision.verdict === "deny");

  if (denied !== undefined) {
    return PolicyDecisionSchema.parse({
      verdict: "deny",
      risk: highestRisk(decisions),
      reasons: decisions.flatMap((decision) => decision.reasons),
      requiresApproval: false,
      auditTags: [...new Set(decisions.flatMap((decision) => decision.auditTags))],
    });
  }

  const approval = decisions.find((decision) => decision.verdict === "requires_approval");

  if (approval !== undefined) {
    return PolicyDecisionSchema.parse({
      verdict: "requires_approval",
      risk: highestRisk(decisions),
      reasons: decisions.flatMap((decision) => decision.reasons),
      requiresApproval: true,
      auditTags: [...new Set(decisions.flatMap((decision) => decision.auditTags))],
    });
  }

  return PolicyDecisionSchema.parse({
    verdict: "allow",
    risk: highestRisk(decisions),
    reasons: decisions.flatMap((decision) => decision.reasons),
    requiresApproval: false,
    auditTags: [...new Set(decisions.flatMap((decision) => decision.auditTags))],
  });
}

function highestRisk(decisions: PolicyDecision[]): PolicyRisk {
  const order: PolicyRisk[] = ["low", "medium", "high", "critical"];

  return decisions.reduce<PolicyRisk>((highest, decision) => {
    return order.indexOf(decision.risk) > order.indexOf(highest) ? decision.risk : highest;
  }, "low");
}
