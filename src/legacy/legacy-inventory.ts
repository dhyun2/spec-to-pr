import { createHash } from "node:crypto";
import { lstat, opendir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  discoverLegacyApiCandidates,
  productionReachableOwnedFiles,
} from "./legacy-api-discovery.js";
import {
  LegacyApiCandidateSchema,
  LegacySupportingDependencySchema,
  stableEndpointKey,
} from "./legacy-api-contracts.js";
import {
  LEGACY_SOURCE_DIGEST_ALGORITHM_V1,
  LEGACY_SOURCE_DIGEST_ALGORITHM_V2,
  discoverLegacySourceGraph,
} from "./legacy-source-graph.js";
import {
  LegacySourceCache,
  LegacySourceEnvironmentReferenceSchema,
  LegacySourceManifestSchema,
  currentLegacySourceManifest,
  type LegacySourceManifest,
} from "./legacy-source-cache.js";

const MAX_LEGACY_FILE_BYTES = 2 * 1024 * 1024;
export type LegacyInventoryLimits = {
  maxDirectories: number;
  maxEntries: number;
  maxDepth: number;
  maxElapsedMs: number;
  maxSourceFiles: number;
  maxSourceBytes: number;
  maxFeatures: number;
};

export const DEFAULT_LEGACY_INVENTORY_LIMITS: LegacyInventoryLimits = {
  maxDirectories: 2_000,
  maxEntries: 20_000,
  maxDepth: 32,
  maxElapsedMs: 5_000,
  maxSourceFiles: 1_000,
  maxSourceBytes: 20 * 1024 * 1024,
  maxFeatures: 500,
};
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|json)$/i;
const SOURCE_API_DISCOVERY_ADAPTERS = [
  "source-fetch-literal",
  "source-fetch-dynamic",
  "source-http-client",
  "source-request-config",
  "source-generated-client",
  "source-semantic-ast",
] as const;
const API_DISCOVERY_ADAPTERS = [...SOURCE_API_DISCOVERY_ADAPTERS, "runtime-network-har"] as const;
const ApiDiscoveryAdapterSchema = z.enum(API_DISCOVERY_ADAPTERS);
const ApiEvidenceConfidenceSchema = z.enum(["high", "medium", "low"]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

export const LegacyFeatureCategorySchema = z.enum([
  "route",
  "component",
  "api",
  "state",
  "persistence",
  "bridge",
  "deep-link",
  "analytics",
  "asset",
  "resource",
  "global-css",
]);

export const LegacyFeatureEntrySchema = z
  .object({
    featureKey: z.string().regex(/^legacy_[a-f0-9]{24}$/),
    category: LegacyFeatureCategorySchema,
    normalizedKey: z.string().trim().min(1).max(500),
    sourcePath: z.string().trim().min(1).max(1_000),
    symbol: z.string().trim().min(1).max(500),
    apiAdapter: ApiDiscoveryAdapterSchema.optional(),
    evidenceConfidence: ApiEvidenceConfidenceSchema.optional(),
  })
  .strict();

export const LegacyInventorySchema = z
  .object({
    version: z.union([z.literal(2), z.literal(3)]),
    rootDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sourceDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    sourceDigestAlgorithm: z
      .enum([LEGACY_SOURCE_DIGEST_ALGORITHM_V1, LEGACY_SOURCE_DIGEST_ALGORITHM_V2])
      .optional(),
    sourceManifest: LegacySourceManifestSchema.optional(),
    sourceManifestDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    sourceEnvironmentRefs: z.array(LegacySourceEnvironmentReferenceSchema).optional(),
    visitedDirectories: z.number().int().nonnegative().default(0),
    visitedEntries: z.number().int().nonnegative().default(0),
    scannedFiles: z.number().int().nonnegative(),
    scannedBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    apiDiscoveryAdapters: z
      .array(ApiDiscoveryAdapterSchema)
      .default([...SOURCE_API_DISCOVERY_ADAPTERS]),
    entries: z.array(LegacyFeatureEntrySchema).max(20_000),
    apiState: z.enum(["not-detected", "detected", "truncated"]).default("not-detected"),
    apiCandidates: z.array(LegacyApiCandidateSchema).max(5_000).default([]),
    supportingDependencies: z.array(LegacySupportingDependencySchema).max(5_000).default([]),
  })
  .strict();

export type LegacyFeatureEntry = z.infer<typeof LegacyFeatureEntrySchema>;
export type LegacyInventory = z.infer<typeof LegacyInventorySchema>;
export type LegacyInventoryBuildOptions = {
  sourceCache?: LegacySourceCache;
};

export async function buildLegacyInventory(
  root: string,
  limitOverrides: Partial<LegacyInventoryLimits> = {},
  options: LegacyInventoryBuildOptions = {},
): Promise<LegacyInventory> {
  const limits = { ...DEFAULT_LEGACY_INVENTORY_LIMITS, ...limitOverrides };
  const sourceCache = options.sourceCache ?? new LegacySourceCache();
  sourceCache.recordSemanticRebuild();
  const graph = await discoverLegacySourceGraph(
    root,
    {
      maxFiles: limits.maxSourceFiles,
      maxBytes: limits.maxSourceBytes,
      maxDepth: limits.maxDepth,
      maxElapsedMs: limits.maxElapsedMs,
      maxDirectories: limits.maxDirectories,
      maxEntries: limits.maxEntries,
    },
    { sourceCache },
  );
  const apiCandidates = discoverLegacyApiCandidates(graph);
  const productionFiles = productionReachableOwnedFiles(graph);
  const entries = new Map<string, LegacyFeatureEntry>();
  let scannedBytes = 0;
  let scannedFiles = 0;
  let truncated = graph.truncated;

  scan: for (const file of productionFiles) {
    const relativePath = path
      .relative(graph.featureRoot, file.absolutePath)
      .split(path.sep)
      .join("/");
    const byteLength = Buffer.byteLength(file.content, "utf8");
    if (byteLength > MAX_LEGACY_FILE_BYTES) {
      truncated = true;
      break;
    }
    if (scannedBytes + byteLength > limits.maxSourceBytes) {
      truncated = true;
      break;
    }
    scannedBytes += byteLength;
    scannedFiles += 1;
    for (const entry of discoverFeatures(relativePath, file.content)) {
      if (
        entry.category === "api" &&
        entry.apiAdapter !== "source-generated-client" &&
        entry.apiAdapter !== "source-request-config"
      ) {
        continue;
      }
      if (entries.has(entry.featureKey)) continue;
      if (entries.size >= limits.maxFeatures) {
        truncated = true;
        break scan;
      }
      entries.set(entry.featureKey, entry);
    }
  }

  for (const candidate of apiCandidates) {
    const callSite = candidate.callSites[0]!;
    const entry = LegacyFeatureEntrySchema.parse({
      featureKey: stableFeatureKey("api", candidate.operationKey, callSite.ownerSourcePath),
      category: "api",
      normalizedKey: candidate.operationKey,
      sourcePath: callSite.ownerSourcePath,
      symbol: candidate.operationKey,
      apiAdapter: semanticAdapter(candidate.terminalKind),
      evidenceConfidence: candidate.confidence,
    });
    entries.set(entry.featureKey, entry);
  }

  const rootDigest = graph.sourceDigest;
  const supportingDependencies = graph.edges.flatMap((edge) => {
    const file = graph.files.find(
      (candidate) => candidate.applicationRelativePath === edge.resolvedPath,
    );
    if (file === undefined || file.ownership !== "supporting-dependency") return [];
    return [
      LegacySupportingDependencySchema.parse({
        dependencyKey: `dependency_${createHash("sha256")
          .update(edge.importer)
          .update("\0")
          .update(edge.specifier)
          .update("\0")
          .update(edge.resolvedPath)
          .digest("hex")
          .slice(0, 24)}`,
        applicationRelativePath: file.applicationRelativePath,
        digest: file.digest,
        resolver: edge.resolver,
        importer: edge.importer,
        specifier: edge.specifier,
      }),
    ];
  });
  const inventory = LegacyInventorySchema.parse({
    version: 3,
    rootDigest,
    sourceDigest: rootDigest,
    sourceDigestAlgorithm: graph.digestAlgorithm,
    sourceManifest: graph.sourceManifest,
    sourceManifestDigest: graph.sourceManifest.manifestDigest,
    sourceEnvironmentRefs: graph.environmentRefs,
    visitedDirectories: graph.visitedDirectories,
    visitedEntries: graph.visitedEntries,
    scannedFiles: Math.max(scannedFiles, graph.files.length),
    scannedBytes: Math.max(
      scannedBytes,
      graph.files.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8"), 0),
    ),
    truncated,
    apiDiscoveryAdapters: SOURCE_API_DISCOVERY_ADAPTERS,
    entries: [...entries.values()].sort((left, right) =>
      left.featureKey.localeCompare(right.featureKey),
    ),
    apiState: truncated ? "truncated" : apiCandidates.length > 0 ? "detected" : "not-detected",
    apiCandidates,
    supportingDependencies,
  });
  return freezeInventoryManifest(inventory);
}

function semanticAdapter(
  terminalKind: z.infer<typeof LegacyApiCandidateSchema>["terminalKind"],
): z.infer<typeof ApiDiscoveryAdapterSchema> {
  if (terminalKind === "fetch") return "source-fetch-literal";
  if (terminalKind === "request-config") return "source-request-config";
  if (terminalKind === "generated-client") return "source-generated-client";
  return "source-http-client";
}

export async function assertLegacyInventoryFresh(
  root: string,
  pinned: LegacyInventory,
  options: LegacyInventoryBuildOptions = {},
): Promise<LegacyInventory> {
  if (pinned.truncated) {
    throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
  }
  const sourceCache = options.sourceCache ?? new LegacySourceCache();
  if (
    pinned.version === 3 &&
    pinned.sourceDigestAlgorithm === LEGACY_SOURCE_DIGEST_ALGORITHM_V2 &&
    pinned.sourceManifest !== undefined &&
    pinned.sourceEnvironmentRefs !== undefined &&
    pinned.sourceManifestDigest === pinned.sourceManifest.manifestDigest
  ) {
    const currentManifest = await currentLegacySourceManifest(
      root,
      pinned.sourceManifest,
      sourceCache,
      {
        maxFiles: DEFAULT_LEGACY_INVENTORY_LIMITS.maxSourceFiles,
        maxBytes: DEFAULT_LEGACY_INVENTORY_LIMITS.maxSourceBytes,
        maxDepth: DEFAULT_LEGACY_INVENTORY_LIMITS.maxDepth,
        maxElapsedMs: DEFAULT_LEGACY_INVENTORY_LIMITS.maxElapsedMs,
        maxDirectories: DEFAULT_LEGACY_INVENTORY_LIMITS.maxDirectories,
        maxEntries: DEFAULT_LEGACY_INVENTORY_LIMITS.maxEntries,
      },
      {
        environmentReferences: pinned.sourceEnvironmentRefs ?? [],
        supportingDependencies: pinned.supportingDependencies,
      },
    );
    if (currentManifest.truncated) {
      throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
    }
    if (currentManifest.manifest.manifestDigest === pinned.sourceManifestDigest) {
      return pinned;
    }
    const rebuilt = await buildLegacyInventory(root, {}, { sourceCache });
    if (rebuilt.truncated) {
      throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
    }
    throw new Error(
      "LEGACY_SOURCE_CHANGED: restore the legacy source or restart intake from its new state",
    );
  }
  const current = await buildLegacyInventory(root, {}, { sourceCache });
  if (current.truncated) {
    throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
  }
  const pinnedDigest = pinned.sourceDigest ?? pinned.rootDigest;
  const currentDigest =
    pinned.version === 2 && pinned.sourceDigestAlgorithm === undefined
      ? await legacyV2SourceDigest(root)
      : pinned.sourceDigestAlgorithm === undefined ||
          pinned.sourceDigestAlgorithm === LEGACY_SOURCE_DIGEST_ALGORITHM_V1
        ? await legacyV1SourceDigest(root)
        : current.rootDigest;
  if (currentDigest !== pinnedDigest) {
    throw new Error(
      "LEGACY_SOURCE_CHANGED: restore the legacy source or restart intake from its new state",
    );
  }
  return current;
}

function freezeInventoryManifest(inventory: LegacyInventory): LegacyInventory {
  if (inventory.sourceManifest === undefined) return inventory;
  const manifest = inventory.sourceManifest as LegacySourceManifest;
  manifest.files.forEach((file) => Object.freeze(file));
  Object.freeze(manifest.files);
  Object.freeze(manifest);
  return inventory;
}

async function legacyV2SourceDigest(root: string): Promise<`sha256:${string}`> {
  const limits = DEFAULT_LEGACY_INVENTORY_LIMITS;
  const files = await collectSourceFiles(root, limits);
  if (files.truncated) {
    throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
  }
  const rootHash = createHash("sha256");
  let scannedBytes = 0;
  for (const relativePath of files.paths) {
    if (files.startedAt + limits.maxElapsedMs <= Date.now()) {
      throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
    }
    const details = await lstat(path.join(root, relativePath));
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      details.size > MAX_LEGACY_FILE_BYTES ||
      scannedBytes + details.size > limits.maxSourceBytes
    ) {
      throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
    }
    const bytes = await readFile(path.join(root, relativePath));
    if (scannedBytes + bytes.byteLength > limits.maxSourceBytes) {
      throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
    }
    scannedBytes += bytes.byteLength;
    rootHash.update(relativePath).update("\0").update(bytes).update("\0");
  }
  return `sha256:${rootHash.digest("hex")}`;
}

async function legacyV1SourceDigest(root: string): Promise<`sha256:${string}`> {
  const graph = await discoverLegacySourceGraph(
    root,
    {
      maxFiles: DEFAULT_LEGACY_INVENTORY_LIMITS.maxSourceFiles,
      maxBytes: DEFAULT_LEGACY_INVENTORY_LIMITS.maxSourceBytes,
      maxDepth: DEFAULT_LEGACY_INVENTORY_LIMITS.maxDepth,
      maxElapsedMs: DEFAULT_LEGACY_INVENTORY_LIMITS.maxElapsedMs,
    },
    { digestAlgorithm: LEGACY_SOURCE_DIGEST_ALGORITHM_V1 },
  );
  if (graph.truncated) {
    throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
  }
  return graph.sourceDigest;
}

const MAX_RUNTIME_NETWORK_ENTRIES = 1_000;
const MAX_RUNTIME_NETWORK_BYTES = 1024 * 1024;
const HTTP_METHODS = new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);
const API_HAR_RESOURCE_TYPES = new Set(["xhr", "fetch", "xmlhttprequest", "eventsource"]);
const NON_API_FETCH_DESTINATIONS = new Set([
  "audio",
  "document",
  "embed",
  "font",
  "frame",
  "iframe",
  "image",
  "manifest",
  "object",
  "script",
  "sharedworker",
  "style",
  "track",
  "video",
  "worker",
]);
const STATIC_ASSET_PATH =
  /\.(?:avif|bmp|cjs|css|eot|gif|html?|ico|jpe?g|js|jsx|m4a|map|mjs|mov|mp3|mp4|mpeg|oga|ogg|ogv|otf|pdf|png|svg|tiff?|ttf|wasm|wav|webm|webp|woff2?)$/iu;

type RuntimeNetworkRequest = {
  method: string;
  url: string;
  sourceIndex: number;
};

export function mergeLegacyRuntimeNetworkEvidence(
  inventory: LegacyInventory,
  rawContent: string,
  sourcePath: string,
): LegacyInventory {
  const requests = parseLegacyRuntimeNetworkEvidence(rawContent);
  const entries = new Map(inventory.entries.map((entry) => [entry.featureKey, entry]));
  const apiCandidates = new Map(
    inventory.apiCandidates.map((candidate) => [candidate.endpointKey, candidate]),
  );
  requests.forEach((request) => {
    const index = request.sourceIndex;
    const method = request.method.trim().toUpperCase();
    const operationPath = runtimeRequestPath(request.url, index);
    const normalizedKey = `${method} ${operationPath}`;
    const entry = LegacyFeatureEntrySchema.parse({
      featureKey: stableFeatureKey("api", normalizedKey, sourcePath),
      category: "api",
      normalizedKey,
      sourcePath,
      symbol: `${method} ${operationPath}`,
      apiAdapter: "runtime-network-har",
      evidenceConfidence: "high",
    });
    entries.set(entry.featureKey, entry);
    const runtimeOrigin = runtimeRequestOrigin(request.url);
    const originRef =
      runtimeOrigin === undefined
        ? undefined
        : ({ kind: "runtime-origin", sanitizedOrigin: runtimeOrigin } as const);
    const endpointKey = stableEndpointKey({
      method,
      pathTemplate: operationPath,
      ...(originRef === undefined ? {} : { originRef }),
    });
    const locator = `${sourcePath}#request-${index + 1}`;
    apiCandidates.set(
      endpointKey,
      LegacyApiCandidateSchema.parse({
        candidateKey: `candidate_${endpointKey.slice("endpoint_".length)}`,
        endpointKey,
        operationKey: normalizedKey,
        method,
        pathTemplate: operationPath,
        ...(originRef === undefined ? {} : { originRef }),
        confidence: "high",
        terminalKind: "request-config",
        callSites: [
          {
            callSiteKey: `call_runtime_${index + 1}`,
            ownerSourcePath: sourcePath,
            terminalSourcePath: sourcePath,
            line: index + 1,
            column: 1,
            receiver: "runtime-network",
            transportRef: "runtime-network-har",
            wrapperChain: [],
          },
        ],
        requestEvidence: { queryKeys: [], bodySymbols: [], headerKeys: [] },
        responseEvidence: { selectors: [] },
        witnesses: [{ kind: "runtime", locator }],
      }),
    );
  });

  const sourceDigest = inventory.sourceDigest ?? inventory.rootDigest;
  const evidenceDigest = createHash("sha256").update(rawContent).digest("hex");
  const rootDigest = `sha256:${createHash("sha256")
    .update(sourceDigest)
    .update("\0")
    .update(sourcePath)
    .update("\0")
    .update(evidenceDigest)
    .digest("hex")}`;
  return LegacyInventorySchema.parse({
    ...inventory,
    rootDigest,
    sourceDigest,
    apiDiscoveryAdapters: [
      ...new Set([...inventory.apiDiscoveryAdapters, "runtime-network-har" as const]),
    ],
    entries: [...entries.values()].sort((left, right) =>
      left.featureKey.localeCompare(right.featureKey),
    ),
    apiState: inventory.truncated ? "truncated" : "detected",
    apiCandidates: [...apiCandidates.values()].sort((left, right) =>
      left.endpointKey.localeCompare(right.endpointKey),
    ),
  });
}

export function validateLegacyRuntimeNetworkEvidence(rawContent: string): void {
  parseLegacyRuntimeNetworkEvidence(rawContent);
}

function parseLegacyRuntimeNetworkEvidence(rawContent: string): RuntimeNetworkRequest[] {
  if (Buffer.byteLength(rawContent, "utf8") > MAX_RUNTIME_NETWORK_BYTES) {
    throw new Error("Legacy runtime network evidence exceeds the 1 MB limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error("Legacy runtime network evidence must be valid JSON or HAR JSON");
  }
  const requests = runtimeNetworkRequests(parsed);
  if (requests.length > MAX_RUNTIME_NETWORK_ENTRIES) {
    throw new Error("Legacy runtime network evidence exceeds the 1,000 request limit");
  }
  return requests;
}

function runtimeNetworkRequests(value: unknown): RuntimeNetworkRequest[] {
  let candidates: Array<{ request: unknown; sourceIndex: number; authoritative: boolean }>;
  if (Array.isArray(value)) {
    candidates = value.map((request, sourceIndex) => ({
      request,
      sourceIndex,
      authoritative: true,
    }));
  } else if (isUnknownRecord(value) && Array.isArray(value["requests"])) {
    candidates = value["requests"].map((request, sourceIndex) => ({
      request,
      sourceIndex,
      authoritative: true,
    }));
  } else if (
    isUnknownRecord(value) &&
    isUnknownRecord(value["log"]) &&
    Array.isArray(value["log"]["entries"])
  ) {
    candidates = value["log"]["entries"].map((entry, sourceIndex) => ({
      request: isUnknownRecord(entry) ? entry["request"] : undefined,
      sourceIndex,
      authoritative: authoritativeHarApiEntry(entry),
    }));
  } else {
    throw new Error(
      "Legacy runtime network evidence must be a HAR log, a requests array, or a request array",
    );
  }

  if (candidates.length > MAX_RUNTIME_NETWORK_ENTRIES) {
    throw new Error("Legacy runtime network evidence exceeds the 1,000 request limit");
  }

  return candidates
    .map(({ request, sourceIndex, authoritative }) => {
      if (
        !isUnknownRecord(request) ||
        typeof request["method"] !== "string" ||
        request["method"].trim() === ""
      ) {
        throw new Error(`Legacy runtime network request ${sourceIndex + 1} requires a method`);
      }
      if (typeof request["url"] !== "string" || request["url"].trim() === "") {
        throw new Error(`Legacy runtime network request ${sourceIndex + 1} requires a URL`);
      }
      const method = request["method"].trim().toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        throw new Error(
          `Legacy runtime network request ${sourceIndex + 1} has an unsupported method`,
        );
      }
      runtimeRequestPath(request["url"], sourceIndex);
      return {
        request: { method: request["method"], url: request["url"], sourceIndex },
        authoritative,
      };
    })
    .filter(({ authoritative }) => authoritative)
    .map(({ request }) => request);
}

function authoritativeHarApiEntry(entry: unknown): boolean {
  if (!isUnknownRecord(entry)) return true;
  const request = isUnknownRecord(entry["request"]) ? entry["request"] : undefined;
  const resourceType = [
    entry["_resourceType"],
    entry["resourceType"],
    request?.["_resourceType"],
    request?.["resourceType"],
  ].find((value): value is string => typeof value === "string" && value.trim() !== "");
  if (resourceType !== undefined) {
    return API_HAR_RESOURCE_TYPES.has(resourceType.trim().toLowerCase());
  }
  return !clearlyNonApiHarEntry(entry, request);
}

function clearlyNonApiHarEntry(
  entry: Record<string, unknown>,
  request: Record<string, unknown> | undefined,
): boolean {
  const rawUrl = typeof request?.["url"] === "string" ? request["url"] : undefined;
  const requestPath = rawUrl?.trim().split(/[?#]/u, 1)[0];
  if (requestPath !== undefined && STATIC_ASSET_PATH.test(requestPath)) return true;

  const response = isUnknownRecord(entry["response"]) ? entry["response"] : undefined;
  const content = isUnknownRecord(response?.["content"]) ? response["content"] : undefined;
  const mimeType =
    typeof content?.["mimeType"] === "string"
      ? content["mimeType"].split(";", 1)[0]!.trim().toLowerCase()
      : undefined;
  if (mimeType !== undefined && nonApiMimeType(mimeType)) return true;

  const destination = harRequestHeader(request, "sec-fetch-dest")?.toLowerCase();
  return destination !== undefined && NON_API_FETCH_DESTINATIONS.has(destination);
}

function nonApiMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("font/") ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType === "text/css" ||
    mimeType === "text/html" ||
    /(?:java|ecma)script/u.test(mimeType) ||
    /(?:font|woff)/u.test(mimeType)
  );
}

function harRequestHeader(
  request: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!Array.isArray(request?.["headers"])) return undefined;
  for (const header of request["headers"]) {
    if (
      isUnknownRecord(header) &&
      typeof header["name"] === "string" &&
      header["name"].trim().toLowerCase() === name &&
      typeof header["value"] === "string"
    ) {
      return header["value"].trim();
    }
  }
  return undefined;
}

function runtimeRequestPath(rawUrl: string, index: number): string {
  const value = rawUrl.trim();
  if (value.startsWith("//")) {
    try {
      return new URL(`https:${value}`).pathname;
    } catch {
      throw new Error(`Legacy runtime network request ${index + 1} requires a valid URL path`);
    }
  }
  if (value.startsWith("/")) return value.split(/[?#]/u, 1)[0]!;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.pathname;
  } catch {
    throw new Error(`Legacy runtime network request ${index + 1} requires an HTTP(S) URL or path`);
  }
}

function runtimeRequestOrigin(rawUrl: string): string | undefined {
  const value = rawUrl.trim();
  try {
    const parsed = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (!/^https?:$/u.test(parsed.protocol) || parsed.username !== "" || parsed.password !== "") {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function directoriesOverlap(left: string, right: string): boolean {
  return containsDirectory(left, right) || containsDirectory(right, left);
}

function containsDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function collectSourceFiles(
  root: string,
  limits: LegacyInventoryLimits,
): Promise<{
  paths: string[];
  truncated: boolean;
  visitedDirectories: number;
  visitedEntries: number;
  startedAt: number;
}> {
  const paths: string[] = [];
  let truncated = false;
  let visitedDirectories = 0;
  let visitedEntries = 0;
  const startedAt = Date.now();
  const pending: Array<{ relativeDirectory: string; depth: number }> = [
    { relativeDirectory: "", depth: 0 },
  ];

  traversal: while (pending.length > 0) {
    if (Date.now() - startedAt >= limits.maxElapsedMs) {
      truncated = true;
      break;
    }
    const current = pending.pop()!;
    visitedDirectories += 1;
    if (visitedDirectories > limits.maxDirectories) {
      truncated = true;
      break;
    }
    const directory = await opendir(path.join(root, current.relativeDirectory));
    const entries = [];
    for await (const entry of directory) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const childDirectories: string[] = [];
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > limits.maxEntries || Date.now() - startedAt >= limits.maxElapsedMs) {
        truncated = true;
        break traversal;
      }
      if (entry.isSymbolicLink()) continue;
      const relativePath = path.join(current.relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (current.depth + 1 > limits.maxDepth) {
          truncated = true;
          break traversal;
        }
        childDirectories.push(relativePath);
      } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
        if (paths.length >= limits.maxSourceFiles) {
          truncated = true;
          break traversal;
        }
        paths.push(relativePath.split(path.sep).join("/"));
      }
    }
    for (const relativeDirectory of childDirectories.reverse()) {
      pending.push({ relativeDirectory, depth: current.depth + 1 });
    }
  }
  paths.sort((left, right) => left.localeCompare(right));
  return { paths, truncated, visitedDirectories, visitedEntries, startedAt };
}

function discoverFeatures(sourcePath: string, rawContent: string): LegacyFeatureEntry[] {
  const content = stripComments(rawContent);
  const discovered: LegacyFeatureEntry[] = [];
  const add = (
    category: LegacyFeatureEntry["category"],
    key: string,
    symbol = key,
    apiEvidence?: {
      adapter: z.infer<typeof ApiDiscoveryAdapterSchema>;
      confidence: z.infer<typeof ApiEvidenceConfidenceSchema>;
    },
  ) => {
    const normalizedKey = normalizeKey(category, key);
    if (normalizedKey === "") return;
    discovered.push({
      featureKey: stableFeatureKey(category, normalizedKey, sourcePath),
      category,
      normalizedKey,
      sourcePath,
      symbol:
        category === "api" || category === "route" || category === "deep-link"
          ? normalizedKey
          : symbol.trim().slice(0, 500),
      ...(apiEvidence === undefined
        ? {}
        : {
            apiAdapter: apiEvidence.adapter,
            evidenceConfidence: apiEvidence.confidence,
          }),
    });
  };
  const apiBindings = discoverApiBindings(content);

  forEachMatch(content, /\b(?:function|class)\s+([A-Z][A-Za-z0-9_$]*)/g, (match) =>
    add("component", match[1]!, match[1]),
  );
  forEachMatch(
    content,
    /\b(?:export\s+)?const\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:\([^)]*\)\s*=>|(?:forwardRef|memo)\s*\()/g,
    (match) => add("component", match[1]!, match[1]),
  );
  if (/\.vue$/i.test(sourcePath)) add("component", path.basename(sourcePath, ".vue"));

  forEachMatch(content, /\b(?:path|route)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi, (match) =>
    add("route", match[1]!, match[1]),
  );
  forEachMatch(
    content,
    /\b(?:href|url)\s*[:=]\s*["'`]([a-z][a-z0-9+.-]*:\/\/[^"'`]+)["'`]/gi,
    (match) => add("deep-link", match[1]!, match[1]),
  );

  forEachMatch(
    content,
    /\b(?:fetch|globalThis\.fetch|window\.fetch)\s*\(\s*["'`]([^"'`]+)["'`]/g,
    (match) => {
      const nearby = content.slice(match.index, match.index + 300);
      const method = /\bmethod\s*:\s*["'`]([A-Z]+)["'`]/i.exec(nearby)?.[1] ?? "GET";
      add("api", `${method.toUpperCase()} ${match[1]}`, `${match[0].split("(")[0]} ${match[1]}`, {
        adapter: "source-fetch-literal",
        confidence: "high",
      });
    },
  );
  forEachMatch(
    content,
    /\b(?:fetch|globalThis\.fetch|window\.fetch)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$.[\]]*)/g,
    (match) =>
      add("api", `UNKNOWN dynamic:fetch:${match[1]}`, `fetch ${match[1]}`, {
        adapter: "source-fetch-dynamic",
        confidence: "low",
      }),
  );
  forEachMatch(
    content,
    /\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\.(get|post|put|patch|delete|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    (match) => {
      if (!isApiReceiver(match[1]!, apiBindings.receivers)) return;
      add("api", `${match[2]!.toUpperCase()} ${match[3]}`, `${match[1]}.${match[2]}`, {
        adapter: "source-http-client",
        confidence: "high",
      });
    },
  );
  forEachMatch(
    content,
    /\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/gi,
    (match) => {
      if (!isApiReceiver(match[1]!, apiBindings.receivers)) return;
      const operationPath = /\b(?:url|path)\s*:\s*["'`]([^"'`]+)["'`]/i.exec(match[2]!)?.[1];
      if (operationPath === undefined) return;
      const method = /\bmethod\s*:\s*["'`]([A-Z]+)["'`]/i.exec(match[2]!)?.[1] ?? "UNKNOWN";
      add("api", `${method.toUpperCase()} ${operationPath}`, match[1], {
        adapter: "source-request-config",
        confidence: method === "UNKNOWN" ? "medium" : "high",
      });
    },
  );
  forEachMatch(
    content,
    /\b((?:[A-Za-z_$][A-Za-z0-9_$]*\.)*(?:request|apiRequest|httpRequest))\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/gi,
    (match) => {
      if (!isRequestAdapter(match[1]!, apiBindings.receivers)) return;
      const operationPath = /\b(?:url|path)\s*:\s*["'`]([^"'`]+)["'`]/i.exec(match[2]!)?.[1];
      if (operationPath === undefined) return;
      const method = /\bmethod\s*:\s*["'`]([A-Z]+)["'`]/i.exec(match[2]!)?.[1] ?? "UNKNOWN";
      add("api", `${method.toUpperCase()} ${operationPath}`, match[1], {
        adapter: "source-request-config",
        confidence: method === "UNKNOWN" ? "medium" : "high",
      });
    },
  );
  forEachMatch(
    content,
    /\b((?:[A-Za-z_$][A-Za-z0-9_$]*\.)*(?:request|apiRequest|httpRequest))\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([\s\S]{0,300}?)\})?/gi,
    (match) => {
      if (!isRequestAdapter(match[1]!, apiBindings.receivers)) return;
      const method = /\bmethod\s*:\s*["'`]([A-Z]+)["'`]/i.exec(match[3] ?? "")?.[1] ?? "UNKNOWN";
      add("api", `${method.toUpperCase()} ${match[2]}`, match[1], {
        adapter: "source-request-config",
        confidence: method === "UNKNOWN" ? "medium" : "high",
      });
    },
  );
  for (const functionName of apiBindings.generatedFunctions) {
    const callPattern = new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`, "g");
    forEachMatch(content, callPattern, (match) => {
      if (isConstructorCall(content, match.index)) return;
      const method = generatedMethod(functionName);
      add("api", `${method} operation:${functionName}`, functionName, {
        adapter: "source-generated-client",
        confidence: "medium",
      });
    });
  }
  for (const receiver of apiBindings.generatedReceivers) {
    const callPattern = new RegExp(
      `\\b${escapeRegExp(receiver)}\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`,
      "g",
    );
    forEachMatch(content, callPattern, (match) => {
      if (isConstructorCall(content, match.index)) return;
      if (/^(?:get|post|put|patch|delete|head|options|request)$/i.test(match[1]!)) return;
      add("api", `${generatedMethod(match[1]!)} operation:${match[1]}`, `${receiver}.${match[1]}`, {
        adapter: "source-generated-client",
        confidence: "medium",
      });
    });
  }

  forEachMatch(
    content,
    /\b(?:createStore|createSlice|defineStore|zustand|useReducer)\b/g,
    (match) => add("state", assignedSymbol(content, match.index) ?? match[0], match[0]),
  );
  forEachMatch(content, /\b(localStorage|sessionStorage|indexedDB)\b/g, (match) =>
    add("persistence", match[1]!, match[1]),
  );
  forEachMatch(
    content,
    /\b(ReactNativeWebView|postMessage|electron|webkit\.messageHandlers|invoke)\b/g,
    (match) => add("bridge", match[1]!, match[1]),
  );
  forEachMatch(
    content,
    /\b(?:analytics\.(?:track|capture)|track|capture)\s*\(\s*["'`]([^"'`]+)["'`]/g,
    (match) => add("analytics", match[1]!, match[1]),
  );
  forEachMatch(
    content,
    /(?:from\s*|require\s*\(\s*)["'`]([^"'`]+\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|otf))["'`]/gi,
    (match) => add("asset", match[1]!, path.basename(match[1]!)),
  );
  forEachMatch(content, /\b(?:i18n|useTranslation|\bt\s*\()\b/g, (match) =>
    add("resource", assignedSymbol(content, match.index) ?? match[0], match[0]),
  );
  if (
    /\.(?:css|scss|sass|less)$/i.test(sourcePath) &&
    /(?:^|[}\s])(?:\:root|html|body)\b/m.test(content)
  ) {
    add("global-css", sourcePath, path.basename(sourcePath));
  }

  return discovered;
}

function forEachMatch(
  content: string,
  expression: RegExp,
  callback: (match: RegExpExecArray) => void,
): void {
  let match: RegExpExecArray | null;
  while ((match = expression.exec(content)) !== null) callback(match);
}

function assignedSymbol(content: string, index: number): string | undefined {
  return /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/.exec(
    content.slice(Math.max(0, index - 120), index),
  )?.[1];
}

function discoverApiBindings(content: string): {
  receivers: Set<string>;
  generatedReceivers: Set<string>;
  generatedFunctions: Set<string>;
} {
  const receivers = new Set(["axios"]);
  const generatedReceivers = new Set<string>();
  const generatedFunctions = new Set<string>();
  forEachMatch(
    content,
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:axios\.create\s*\(|(?:create|make)[A-Za-z0-9_$]*(?:Api|Http)[A-Za-z0-9_$]*(?:Client|Service)\s*\(|new\s+[A-Za-z0-9_$]*(?:Api|Http)[A-Za-z0-9_$]*(?:Client|Service)\s*\()/g,
    (match) => receivers.add(match[1]!),
  );
  forEachMatch(content, /\bimport\s+([\s\S]{1,300}?)\s+from\s+["'`]([^"'`]+)["'`]/gi, (match) => {
    if (!isGeneratedClientImportSource(match[2]!)) return;
    const clause = match[1]!.trim();
    const namespace = /^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(clause)?.[1];
    if (namespace !== undefined) {
      receivers.add(namespace);
      generatedReceivers.add(namespace);
      return;
    }
    const named = /\{([\s\S]*?)\}/u.exec(clause)?.[1];
    if (named !== undefined) {
      for (const specifier of named.split(",")) {
        const local = /(?:^|\s+as\s+)([A-Za-z_$][A-Za-z0-9_$]*)\s*$/u.exec(specifier.trim())?.[1];
        if (local !== undefined) generatedFunctions.add(local);
      }
    }
    const defaultImport = /^([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(clause)?.[1];
    if (defaultImport !== undefined) {
      receivers.add(defaultImport);
      generatedReceivers.add(defaultImport);
    }
  });
  return { receivers, generatedReceivers, generatedFunctions };
}

function isGeneratedClientImportSource(source: string): boolean {
  const normalized = source.replace(/\\/gu, "/");
  const explicitGeneratedMarker =
    /(?:^|[/@._-])(?:generated|codegen|openapi|swagger|sdk)(?:[/@._-]|$)/iu;
  if (explicitGeneratedMarker.test(normalized)) return true;
  // Standalone `api`, `client`, and `service` segments also describe handwritten facades
  // such as `@apollo/client`; require compound client provenance before inferring operations.
  return /(?:^|[/@._-])(?:(?:api|service)[._-]+client|client[._-]+api)(?:[/@._-]|$)/iu.test(
    normalized,
  );
}

function isConstructorCall(content: string, callIndex: number): boolean {
  return /\bnew\s*$/u.test(content.slice(Math.max(0, callIndex - 80), callIndex));
}

function isApiReceiver(receiver: string, configured: Set<string>): boolean {
  const segments = receiver.split(".");
  return (
    segments.some((segment) => configured.has(segment)) ||
    segments.some((segment) => /(?:api|http|client|request|service|sdk|axios)/i.test(segment))
  );
}

function isRequestAdapter(receiver: string, configured: Set<string>): boolean {
  const segments = receiver.split(".");
  return (
    /^(?:request|apiRequest|httpRequest)$/i.test(receiver) ||
    isApiReceiver(segments.slice(0, -1).join("."), configured)
  );
}

function generatedMethod(symbol: string): string {
  if (/^(?:get|list|fetch|load|read)/i.test(symbol)) return "GET";
  if (/^(?:post|create|add)/i.test(symbol)) return "POST";
  if (/^(?:put|replace)/i.test(symbol)) return "PUT";
  if (/^(?:patch|update)/i.test(symbol)) return "PATCH";
  if (/^(?:delete|remove)/i.test(symbol)) return "DELETE";
  return "UNKNOWN";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function normalizeKey(category: LegacyFeatureEntry["category"], value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (category === "api") {
    const match = /^([A-Za-z]+)\s+(.+)$/u.exec(compact);
    if (match !== null) {
      return `${match[1]!.toUpperCase()} ${safeApiLocator(match[2]!)}`.slice(0, 500);
    }
  }
  if (category === "route" || category === "deep-link") {
    return safeApiLocator(compact).toLowerCase().slice(0, 500);
  }
  return compact.toLowerCase().slice(0, 500);
}

function safeApiLocator(rawLocator: string): string {
  const locator = rawLocator.trim();
  const environmentTemplatePath = normalizeEnvironmentBaseTemplate(locator);
  if (environmentTemplatePath !== undefined) return environmentTemplatePath;
  if (locator.startsWith("//")) {
    try {
      const parsed = new URL(`https:${locator}`);
      return `//${parsed.host}${parsed.pathname}`;
    } catch {
      return "invalid-url-reference";
    }
  }
  try {
    const parsed = new URL(locator);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    // Relative paths and symbolic locators are normalized below.
  }
  return locator.split(/[?#]/u, 1)[0]!;
}

function normalizeEnvironmentBaseTemplate(locator: string): string | undefined {
  const match =
    /^\$\{(?:process\.env|import\.meta\.env)\.([A-Za-z_$][A-Za-z0-9_$]*)\}([\s\S]+)$/u.exec(
      locator,
    );
  if (match === null) return undefined;

  const environmentName = match[1]!.toUpperCase();
  if (
    /(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|TOKEN)(?:_|$)/u.test(
      environmentName,
    ) ||
    !/(?:^|_)(?:API|BASE|GATEWAY|GW|HOST|ORIGIN|URI|URL)(?:_|$)/u.test(environmentName)
  ) {
    return undefined;
  }

  const suffix = match[2]!.split(/[?#]/u, 1)[0]!;
  if (
    suffix === "" ||
    /[\u0000-\u0020\u007f\\]/u.test(suffix) ||
    /^(?:\/\/|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(suffix)
  ) {
    return undefined;
  }

  let safe = true;
  const templatedPath = suffix
    .split("/")
    .map((segment) => {
      if (!segment.includes("${")) return segment;
      const placeholder = /^\$\{([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\}$/u.exec(
        segment,
      );
      if (placeholder === null) {
        safe = false;
        return segment;
      }
      return `{${placeholder[1]!.split(".").at(-1)!}}`;
    })
    .join("/");
  if (!safe || templatedPath.includes("${")) return undefined;

  const normalized = `/${templatedPath.replace(/^\/+/, "")}`;
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  return normalized;
}

function stableFeatureKey(
  category: LegacyFeatureEntry["category"],
  normalizedKey: string,
  sourcePath: string,
): string {
  const digest = createHash("sha256")
    .update(category)
    .update("\0")
    .update(normalizedKey)
    .update("\0")
    .update(sourcePath)
    .digest("hex")
    .slice(0, 24);
  return `legacy_${digest}`;
}
