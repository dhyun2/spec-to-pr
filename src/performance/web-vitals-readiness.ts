import { z } from "zod";

export const WebVitalsReadinessStatusSchema = z.enum(["ready", "partial", "missing"]);

export const WebVitalsReadinessReportSchema = z
  .object({
    status: WebVitalsReadinessStatusSchema,
    hasWebVitalsDependency: z.boolean(),
    hasLcpInstrumentation: z.boolean(),
    hasInpInstrumentation: z.boolean(),
    hasClsInstrumentation: z.boolean(),
    hasAnalyticsSink: z.boolean(),
    hasReleaseMetadata: z.boolean(),
    hasRedactionPolicy: z.boolean(),
    notes: z.array(z.string()).default([]),
  })
  .strict();

export type WebVitalsReadinessReport = z.infer<typeof WebVitalsReadinessReportSchema>;

export function detectWebVitalsReadiness(input: {
  packageJson?: unknown;
  sourceTexts: Array<{ path: string; content: string }>;
}): WebVitalsReadinessReport {
  const packageRecord = asRecord(input.packageJson);
  const dependencies = {
    ...asRecord(packageRecord["dependencies"]),
    ...asRecord(packageRecord["devDependencies"]),
  };

  const hasWebVitalsDependency = typeof dependencies["web-vitals"] === "string";
  const combinedSource = input.sourceTexts.map((item) => item.content).join("\n");

  const hasLcpInstrumentation = /\bonLCP\b|\bgetLCP\b/.test(combinedSource);
  const hasInpInstrumentation = /\bonINP\b|\bgetINP\b/.test(combinedSource);
  const hasClsInstrumentation = /\bonCLS\b|\bgetCLS\b/.test(combinedSource);
  const hasAnalyticsSink =
    /sendToAnalytics|reportWebVitals|analytics\.track|navigator\.sendBeacon/.test(combinedSource);
  const hasReleaseMetadata = /release|version|commitSha|buildId/i.test(combinedSource);
  const hasRedactionPolicy = /redact|sanitize|stripQuery|removePII|privacy/i.test(combinedSource);

  const missing = [
    ["web-vitals dependency", hasWebVitalsDependency],
    ["LCP instrumentation", hasLcpInstrumentation],
    ["INP instrumentation", hasInpInstrumentation],
    ["CLS instrumentation", hasClsInstrumentation],
    ["analytics sink", hasAnalyticsSink],
    ["release metadata", hasReleaseMetadata],
    ["redaction policy", hasRedactionPolicy],
  ].filter(([, present]) => present === false);

  const status = missing.length === 0 ? "ready" : missing.length <= 2 ? "partial" : "missing";

  return WebVitalsReadinessReportSchema.parse({
    status,
    hasWebVitalsDependency,
    hasLcpInstrumentation,
    hasInpInstrumentation,
    hasClsInstrumentation,
    hasAnalyticsSink,
    hasReleaseMetadata,
    hasRedactionPolicy,
    notes: missing.map(([name]) => `Missing ${name}`),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
