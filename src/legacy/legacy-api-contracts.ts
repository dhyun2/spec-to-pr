import { createHash } from "node:crypto";

import { z } from "zod";

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const LegacyHttpMethodSchema = z.enum([
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE",
  "UNKNOWN",
]);

export const LegacyOriginRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("environment"),
      runtime: z.enum(["process.env", "import.meta.env"]),
      name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
      sanitizedOrigin: z.string().url().max(2_000).optional(),
      sanitizedOrigins: z
        .array(
          z
            .object({
              sourceName: z.string().trim().min(1).max(200),
              origin: z.string().url().max(2_000),
            })
            .strict(),
        )
        .max(100)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal("literal"), sanitizedOrigin: z.string().url().max(2_000) }).strict(),
  z
    .object({
      kind: z.literal("openapi-server"),
      sourceLocator: z.string().trim().min(1).max(2_000),
      serverIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ kind: z.literal("runtime-origin"), sanitizedOrigin: z.string().url().max(2_000) })
    .strict(),
]);

export const LegacyApiCallSiteSchema = z
  .object({
    callSiteKey: z.string().trim().min(1).max(500),
    ownerFeatureKey: z
      .string()
      .regex(/^legacy_[a-f0-9]{24}$/)
      .optional(),
    ownerSourcePath: z.string().trim().min(1).max(1_000),
    terminalSourcePath: z.string().trim().min(1).max(1_000),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    receiver: z.string().trim().min(1).max(500),
    transportRef: z.string().trim().min(1).max(500).optional(),
    branchGuard: z.string().trim().min(1).max(500).optional(),
    wrapperChain: z.array(z.string().trim().min(1).max(1_000)).max(32),
  })
  .strict();

const LegacyApiWitnessSchema = z
  .object({
    kind: z.enum(["source", "openapi", "runtime"]),
    locator: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const LegacyApiCandidateSchema = z
  .object({
    candidateKey: z.string().trim().min(1).max(500),
    endpointKey: z.string().trim().min(1).max(500),
    operationKey: z.string().trim().min(3).max(1_000),
    method: LegacyHttpMethodSchema,
    pathTemplate: z.string().trim().startsWith("/").max(1_000).optional(),
    originRef: LegacyOriginRefSchema.optional(),
    confidence: z.enum(["high", "medium", "low"]),
    terminalKind: z.enum(["fetch", "http-client", "request-config", "generated-client"]),
    callSites: z.array(LegacyApiCallSiteSchema).min(1).max(500),
    requestEvidence: z
      .object({
        queryKeys: z.array(z.string().trim().min(1).max(200)).max(100),
        bodySymbols: z.array(z.string().trim().min(1).max(500)).max(100),
        headerKeys: z.array(z.string().trim().min(1).max(200)).max(100),
      })
      .strict(),
    responseEvidence: z
      .object({ selectors: z.array(z.string().trim().min(1).max(500)).max(100) })
      .strict(),
    witnesses: z.array(LegacyApiWitnessSchema).min(1).max(500),
  })
  .strict();

export const LegacySupportingDependencySchema = z
  .object({
    dependencyKey: z.string().trim().min(1).max(500),
    applicationRelativePath: z.string().trim().min(1).max(1_000),
    digest: Sha256DigestSchema,
    resolver: z.enum(["relative-import", "alias", "package", "style", "asset", "environment"]),
    importer: z.string().trim().min(1).max(1_000),
    specifier: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type LegacyOriginRef = z.infer<typeof LegacyOriginRefSchema>;
export type LegacyApiCallSite = z.infer<typeof LegacyApiCallSiteSchema>;
export type LegacyApiCandidate = z.infer<typeof LegacyApiCandidateSchema>;
export type LegacySupportingDependency = z.infer<typeof LegacySupportingDependencySchema>;

export function endpointIdentity(value: Pick<LegacyApiCandidate, "endpointKey">): string {
  return value.endpointKey;
}

export function stableEndpointKey(input: {
  originRef?: LegacyOriginRef;
  method: string;
  pathTemplate?: string;
}): string {
  const origin = input.originRef === undefined ? "origin:unknown" : JSON.stringify(input.originRef);
  const operation = `${input.method} ${input.pathTemplate ?? "path:unknown"}`;
  return `endpoint_${createHash("sha256")
    .update(origin)
    .update("\0")
    .update(operation)
    .digest("hex")
    .slice(0, 24)}`;
}

const LegacyInventoryV2CompatibilitySchema = z
  .object({
    version: z.literal(2),
    rootDigest: Sha256DigestSchema,
    sourceDigest: Sha256DigestSchema.optional(),
    visitedDirectories: z.number().int().nonnegative().default(0),
    visitedEntries: z.number().int().nonnegative().default(0),
    scannedFiles: z.number().int().nonnegative(),
    scannedBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    apiDiscoveryAdapters: z.array(z.string().trim().min(1)).default([]),
    entries: z.array(z.unknown()).max(20_000),
  })
  .strict();

export function upgradeLegacyInventoryV2(raw: unknown) {
  const inventory = LegacyInventoryV2CompatibilitySchema.parse(raw);
  return {
    ...inventory,
    version: 3 as const,
    apiState: "not-detected" as const,
    apiCandidates: [] as LegacyApiCandidate[],
    supportingDependencies: [] as LegacySupportingDependency[],
  };
}
