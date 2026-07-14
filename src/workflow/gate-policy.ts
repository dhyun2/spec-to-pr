import { z } from "zod";

import {
  WorkflowGateIdSchema,
  WorkflowScopeSchema,
  type WorkflowScope,
} from "./workflow-contracts.js";

export const GateApplicabilitySchema = z.enum([
  "required",
  "conditional",
  "opt-in",
  "release-only",
  "not-applicable",
]);

export const WorkflowGateSchema = z
  .object({
    id: WorkflowGateIdSchema,
    applicability: GateApplicabilitySchema,
    reason: z.string().trim().min(1),
  })
  .strict();

export type WorkflowGate = z.infer<typeof WorkflowGateSchema>;

export function classifyWorkflowScope(input: {
  requestText: string;
  figmaUrls?: string[];
  explicitScope?: "auto" | "ui" | "non-ui" | "docs";
}): WorkflowScope {
  const text = input.requestText.toLowerCase();
  const figmaUrls = input.figmaUrls ?? [];
  const explicit = input.explicitScope ?? "auto";
  const hasUiTerms =
    /\b(ui|ux|screen|page|component|frontend|figma|visual|design|css|react|vue)\b/i.test(text) ||
    /(화면|디자인|프론트엔드|컴포넌트)/.test(text);
  const ui = explicit === "ui" || (explicit === "auto" && (figmaUrls.length > 0 || hasUiTerms));
  const code = explicit !== "docs";

  return WorkflowScopeSchema.parse({
    code,
    ui,
    api:
      /\b(api|openapi|swagger|endpoint|contract|mock|schema)\b/i.test(text) ||
      /(스키마|엔드포인트|계약|목업)/.test(text),
    specification:
      /\b(spec|brief|requirement|openspec|gherkin)\b/i.test(text) || /(기획|요구사항)/.test(text),
    hasVisualBaseline:
      figmaUrls.length > 0 || /\b(visual baseline|legacy screenshot)\b/i.test(text),
    securitySensitive:
      /\b(auth|secret|token|storage|navigation|network|dependency)\b/i.test(text) ||
      /보안/.test(text),
    performanceSensitive:
      /\b(performance|lighthouse|web vitals|bundle|latency)\b/i.test(text) || /성능/.test(text),
    observabilityRequested:
      /\b(observability|telemetry|trace|tracing|log correlation)\b/i.test(text) ||
      /(관측|텔레메트리|추적)/.test(text),
  });
}

export function buildGatePlan(scope: WorkflowScope): WorkflowGate[] {
  return [
    gate(
      "functional",
      scope.code ? "required" : "not-applicable",
      "Code changes require executable verification.",
    ),
    gate(
      "openspec",
      scope.specification ? "conditional" : "not-applicable",
      "Specification validation applies only to specification-backed scope.",
    ),
    gate(
      "architecture",
      scope.code ? "conditional" : "not-applicable",
      "Architecture checks apply when changed boundaries support them.",
    ),
    gate(
      "security",
      scope.securitySensitive ? "required" : scope.code ? "conditional" : "not-applicable",
      "Targeted security checks follow auth, secret, storage, navigation, network, and dependency risk.",
    ),
    gate(
      "visual",
      scope.ui && scope.hasVisualBaseline ? "required" : "not-applicable",
      "Visual comparison requires both UI scope and a baseline.",
    ),
    gate(
      "accessibility",
      scope.ui ? "required" : "not-applicable",
      "Changed interactive UI states require accessibility evidence.",
    ),
    gate(
      "performance",
      scope.performanceSensitive ? "required" : scope.ui ? "conditional" : "opt-in",
      "Performance runs for sensitive routes or explicit intent.",
    ),
    gate(
      "observability",
      scope.observabilityRequested ? "required" : "opt-in",
      "Observability is generated only when explicitly requested.",
    ),
    gate(
      "release",
      "release-only",
      "Full archive integrity and package verification run only for releases.",
    ),
  ];
}

function gate(
  id: z.infer<typeof WorkflowGateIdSchema>,
  applicability: z.infer<typeof GateApplicabilitySchema>,
  reason: string,
): WorkflowGate {
  return WorkflowGateSchema.parse({ id, applicability, reason });
}
