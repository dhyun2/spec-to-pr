import { createHash } from "node:crypto";
import { lstat, opendir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

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
    version: z.literal(2),
    rootDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sourceDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    visitedDirectories: z.number().int().nonnegative().default(0),
    visitedEntries: z.number().int().nonnegative().default(0),
    scannedFiles: z.number().int().nonnegative(),
    scannedBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    apiDiscoveryAdapters: z
      .array(ApiDiscoveryAdapterSchema)
      .default([...SOURCE_API_DISCOVERY_ADAPTERS]),
    entries: z.array(LegacyFeatureEntrySchema).max(20_000),
  })
  .strict();

export type LegacyFeatureEntry = z.infer<typeof LegacyFeatureEntrySchema>;
export type LegacyInventory = z.infer<typeof LegacyInventorySchema>;

export async function buildLegacyInventory(
  root: string,
  limitOverrides: Partial<LegacyInventoryLimits> = {},
): Promise<LegacyInventory> {
  const limits = { ...DEFAULT_LEGACY_INVENTORY_LIMITS, ...limitOverrides };
  const files = await collectSourceFiles(root, limits);
  const entries = new Map<string, LegacyFeatureEntry>();
  const rootHash = createHash("sha256");
  let scannedBytes = 0;
  let scannedFiles = 0;
  let truncated = files.truncated;

  scan: for (const relativePath of files.paths) {
    const absolutePath = path.join(root, relativePath);
    if (files.startedAt + limits.maxElapsedMs <= Date.now()) {
      truncated = true;
      break;
    }
    const details = await lstat(absolutePath);
    if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_LEGACY_FILE_BYTES) {
      truncated = true;
      break;
    }
    if (scannedBytes + details.size > limits.maxSourceBytes) {
      truncated = true;
      break;
    }
    const bytes = await readFile(absolutePath);
    if (scannedBytes + bytes.byteLength > limits.maxSourceBytes) {
      truncated = true;
      break;
    }
    const content = bytes.toString("utf8");
    scannedBytes += bytes.byteLength;
    scannedFiles += 1;
    rootHash.update(relativePath).update("\0").update(content).update("\0");
    for (const entry of discoverFeatures(relativePath, content)) {
      if (entries.has(entry.featureKey)) continue;
      if (entries.size >= limits.maxFeatures) {
        truncated = true;
        break scan;
      }
      entries.set(entry.featureKey, entry);
    }
  }

  const rootDigest = `sha256:${rootHash.digest("hex")}`;
  return LegacyInventorySchema.parse({
    version: 2,
    rootDigest,
    sourceDigest: rootDigest,
    visitedDirectories: files.visitedDirectories,
    visitedEntries: files.visitedEntries,
    scannedFiles,
    scannedBytes,
    truncated,
    apiDiscoveryAdapters: SOURCE_API_DISCOVERY_ADAPTERS,
    entries: [...entries.values()].sort((left, right) =>
      left.featureKey.localeCompare(right.featureKey),
    ),
  });
}

export async function assertLegacyInventoryFresh(
  root: string,
  pinned: LegacyInventory,
): Promise<LegacyInventory> {
  if (pinned.truncated) {
    throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
  }
  const current = await buildLegacyInventory(root);
  if (current.truncated) {
    throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
  }
  if (current.rootDigest !== (pinned.sourceDigest ?? pinned.rootDigest)) {
    throw new Error(
      "LEGACY_SOURCE_CHANGED: restore the legacy source or restart intake from its new state",
    );
  }
  return current;
}

const MAX_RUNTIME_NETWORK_ENTRIES = 1_000;
const MAX_RUNTIME_NETWORK_BYTES = 1024 * 1024;
const HTTP_METHODS = new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);

export function mergeLegacyRuntimeNetworkEvidence(
  inventory: LegacyInventory,
  rawContent: string,
  sourcePath: string,
): LegacyInventory {
  const requests = parseLegacyRuntimeNetworkEvidence(rawContent);
  const entries = new Map(inventory.entries.map((entry) => [entry.featureKey, entry]));
  requests.forEach((request, index) => {
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
  });
}

export function validateLegacyRuntimeNetworkEvidence(rawContent: string): void {
  parseLegacyRuntimeNetworkEvidence(rawContent);
}

function parseLegacyRuntimeNetworkEvidence(
  rawContent: string,
): Array<{ method: string; url: string }> {
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
  requests.forEach((request, index) => {
    const method = request.method.trim().toUpperCase();
    if (!HTTP_METHODS.has(method)) {
      throw new Error(`Legacy runtime network request ${index + 1} has an unsupported method`);
    }
    runtimeRequestPath(request.url, index);
  });
  return requests;
}

function runtimeNetworkRequests(value: unknown): Array<{ method: string; url: string }> {
  let candidates: unknown[];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (isUnknownRecord(value) && Array.isArray(value["requests"])) {
    candidates = value["requests"];
  } else if (
    isUnknownRecord(value) &&
    isUnknownRecord(value["log"]) &&
    Array.isArray(value["log"]["entries"])
  ) {
    candidates = value["log"]["entries"].map((entry) =>
      isUnknownRecord(entry) ? entry["request"] : undefined,
    );
  } else {
    throw new Error(
      "Legacy runtime network evidence must be a HAR log, a requests array, or a request array",
    );
  }

  return candidates.map((candidate, index) => {
    if (
      !isUnknownRecord(candidate) ||
      typeof candidate["method"] !== "string" ||
      candidate["method"].trim() === ""
    ) {
      throw new Error(`Legacy runtime network request ${index + 1} requires a method`);
    }
    if (typeof candidate["url"] !== "string" || candidate["url"].trim() === "") {
      throw new Error(`Legacy runtime network request ${index + 1} requires a URL`);
    }
    return { method: candidate["method"], url: candidate["url"] };
  });
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
