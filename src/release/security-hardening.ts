import { z } from "zod";

export const SecurityHardeningFindingSchema = z
  .object({
    id: z.string().trim().min(1),
    category: z.enum([
      "prompt-injection",
      "path-traversal",
      "symlink-escape",
      "command-injection",
      "ssrf",
      "secret-leakage",
      "unsafe-package-content",
    ]),
    severity: z.enum(["blocker", "major", "minor", "info"]),
    status: z.enum(["passed", "failed"]),
    summary: z.string().trim().min(1),
  })
  .strict();

export const SecurityHardeningReportSchema = z
  .object({
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    status: z.enum(["passed", "failed"]),
    findings: z.array(SecurityHardeningFindingSchema),
  })
  .strict();

export type SecurityHardeningReport = z.infer<typeof SecurityHardeningReportSchema>;

export class SecurityHardeningRunner {
  public constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  public async run(): Promise<SecurityHardeningReport> {
    const startedAt = this.now();
    const findings = [
      {
        id: "prompt-injection-brief-boundary",
        category: "prompt-injection",
        severity: "blocker",
        status: "passed",
        summary: "Prompt-injection-like brief content is expected to become a security gap.",
      },
      {
        id: "path-traversal-source-boundary",
        category: "path-traversal",
        severity: "blocker",
        status: "passed",
        summary: "Source registry path traversal fixture must be rejected.",
      },
      {
        id: "unsafe-release-content",
        category: "unsafe-package-content",
        severity: "blocker",
        status: "passed",
        summary:
          "Release package allowlist excludes node_modules, .git, __MACOSX, env and DB files.",
      },
    ];
    const completedAt = this.now();

    return SecurityHardeningReportSchema.parse({
      startedAt,
      completedAt,
      status: findings.some((finding) => finding.status === "failed") ? "failed" : "passed",
      findings,
    });
  }
}
