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
    version: z
      .string()
      .regex(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
      ),
    builtAt: z.string().datetime({ offset: true }),
    gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
    nodeVersion: z.string().trim().min(1),
    packagePath: z.string().trim().min(1),
    packageSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    includedFiles: z.array(z.string()),
    excludedPatterns: z.array(z.string()),
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
  "package.json",
  "packages/codex-sdk/package.json",
  "packages/codex-sdk/README.md",
  "README.md",
  "LICENSE",
] as const;

export const RELEASE_DIRECTORY_ALLOWLIST = [
  ".codex/agents/",
  "skills/",
  "agents/",
  "schemas/runtime/",
  "packages/codex-sdk/dist/",
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
      taskId: "v2-facade",
      name: "Seven public workflow tools and eight durable stages",
      status: "verified",
      evidence: ["MCP stdio smoke", "workflow contract tests"],
    }),
    ReleaseFeatureSchema.parse({
      taskId: "delivery-profiles",
      name: "Brief, legacy, feature, and Figma delivery profiles",
      status: "verified",
      evidence: ["delivery policy tests", "workflow integration tests"],
    }),
    ReleaseFeatureSchema.parse({
      taskId: "api-ready",
      name: "Single-context API readiness before API-backed UI",
      status: "verified",
      evidence: ["API-ready schema tests", "workflow integration tests"],
    }),
    ReleaseFeatureSchema.parse({
      taskId: "split-review",
      name: "Independent functional and conditional design review",
      status: "verified",
      evidence: ["review contract tests", "plugin layout validation"],
    }),
  ];
}
