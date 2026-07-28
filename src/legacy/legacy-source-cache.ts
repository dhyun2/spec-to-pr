import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { Sha256DigestSchema, type Sha256Digest } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import { isLegacyCodePath, parseLegacySource, type ParsedLegacySource } from "./legacy-parser.js";

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|json)$/i;
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
const MAX_ENVIRONMENT_EVIDENCE_FILES = 100;
const MAX_LEGACY_DIGEST_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_LEGACY_RESOLUTION_DECISIONS = 5_000;
const RESOLUTION_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".less",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.vue",
] as const;

export const LegacySourceManifestSchema = z
  .object({
    schemaVersion: z.literal("legacy-source-manifest-v1"),
    algorithmVersion: z.literal("legacy-source-digest-v3"),
    files: z.array(
      z
        .object({
          realPathKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          applicationRelativePath: z.string().trim().min(1),
          digest: Sha256DigestSchema,
          byteLength: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    environmentDigest: Sha256DigestSchema,
    configDigest: Sha256DigestSchema,
    manifestDigest: Sha256DigestSchema,
  })
  .strict();

export type LegacySourceManifest = z.infer<typeof LegacySourceManifestSchema>;
export type LegacySourceManifestFile = LegacySourceManifest["files"][number];

export const LegacySourceEnvironmentReferenceSchema = z
  .object({
    runtime: z.enum(["process.env", "import.meta.env"]),
    name: z.string().trim().min(1),
    sourcePaths: z.array(z.string().trim().min(1)),
    sanitizedOrigin: z.string().url().optional(),
    sanitizedOrigins: z
      .array(
        z
          .object({
            sourceName: z.string().trim().min(1),
            origin: z.string().url(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type LegacySourceEnvironmentReference = z.infer<
  typeof LegacySourceEnvironmentReferenceSchema
>;

export const LegacyResolutionDecisionSchema = z
  .object({
    importer: z.string().trim().min(1).max(1_000),
    specifier: z.string().trim().min(1).max(1_000),
    resolvedPath: z.union([z.literal("@missing"), z.string().trim().min(1).max(1_000)]),
  })
  .strict();

export type LegacyResolutionDecision = z.infer<typeof LegacyResolutionDecisionSchema>;

export type LegacySourceCacheStats = {
  fileReads: number;
  astParses: number;
  semanticRebuilds: number;
};

export type LegacySourceRecord = {
  readonly realPath: string;
  readonly digest: `sha256:${string}`;
  readonly byteLength: number;
  readonly bytes: Buffer;
  text(): string;
  parsed(): ParsedLegacySource;
};

export class LegacySourceCache {
  readonly #recordsByRealPath = new Map<string, LegacySourceRecord>();
  readonly #recordsByKey = new Map<string, LegacySourceRecord>();
  readonly #stats: LegacySourceCacheStats = {
    fileReads: 0,
    astParses: 0,
    semanticRebuilds: 0,
  };

  async read(filePath: string): Promise<LegacySourceRecord | undefined> {
    let details;
    try {
      details = await lstat(filePath);
    } catch {
      return undefined;
    }
    if (!details.isFile() || details.isSymbolicLink()) return undefined;
    const canonicalPath = await realpath(filePath);
    const cached = this.#recordsByRealPath.get(canonicalPath);
    if (cached !== undefined) return cached;
    const bytes = await readFile(canonicalPath);
    this.#stats.fileReads += 1;
    const digest = sha256Digest(bytes) as `sha256:${string}`;
    const key = `${canonicalPath}\0${digest}`;
    const digestCached = this.#recordsByKey.get(key);
    if (digestCached !== undefined) {
      this.#recordsByRealPath.set(canonicalPath, digestCached);
      return digestCached;
    }
    let text: string | undefined;
    let parsed: ParsedLegacySource | undefined;
    const record: LegacySourceRecord = Object.freeze({
      realPath: canonicalPath,
      digest,
      byteLength: bytes.byteLength,
      bytes,
      text: () => {
        text ??= bytes.toString("utf8");
        return text;
      },
      parsed: () => {
        if (!isLegacyCodePath(canonicalPath)) {
          throw new Error(`Cannot parse non-code legacy source: ${canonicalPath}`);
        }
        if (parsed === undefined) {
          text ??= bytes.toString("utf8");
          parsed = parseLegacySource(text, canonicalPath);
          this.#stats.astParses += 1;
        }
        return parsed;
      },
    });
    this.#recordsByRealPath.set(canonicalPath, record);
    this.#recordsByKey.set(key, record);
    return record;
  }

  beginSnapshot(): void {
    this.#recordsByRealPath.clear();
  }

  record(realPath: string, digest: Sha256Digest): LegacySourceRecord | undefined {
    return this.#recordsByKey.get(`${realPath}\0${digest}`);
  }

  recordSemanticRebuild(): void {
    this.#stats.semanticRebuilds += 1;
  }

  snapshotStats(): Readonly<LegacySourceCacheStats> {
    return Object.freeze({ ...this.#stats });
  }

  toJSON(): undefined {
    return undefined;
  }
}

export type LegacyResolutionConfig = {
  aliases: Record<string, string>;
  digest: Sha256Digest;
};

export async function loadLegacyResolutionConfig(
  applicationRoot: string,
  cache: LegacySourceCache,
): Promise<LegacyResolutionConfig> {
  const aliases = new Map<string, string>();
  for (const configName of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(applicationRoot, configName);
    const source = await readLegacyBoundedDigestInput(configPath, cache);
    if (source === undefined) continue;
    let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    try {
      parsed = JSON.parse(jsonConfigurationText(source.text())) as typeof parsed;
    } catch {
      continue;
    }
    const compilerOptions = parsed.compilerOptions;
    const baseUrl = path.resolve(applicationRoot, compilerOptions?.baseUrl ?? ".");
    for (const [key, targets] of Object.entries(compilerOptions?.paths ?? {})) {
      const first = targets[0];
      if (first === undefined) continue;
      aliases.set(key.replace(/\*$/u, ""), path.resolve(baseUrl, first.replace(/\*$/u, "")));
    }
  }
  const vueConfig = await readLegacyBoundedDigestInput(
    path.join(applicationRoot, "vue.config.js"),
    cache,
  );
  if (vueConfig !== undefined) {
    const expression =
      /["']([^"']+)["']\s*:\s*path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*["']([^"']+)["']/gu;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(vueConfig.text())) !== null) {
      aliases.set(match[1]!, path.resolve(applicationRoot, match[2]!));
    }
  }
  const sorted = [...aliases].sort(([left], [right]) => left.localeCompare(right));
  const digestInput = sorted.map(([key, target]) => [
    key,
    path.relative(applicationRoot, target).split(path.sep).join("/"),
  ]);
  return {
    aliases: Object.fromEntries(sorted),
    digest: sha256Digest(JSON.stringify(digestInput)),
  };
}

export function legacyEnvironmentReferencesDigest(
  references: LegacySourceEnvironmentReference[],
): Sha256Digest {
  return sha256Digest(JSON.stringify(canonicalEnvironmentReferences(references)));
}

export function legacyManifestConfigDigest(
  resolutionConfigDigest: Sha256Digest,
  resolutionStateDigest: Sha256Digest,
): Sha256Digest {
  return sha256Digest(JSON.stringify([resolutionConfigDigest, resolutionStateDigest]));
}

export async function legacyResolutionStateDigest(input: {
  featureRoot: string;
  applicationRoot: string;
  aliases: Record<string, string>;
  decisions: LegacyResolutionDecision[];
  expired?: () => boolean;
}): Promise<Sha256Digest> {
  const state: Array<[string, string, string, string]> = [];
  for (const decision of [...input.decisions].sort((left, right) =>
    `${left.importer}\0${left.specifier}`.localeCompare(`${right.importer}\0${right.specifier}`),
  )) {
    if (input.expired?.() === true) {
      state.push([decision.importer, decision.specifier, decision.resolvedPath, "@truncated"]);
      break;
    }
    const importer = decision.importer.startsWith("@app/")
      ? path.join(input.applicationRoot, decision.importer.slice("@app/".length))
      : path.join(input.featureRoot, decision.importer);
    const resolved = await resolveLegacyDependencyProbe(
      importer,
      decision.specifier,
      input.applicationRoot,
      input.aliases,
    );
    state.push([
      decision.importer,
      decision.specifier,
      decision.resolvedPath,
      resolved === undefined
        ? "@missing"
        : path.relative(input.applicationRoot, resolved).split(path.sep).join("/"),
    ]);
  }
  return sha256Digest(JSON.stringify(state));
}

export function createLegacySourceManifest(input: {
  files: LegacySourceManifestFile[];
  environmentDigest: Sha256Digest;
  configDigest: Sha256Digest;
}): LegacySourceManifest {
  const unsigned = {
    schemaVersion: "legacy-source-manifest-v1" as const,
    algorithmVersion: "legacy-source-digest-v3" as const,
    files: [...input.files].sort((left, right) =>
      left.applicationRelativePath.localeCompare(right.applicationRelativePath),
    ),
    environmentDigest: input.environmentDigest,
    configDigest: input.configDigest,
  };
  const parsed = LegacySourceManifestSchema.parse({
    ...unsigned,
    manifestDigest: sha256Digest(JSON.stringify(unsigned)),
  });
  return freezeManifest(parsed);
}

export function legacyManifestFile(
  record: LegacySourceRecord,
  applicationRelativePath: string,
): LegacySourceManifestFile {
  return {
    realPathKey: sha256Digest(record.realPath),
    applicationRelativePath: applicationRelativePath.split(path.sep).join("/"),
    digest: record.digest,
    byteLength: record.byteLength,
  };
}

export type LegacyManifestScanLimits = {
  maxFiles: number;
  maxBytes: number;
  maxDepth: number;
  maxElapsedMs: number;
  maxDirectories: number;
  maxEntries: number;
};

export type LegacyManifestRefreshContext = {
  environmentReferences?: LegacySourceEnvironmentReference[];
  resolutionDecisions?: LegacyResolutionDecision[];
};

export async function currentLegacySourceManifest(
  featureRoot: string,
  pinned: LegacySourceManifest,
  cache: LegacySourceCache,
  limits: LegacyManifestScanLimits,
  context: LegacyManifestRefreshContext = {},
): Promise<{ manifest: LegacySourceManifest; truncated: boolean }> {
  cache.beginSnapshot();
  const startedAt = Date.now();
  const traversal: LegacyWarmTraversal = {
    limits,
    startedAt,
    visitedDirectories: 0,
    visitedEntries: 0,
    scannedFiles: 0,
    scannedBytes: 0,
    truncated: false,
  };
  const canonicalFeatureRoot = await realpath(featureRoot);
  const applicationRoot = await findLegacyApplicationRoot(canonicalFeatureRoot);
  const config = await loadLegacyResolutionConfig(applicationRoot, cache);
  if (Date.now() - startedAt >= limits.maxElapsedMs) traversal.truncated = true;
  const refreshedEnvironment = await refreshLegacyEnvironmentReferences(
    applicationRoot,
    context.environmentReferences ?? [],
    cache,
    traversal,
  );
  const resolutionStateDigest = await legacyResolutionStateDigest({
    featureRoot: canonicalFeatureRoot,
    applicationRoot,
    aliases: config.aliases,
    decisions: context.resolutionDecisions ?? [],
    expired: () => Date.now() - startedAt >= limits.maxElapsedMs,
  });
  if (Date.now() - startedAt >= limits.maxElapsedMs) traversal.truncated = true;
  const paths = await collectCurrentOwnedPaths(canonicalFeatureRoot, traversal);
  const byApplicationPath = new Map<string, string>();
  for (const realPath of paths.files) {
    byApplicationPath.set(
      path.relative(applicationRoot, realPath).split(path.sep).join("/"),
      realPath,
    );
  }
  for (const file of pinned.files) {
    const absolutePath = path.resolve(applicationRoot, file.applicationRelativePath);
    if (isWithin(canonicalFeatureRoot, absolutePath)) continue;
    byApplicationPath.set(file.applicationRelativePath, absolutePath);
  }
  const files: LegacySourceManifestFile[] = [];
  let truncated = traversal.truncated;
  if (byApplicationPath.size > limits.maxFiles) truncated = true;
  for (const [applicationRelativePath, absolutePath] of [...byApplicationPath]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limits.maxFiles)) {
    if (Date.now() - startedAt >= limits.maxElapsedMs) {
      truncated = true;
      break;
    }
    const record = await cache.read(absolutePath);
    if (record === undefined) continue;
    if (
      traversal.scannedFiles >= limits.maxFiles ||
      traversal.scannedBytes + record.byteLength > limits.maxBytes
    ) {
      truncated = true;
      break;
    }
    traversal.scannedFiles += 1;
    traversal.scannedBytes += record.byteLength;
    files.push(legacyManifestFile(record, applicationRelativePath));
  }
  return {
    manifest: createLegacySourceManifest({
      files,
      environmentDigest: legacyEnvironmentReferencesDigest(refreshedEnvironment.references),
      configDigest: legacyManifestConfigDigest(config.digest, resolutionStateDigest),
    }),
    truncated: truncated || traversal.truncated,
  };
}

export async function findLegacyApplicationRoot(featureRoot: string): Promise<string> {
  let current = featureRoot;
  while (true) {
    const packageFile = await lstat(path.join(current, "package.json")).catch(() => undefined);
    if (packageFile?.isFile() === true && !packageFile.isSymbolicLink()) return current;
    const gitDirectory = await lstat(path.join(current, ".git")).catch(() => undefined);
    if (gitDirectory?.isDirectory() === true) return featureRoot;
    const parent = path.dirname(current);
    if (parent === current) return featureRoot;
    current = parent;
  }
}

function freezeManifest(manifest: LegacySourceManifest): LegacySourceManifest {
  manifest.files.forEach((file) => Object.freeze(file));
  Object.freeze(manifest.files);
  return Object.freeze(manifest);
}

function jsonConfigurationText(content: string): string {
  let result = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const current = content[index]!;
    const next = content[index + 1];
    if (quote !== undefined) {
      result += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = undefined;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      result += current;
    } else if (current === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
      result += "\n";
    } else if (current === "/" && next === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
    } else {
      result += current;
    }
  }
  return result.replace(/,\s*([}\]])/gu, "$1");
}

export function isSafeLegacyUrlEnvironmentName(name: string): boolean {
  return (
    !/(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|TOKEN)(?:_|$)/iu.test(name) &&
    /(?:^|_)(?:API|BASE|ENDPOINT|GATEWAY|GW|HOST|ORIGIN|URI|URL)(?:_|$)/iu.test(name)
  );
}

export function sanitizedLegacyHttpOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/u.test(parsed.protocol) || parsed.username !== "" || parsed.password !== "") {
      return undefined;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function legacyEnvironmentValue(content: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*?)\\s*$`, "mu").exec(content);
  if (match === null) return undefined;
  const value = match[1]!.trim();
  return /^(['"]).*\1$/su.test(value) ? value.slice(1, -1) : value;
}

type LegacyWarmTraversal = {
  limits: LegacyManifestScanLimits;
  startedAt: number;
  visitedDirectories: number;
  visitedEntries: number;
  scannedFiles: number;
  scannedBytes: number;
  truncated: boolean;
};

async function collectCurrentOwnedPaths(
  root: string,
  traversal: LegacyWarmTraversal,
): Promise<{ files: string[] }> {
  const files: string[] = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    traversal.visitedDirectories += 1;
    if (
      traversal.visitedDirectories > traversal.limits.maxDirectories ||
      current.depth > traversal.limits.maxDepth ||
      Date.now() - traversal.startedAt >= traversal.limits.maxElapsedMs
    ) {
      traversal.truncated = true;
      break;
    }
    const directory = await opendir(current.directory);
    const entries = [];
    for await (const entry of directory) {
      traversal.visitedEntries += 1;
      if (
        traversal.visitedEntries > traversal.limits.maxEntries ||
        Date.now() - traversal.startedAt >= traversal.limits.maxElapsedMs
      ) {
        traversal.truncated = true;
        break;
      }
      entries.push(entry);
    }
    if (traversal.truncated) break;
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        pending.push({ directory: absolutePath, depth: current.depth + 1 });
      } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
        if (files.length >= traversal.limits.maxFiles) {
          traversal.truncated = true;
          break;
        }
        files.push(await realpath(absolutePath));
      }
    }
    if (traversal.truncated) break;
  }
  return { files: files.sort() };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function readLegacyBoundedDigestInput(
  filePath: string,
  cache: LegacySourceCache,
): Promise<LegacySourceRecord | undefined> {
  const details = await lstat(filePath).catch(() => undefined);
  if (
    details === undefined ||
    !details.isFile() ||
    details.isSymbolicLink() ||
    details.size > MAX_LEGACY_DIGEST_INPUT_BYTES
  ) {
    return undefined;
  }
  return cache.read(filePath);
}

async function refreshLegacyEnvironmentReferences(
  applicationRoot: string,
  references: LegacySourceEnvironmentReference[],
  cache: LegacySourceCache,
  traversal: LegacyWarmTraversal,
): Promise<{ references: LegacySourceEnvironmentReference[] }> {
  if (references.length === 0) return { references: [] };
  traversal.visitedDirectories += 1;
  if (
    traversal.visitedDirectories > traversal.limits.maxDirectories ||
    Date.now() - traversal.startedAt >= traversal.limits.maxElapsedMs
  ) {
    traversal.truncated = true;
    return { references };
  }
  const directory = await opendir(applicationRoot);
  const names: string[] = [];
  let environmentFileCount = 0;
  for await (const entry of directory) {
    traversal.visitedEntries += 1;
    if (
      traversal.visitedEntries > traversal.limits.maxEntries ||
      Date.now() - traversal.startedAt >= traversal.limits.maxElapsedMs
    ) {
      traversal.truncated = true;
      break;
    }
    if (!entry.isFile() || !/^\.env(?:\..+)?$/u.test(entry.name)) continue;
    environmentFileCount += 1;
    names.push(entry.name);
    names.sort();
    if (names.length > MAX_ENVIRONMENT_EVIDENCE_FILES + 1) names.pop();
  }
  if (environmentFileCount > MAX_ENVIRONMENT_EVIDENCE_FILES) traversal.truncated = true;
  const contents: Array<{ sourceName: string; text: string }> = [];
  for (const sourceName of names.slice(0, MAX_ENVIRONMENT_EVIDENCE_FILES)) {
    const source = await readLegacyBoundedDigestInput(
      path.join(applicationRoot, sourceName),
      cache,
    );
    if (source === undefined) continue;
    if (
      traversal.scannedFiles >= traversal.limits.maxFiles ||
      traversal.scannedBytes + source.byteLength > traversal.limits.maxBytes
    ) {
      traversal.truncated = true;
      break;
    }
    traversal.scannedFiles += 1;
    traversal.scannedBytes += source.byteLength;
    contents.push({ sourceName, text: source.text() });
  }
  return {
    references: canonicalEnvironmentReferences(
      references.map((reference) => {
        const sanitizedOrigins: Array<{ sourceName: string; origin: string }> = [];
        if (isSafeLegacyUrlEnvironmentName(reference.name)) {
          for (const content of contents) {
            const value = legacyEnvironmentValue(content.text, reference.name);
            const origin = value === undefined ? undefined : sanitizedLegacyHttpOrigin(value);
            if (origin !== undefined) {
              sanitizedOrigins.push({ sourceName: content.sourceName, origin });
            }
          }
        }
        const origins = new Set(sanitizedOrigins.map((item) => item.origin));
        const sanitizedOrigin = origins.size === 1 ? [...origins][0] : undefined;
        return {
          runtime: reference.runtime,
          name: reference.name,
          sourcePaths: reference.sourcePaths,
          ...(sanitizedOrigin === undefined ? {} : { sanitizedOrigin }),
          ...(sanitizedOrigins.length === 0 ? {} : { sanitizedOrigins }),
        };
      }),
    ),
  };
}

function canonicalEnvironmentReferences(
  references: LegacySourceEnvironmentReference[],
): LegacySourceEnvironmentReference[] {
  return references
    .map((reference) => ({
      runtime: reference.runtime,
      name: reference.name,
      sourcePaths: [...reference.sourcePaths].sort(),
      ...(reference.sanitizedOrigin === undefined
        ? {}
        : { sanitizedOrigin: reference.sanitizedOrigin }),
      ...(reference.sanitizedOrigins === undefined
        ? {}
        : {
            sanitizedOrigins: [...reference.sanitizedOrigins].sort((left, right) =>
              `${left.sourceName}\0${left.origin}`.localeCompare(
                `${right.sourceName}\0${right.origin}`,
              ),
            ),
          }),
    }))
    .sort((left, right) =>
      `${left.runtime}\0${left.name}`.localeCompare(`${right.runtime}\0${right.name}`),
    );
}

async function resolveLegacyDependencyProbe(
  importer: string,
  specifier: string,
  applicationRoot: string,
  aliases: Record<string, string>,
): Promise<string | undefined> {
  let candidate: string;
  if (specifier.startsWith(".")) {
    candidate = path.resolve(path.dirname(importer), specifier);
  } else {
    const alias = Object.keys(aliases)
      .sort((left, right) => right.length - left.length)
      .find((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
    if (alias === undefined) return undefined;
    candidate = path.resolve(aliases[alias]!, specifier.slice(alias.length).replace(/^\/+/u, ""));
  }
  for (const suffix of RESOLUTION_EXTENSIONS) {
    const attempted = `${candidate}${suffix}`;
    const details = await lstat(attempted).catch(() => undefined);
    if (details?.isFile() !== true || details.isSymbolicLink()) continue;
    const resolved = await realpath(attempted);
    return isWithin(applicationRoot, resolved) ? resolved : undefined;
  }
  return undefined;
}
