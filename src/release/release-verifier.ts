import { z } from "zod";

import { RELEASE_FORBIDDEN_PATTERNS } from "./release-manifest.js";

export const ReleaseVerificationResultSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    failures: z.array(z.string()).default([]),
    checkedFiles: z.array(z.string()).default([]),
  })
  .strict();

export type ReleaseVerificationResult = z.infer<typeof ReleaseVerificationResultSchema>;

export const REQUIRED_RELEASE_FILES = [
  ".claude-plugin/plugin.json",
  ".mcp.json",
  "dist/mcp/server.js",
  "package.json",
] as const;

export function verifyReleasePackageFiles(files: string[]): ReleaseVerificationResult {
  const failures: string[] = [];
  const normalizedFiles = files.map((file) => file.split("\\").join("/")).sort();

  for (const file of normalizedFiles) {
    for (const pattern of RELEASE_FORBIDDEN_PATTERNS) {
      if (file.includes(pattern)) {
        failures.push(`Forbidden file included: ${file}`);
      }
    }
  }

  for (const requiredFile of REQUIRED_RELEASE_FILES) {
    if (!normalizedFiles.includes(requiredFile)) {
      failures.push(`Required file missing: ${requiredFile}`);
    }
  }

  return ReleaseVerificationResultSchema.parse({
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    checkedFiles: normalizedFiles,
  });
}
