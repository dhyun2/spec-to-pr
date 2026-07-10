import { z } from "zod";

export const LighthouseMetricSummarySchema = z
  .object({
    url: z.string(),
    performanceScore: z.number().nullable(),
    lcpMs: z.number().nullable(),
    cls: z.number().nullable(),
    tbtMs: z.number().nullable(),
    fcpMs: z.number().nullable(),
    speedIndexMs: z.number().nullable(),
  })
  .strict();

export const LighthouseSummarySchema = z
  .object({
    metrics: z.array(LighthouseMetricSummarySchema),
  })
  .strict();

export type LighthouseMetricSummary = z.infer<typeof LighthouseMetricSummarySchema>;
export type LighthouseSummary = z.infer<typeof LighthouseSummarySchema>;

export function parseLighthouseReports(reports: unknown[]): LighthouseSummary {
  return LighthouseSummarySchema.parse({
    metrics: reports.map(parseOneLighthouseReport),
  });
}

function parseOneLighthouseReport(report: unknown): LighthouseMetricSummary {
  const record = asRecord(report);
  const requestedUrl =
    getString(record, "requestedUrl") ?? getString(record, "finalDisplayedUrl") ?? "unknown";
  const categories = asRecord(record["categories"]);
  const performanceCategory = asRecord(categories["performance"]);
  const audits = asRecord(record["audits"]);

  return LighthouseMetricSummarySchema.parse({
    url: requestedUrl,
    performanceScore: getNumber(performanceCategory, "score"),
    lcpMs: getAuditNumericValue(audits, "largest-contentful-paint"),
    cls: getAuditNumericValue(audits, "cumulative-layout-shift"),
    tbtMs: getAuditNumericValue(audits, "total-blocking-time"),
    fcpMs: getAuditNumericValue(audits, "first-contentful-paint"),
    speedIndexMs: getAuditNumericValue(audits, "speed-index"),
  });
}

function getAuditNumericValue(audits: Record<string, unknown>, key: string): number | null {
  const audit = asRecord(audits[key]);
  const value = audit["numericValue"];

  return typeof value === "number" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === "string" ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];

  return typeof value === "number" ? value : null;
}
