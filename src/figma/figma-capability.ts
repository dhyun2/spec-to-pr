import { z } from "zod";

import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";

export const FigmaProviderKindSchema = z.enum(["local-desktop", "remote", "plugin", "unknown"]);

export const FigmaCapabilityNameSchema = z.enum([
  "metadata",
  "design-context",
  "screenshot",
  "variable-defs",
  "code-connect-map",
  "code-connect-suggestions",
  "asset-download",
  "write-design",
  "selected-node",
]);

export const FigmaToolNameSchema = z.enum([
  "get_metadata",
  "get_design_context",
  "get_screenshot",
  "get_variable_defs",
  "get_code_connect_map",
  "get_code_connect_suggestions",
  "add_code_connect_map",
  "download_assets",
  "use_figma",
  "unknown",
]);

export const FigmaProviderCapabilitySchema = z
  .object({
    providerId: z.string().trim().min(1).max(120),
    kind: FigmaProviderKindSchema,
    available: z.boolean(),
    transport: z.enum(["stdio", "http", "sse", "unknown"]).default("unknown"),
    tools: z.array(FigmaToolNameSchema).default([]),
    rawToolNames: z.array(z.string().trim().min(1)).default([]),
    notes: z.array(z.string().trim().min(1).max(500)).default([]),
  })
  .strict();

export const FigmaProviderPolicySchema = z
  .object({
    metadataProviderId: z.string().trim().min(1).optional(),
    designContextProviderId: z.string().trim().min(1).optional(),
    screenshotProviderId: z.string().trim().min(1).optional(),
    variableDefsProviderId: z.string().trim().min(1).optional(),
    codeConnectProviderId: z.string().trim().min(1).optional(),
    crossCheckProviderIds: z.array(z.string().trim().min(1)).default([]),
    missingCapabilities: z.array(FigmaCapabilityNameSchema).default([]),
    rationale: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const FigmaCapabilityReportSchema = z
  .object({
    runId: RunIdSchema,
    capturedAt: IsoDateTimeSchema,
    providers: z.array(FigmaProviderCapabilitySchema),
    policy: FigmaProviderPolicySchema,
    artifactId: ArtifactIdSchema.optional(),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export type FigmaProviderKind = z.infer<typeof FigmaProviderKindSchema>;
export type FigmaCapabilityName = z.infer<typeof FigmaCapabilityNameSchema>;
export type FigmaToolName = z.infer<typeof FigmaToolNameSchema>;
export type FigmaProviderCapability = z.infer<typeof FigmaProviderCapabilitySchema>;
export type FigmaProviderPolicy = z.infer<typeof FigmaProviderPolicySchema>;
export type FigmaCapabilityReport = z.infer<typeof FigmaCapabilityReportSchema>;

export function normalizeFigmaToolName(rawName: string): z.infer<typeof FigmaToolNameSchema> {
  const lower = rawName.toLowerCase();

  if (lower.includes("get_metadata")) return "get_metadata";
  if (lower.includes("get_design_context")) return "get_design_context";
  if (lower.includes("get_screenshot")) return "get_screenshot";
  if (lower.includes("get_variable_defs")) return "get_variable_defs";
  if (lower.includes("get_code_connect_map")) return "get_code_connect_map";
  if (lower.includes("get_code_connect_suggestions")) return "get_code_connect_suggestions";
  if (lower.includes("add_code_connect_map")) return "add_code_connect_map";
  if (lower.includes("download_assets")) return "download_assets";
  if (lower.includes("use_figma")) return "use_figma";

  return "unknown";
}

export function inferProviderKind(input: {
  providerId: string;
  serverName?: string;
  rawToolNames: string[];
}): z.infer<typeof FigmaProviderKindSchema> {
  const haystack = [input.providerId, input.serverName ?? "", ...input.rawToolNames]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("local") || haystack.includes("desktop")) return "local-desktop";
  if (haystack.includes("remote") || haystack.includes("mcp.figma.com")) return "remote";
  if (haystack.includes("plugin") || haystack.includes("code connect")) return "plugin";

  return "unknown";
}

export function deriveFigmaProviderPolicy(
  providers: z.infer<typeof FigmaProviderCapabilitySchema>[],
): z.infer<typeof FigmaProviderPolicySchema> {
  const available = providers.filter((provider) => provider.available);

  const pick = (tool: z.infer<typeof FigmaToolNameSchema>) =>
    preferLocalThenRemote(available.filter((provider) => provider.tools.includes(tool)))
      ?.providerId;

  const metadataProviderId = pick("get_metadata");
  const designContextProviderId = pick("get_design_context");
  const screenshotProviderId = pick("get_screenshot");
  const variableDefsProviderId = pick("get_variable_defs");
  const codeConnectProviderId = pick("get_code_connect_map");

  const missingCapabilities: z.infer<typeof FigmaCapabilityNameSchema>[] = [];

  if (metadataProviderId === undefined) missingCapabilities.push("metadata");
  if (designContextProviderId === undefined) missingCapabilities.push("design-context");
  if (screenshotProviderId === undefined) missingCapabilities.push("screenshot");
  if (variableDefsProviderId === undefined) missingCapabilities.push("variable-defs");
  if (codeConnectProviderId === undefined) missingCapabilities.push("code-connect-map");

  const crossCheckProviderIds = available
    .filter(
      (provider) =>
        provider.tools.includes("get_metadata") || provider.tools.includes("get_screenshot"),
    )
    .map((provider) => provider.providerId);

  const rationale: string[] = [];

  rationale.push("Prefer provider capability over hard-coded local or remote assumptions.");
  rationale.push(
    "Prefer local desktop when it exposes the required tool, then remote, then plugin/unknown.",
  );
  rationale.push(
    "Use cross-check providers for important node metadata and screenshots when multiple providers are available.",
  );

  return FigmaProviderPolicySchema.parse({
    metadataProviderId,
    designContextProviderId,
    screenshotProviderId,
    variableDefsProviderId,
    codeConnectProviderId,
    crossCheckProviderIds,
    missingCapabilities,
    rationale,
  });
}

function preferLocalThenRemote(providers: z.infer<typeof FigmaProviderCapabilitySchema>[]) {
  return (
    providers.find((provider) => provider.kind === "local-desktop") ??
    providers.find((provider) => provider.kind === "remote") ??
    providers.find((provider) => provider.kind === "plugin") ??
    providers[0]
  );
}
