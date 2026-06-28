import { z } from "zod";

import {
  AccessibilitySeveritySchema,
  AccessibilityViolationSchema,
  AutomatedAccessibilityCheckSchema,
} from "./accessibility-model.js";
import type { AccessibilitySeverity, AccessibilityViolation } from "./accessibility-model.js";

const RawAxeNodeSchema = z
  .object({
    target: z.array(z.string()).default([]),
    html: z.string().optional(),
    failureSummary: z.string().optional(),
  })
  .passthrough();

const RawAxeViolationSchema = z
  .object({
    id: z.string(),
    impact: z.string().optional(),
    help: z.string(),
    description: z.string().optional(),
    helpUrl: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    nodes: z.array(RawAxeNodeSchema).default([]),
  })
  .passthrough();

const RawAxeResultSchema = z
  .object({
    violations: z.array(RawAxeViolationSchema).default([]),
  })
  .passthrough();

export function normalizeAxeResult(input: { targetId: string; rawResult: unknown }) {
  const raw = RawAxeResultSchema.parse(input.rawResult);
  const violations = raw.violations.flatMap((violation) =>
    violation.nodes.length === 0
      ? [
          normalizeViolation({
            violation,
            target: [],
          }),
        ]
      : violation.nodes.map((node) =>
          normalizeViolation({
            violation,
            target: node.target,
            ...(node.html === undefined ? {} : { html: node.html }),
            ...(node.failureSummary === undefined ? {} : { failureSummary: node.failureSummary }),
          }),
        ),
  );
  const counts = countByImpact(violations);

  return AutomatedAccessibilityCheckSchema.parse({
    id: `axe-${input.targetId}`,
    targetId: input.targetId,
    engine: "axe-core",
    status: violations.length === 0 ? "passed" : "failed",
    violationCount: violations.length,
    criticalCount: counts.critical,
    seriousCount: counts.serious,
    moderateCount: counts.moderate,
    minorCount: counts.minor,
    violations,
    summary:
      violations.length === 0
        ? "No axe-core violations were reported."
        : `${violations.length} axe-core violation(s) were reported.`,
  });
}

function normalizeViolation(input: {
  violation: z.infer<typeof RawAxeViolationSchema>;
  target: string[];
  html?: string;
  failureSummary?: string;
}) {
  return AccessibilityViolationSchema.parse({
    id: input.violation.id,
    impact: normalizeImpact(input.violation.impact),
    help: input.violation.help,
    ...(input.violation.description === undefined
      ? {}
      : { description: input.violation.description }),
    ...(input.violation.helpUrl === undefined ? {} : { helpUrl: input.violation.helpUrl }),
    target: input.target,
    ...(input.html === undefined ? {} : { html: input.html }),
    ...(input.failureSummary === undefined ? {} : { failureSummary: input.failureSummary }),
    wcagTags: input.violation.tags.filter((tag) => /^wcag/i.test(tag)),
  });
}

function normalizeImpact(value: string | undefined): AccessibilitySeverity {
  const parsed = AccessibilitySeveritySchema.safeParse(value);

  return parsed.success ? parsed.data : "minor";
}

function countByImpact(violations: AccessibilityViolation[]) {
  return {
    critical: violations.filter((violation) => violation.impact === "critical").length,
    serious: violations.filter((violation) => violation.impact === "serious").length,
    moderate: violations.filter((violation) => violation.impact === "moderate").length,
    minor: violations.filter((violation) => violation.impact === "minor").length,
  };
}
