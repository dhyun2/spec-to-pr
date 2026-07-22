import { z } from "zod";
import { parse } from "@babel/parser";

import path from "node:path";

export const MCP_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
export const MCP_TOTAL_JS_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

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
  "dist/mcp/",
  "skills/",
  "agents/",
  "schemas/runtime/",
  "packages/codex-sdk/dist/",
] as const;

export function validateMcpBundleFiles(files: ReadonlyMap<string, Buffer>): string[] {
  const failures: string[] = [];
  const runtimeFiles = [...files.entries()].filter(([file]) => file.startsWith("dist/mcp/"));
  const javascriptFiles = runtimeFiles.filter(([file]) => /^dist\/mcp\/[^/]+\.js$/u.test(file));
  for (const [file] of runtimeFiles) {
    if (!/^dist\/mcp\/[^/]+\.js$/u.test(file)) {
      failures.push(`Unexpected MCP runtime file: ${file}`);
    }
  }
  const entry = files.get("dist/mcp/server.js");
  if (entry === undefined) {
    failures.push("MCP entry missing: dist/mcp/server.js");
  } else if (entry.byteLength > MCP_ENTRY_MAX_BYTES) {
    failures.push(`MCP entry uses ${entry.byteLength} bytes; maximum is ${MCP_ENTRY_MAX_BYTES}.`);
  }
  const totalBytes = javascriptFiles.reduce((total, [, content]) => total + content.byteLength, 0);
  if (totalBytes > MCP_TOTAL_JS_MAX_BYTES) {
    failures.push(`MCP JavaScript uses ${totalBytes} bytes; maximum is ${MCP_TOTAL_JS_MAX_BYTES}.`);
  }

  for (const [file, content] of javascriptFiles) {
    let specifiers: string[];
    try {
      specifiers = localModuleSpecifiers(content.toString("utf8"));
    } catch {
      failures.push(`MCP JavaScript is not syntactically valid: ${file}`);
      continue;
    }
    for (const specifier of specifiers) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!target.startsWith("dist/mcp/") || !files.has(target)) {
        failures.push(`MCP local import is missing from the package: ${file} -> ${specifier}`);
      }
    }
  }
  return failures;
}

function localModuleSpecifiers(source: string): string[] {
  const program = parse(source, { sourceType: "unambiguous" }).program;
  const specifiers: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const node = value as {
      type?: unknown;
      source?: unknown;
      callee?: unknown;
      arguments?: unknown;
    };
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      isRelativeStringLiteral(node.source)
    ) {
      specifiers.push(node.source.value);
    } else if (
      node.type === "CallExpression" &&
      isImportNode(node.callee) &&
      Array.isArray(node.arguments) &&
      isRelativeStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].value);
    } else if (node.type === "ImportExpression" && isRelativeStringLiteral(node.source)) {
      specifiers.push(node.source.value);
    }
    for (const [key, child] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
      visit(child);
    }
  };
  visit(program);
  return specifiers;
}

function isImportNode(value: unknown): value is { type: "Import" } {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "Import"
  );
}

function isRelativeStringLiteral(
  value: unknown,
): value is { type: "StringLiteral"; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "StringLiteral" &&
    typeof (value as { value?: unknown }).value === "string" &&
    (value as { value: string }).value.startsWith(".")
  );
}

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
