import { z } from "zod";

export const ReleaseFeatureStatusSchema = z.enum([
  "verified",
  "implemented",
  "scaffolded",
  "planned",
]);

export const ReleaseFeatureSchema = z
  .object({
    taskId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    status: ReleaseFeatureStatusSchema,
    evidence: z.array(z.string()).default([]),
  })
  .strict();

export const ReleaseManifestSchema = z
  .object({
    name: z.literal("spec-to-pr"),
    version: z.string().trim().min(1),
    builtAt: z.string().datetime({ offset: true }),
    gitCommit: z.string().trim().min(1).optional(),
    nodeVersion: z.string().trim().min(1),
    packagePath: z.string().trim().min(1),
    packageSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    includedFiles: z.array(z.string()),
    excludedPatterns: z.array(z.string()),
    evalStatus: z.enum(["passed", "failed", "not-run"]),
    securityStatus: z.enum(["passed", "failed", "not-run"]),
    pluginValidationStatus: z.enum(["passed", "failed", "skipped"]),
    features: z.array(ReleaseFeatureSchema),
  })
  .strict();

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
export type ReleaseFeature = z.infer<typeof ReleaseFeatureSchema>;

export const RELEASE_FILE_ALLOWLIST = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "CHANGELOG.md",
  "dist/mcp/server.js",
  "dist/mcp/server.js.map",
  "package.json",
  "README.md",
  "LICENSE",
  "scripts/validate-codex-plugin.ts",
] as const;

export const RELEASE_DIRECTORY_ALLOWLIST = [
  ".codex/agents/",
  "skills/",
  "agents/",
  "schemas/runtime/",
  "docs/codex/",
  "packages/codex-sdk/",
] as const;

export const RELEASE_FORBIDDEN_PATTERNS = [
  "node_modules/",
  ".git/",
  "__MACOSX/",
  ".env",
  ".env.",
  ".sqlite",
  ".sqlite3",
  ".db",
  "coverage/",
  "tmp/",
  "temp/",
  "artifacts/tmp/",
] as const;

export function defaultFeatureStatuses(): ReleaseFeature[] {
  return [
    ReleaseFeatureSchema.parse({
      taskId: "01-08",
      name: "Foundation, intake, source registry, and brief adapter",
      status: "verified",
      evidence: ["pnpm test", "runtime contract tests"],
    }),
    ReleaseFeatureSchema.parse({
      taskId: "09-17",
      name: "Figma, OpenAPI, evidence graph, OpenSpec, Gherkin, API/design contracts",
      status: "implemented",
      evidence: ["integration tests", "MCP stdio smoke"],
    }),
    ReleaseFeatureSchema.parse({
      taskId: "18-32",
      name: "Agent runtime, quality gates, PR publishing, and archive lifecycle",
      status: "implemented",
      evidence: ["integration tests", "release readiness evals"],
    }),
    ReleaseFeatureSchema.parse({
      taskId: "33",
      name: "Evals, hardening, and release package preparation",
      status: "verified",
      evidence: ["release verifier tests", "deterministic package builder tests"],
    }),
  ];
}
