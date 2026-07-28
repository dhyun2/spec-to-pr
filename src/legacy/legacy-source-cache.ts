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
    const source = await readBoundedDigestInput(configPath, cache);
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
  const vueConfig = await readBoundedDigestInput(
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

export async function legacyEnvironmentDigest(
  applicationRoot: string,
  cache: LegacySourceCache,
): Promise<Sha256Digest> {
  const directory = await opendir(applicationRoot);
  const names: string[] = [];
  for await (const entry of directory) {
    if (entry.isFile() && /^\.env(?:\..+)?$/u.test(entry.name)) names.push(entry.name);
  }
  names.sort();
  const evidence: Array<[string, string, string]> = [];
  for (const sourceName of names.slice(0, MAX_ENVIRONMENT_EVIDENCE_FILES)) {
    const source = await readBoundedDigestInput(path.join(applicationRoot, sourceName), cache);
    if (source === undefined) continue;
    for (const line of source.text().split(/\r?\n/u)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
      if (match === null || !isSafeUrlEnvironmentName(match[1]!)) continue;
      const origin = sanitizedHttpOrigin(unquote(match[2]!));
      if (origin !== undefined) evidence.push([sourceName, match[1]!, origin]);
    }
  }
  if (names.length > MAX_ENVIRONMENT_EVIDENCE_FILES) {
    evidence.push([
      "@bounded",
      "remaining-file-count",
      String(names.length - MAX_ENVIRONMENT_EVIDENCE_FILES),
    ]);
  }
  evidence.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return sha256Digest(JSON.stringify(evidence));
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
};

export async function currentLegacySourceManifest(
  featureRoot: string,
  pinned: LegacySourceManifest,
  cache: LegacySourceCache,
  limits: LegacyManifestScanLimits,
): Promise<{ manifest: LegacySourceManifest; truncated: boolean }> {
  const startedAt = Date.now();
  const canonicalFeatureRoot = await realpath(featureRoot);
  const applicationRoot = await findLegacyApplicationRoot(canonicalFeatureRoot);
  const config = await loadLegacyResolutionConfig(applicationRoot, cache);
  const environmentDigest = await legacyEnvironmentDigest(applicationRoot, cache);
  const paths = await collectCurrentOwnedPaths(canonicalFeatureRoot, limits, startedAt);
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
  let truncated = paths.truncated;
  let scannedBytes = 0;
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
    if (scannedBytes + record.byteLength > limits.maxBytes) {
      truncated = true;
      break;
    }
    scannedBytes += record.byteLength;
    files.push(legacyManifestFile(record, applicationRelativePath));
  }
  return {
    manifest: createLegacySourceManifest({
      files,
      environmentDigest,
      configDigest: config.digest,
    }),
    truncated,
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

function isSafeUrlEnvironmentName(name: string): boolean {
  return /(?:^|_)(?:API|BASE|BACKEND|ENDPOINT|GATEWAY|HOST|ORIGIN|URL)(?:_|$)/iu.test(name);
}

function sanitizedHttpOrigin(value: string): string | undefined {
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

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(['"]).*\1$/su.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

async function collectCurrentOwnedPaths(
  root: string,
  limits: LegacyManifestScanLimits,
  startedAt: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const pending = [{ directory: root, depth: 0 }];
  let truncated = false;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > limits.maxDepth || Date.now() - startedAt >= limits.maxElapsedMs) {
      truncated = true;
      break;
    }
    const directory = await opendir(current.directory);
    const entries = [];
    for await (const entry of directory) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        pending.push({ directory: absolutePath, depth: current.depth + 1 });
      } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
        if (files.length >= limits.maxFiles) {
          truncated = true;
          break;
        }
        files.push(await realpath(absolutePath));
      }
    }
    if (truncated) break;
  }
  return { files: files.sort(), truncated };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readBoundedDigestInput(
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
