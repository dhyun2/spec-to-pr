import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  type LegacyAstNode,
  isLegacyAstNode,
  legacyMemberObject,
  legacyMemberProperty,
  legacyPropertyName,
  parseLegacySource,
  walkLegacyAst,
} from "./legacy-parser.js";

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|json)$/i;
const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
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
];

export type LegacySourceGraphLimits = {
  maxFiles: number;
  maxBytes: number;
  maxDepth: number;
  maxElapsedMs: number;
};

const DEFAULT_LIMITS: LegacySourceGraphLimits = {
  maxFiles: 1_000,
  maxBytes: 20 * 1024 * 1024,
  maxDepth: 32,
  maxElapsedMs: 5_000,
};

export type LegacyGraphFile = {
  absolutePath: string;
  sourcePath: string;
  applicationRelativePath: string;
  content: string;
  digest: `sha256:${string}`;
  ownership: "feature" | "supporting-dependency";
};

export type LegacyDependencyEdge = {
  importer: string;
  specifier: string;
  resolvedPath: string;
  resolver: "relative-import" | "alias" | "style" | "asset";
};

export type LegacyEnvironmentReference = {
  runtime: "process.env" | "import.meta.env";
  name: string;
  sourcePaths: string[];
  sanitizedOrigin?: string;
  sanitizedOrigins?: Array<{ sourceName: string; origin: string }>;
};

export type LegacySourceGraph = {
  featureRoot: string;
  applicationRoot: string;
  files: LegacyGraphFile[];
  ownedFiles: LegacyGraphFile[];
  supportingFiles: LegacyGraphFile[];
  edges: LegacyDependencyEdge[];
  aliases: Record<string, string>;
  environmentRefs: LegacyEnvironmentReference[];
  sourceDigest: `sha256:${string}`;
  truncated: boolean;
  truncation?: { limit: string; sourcePath: string };
};

export async function discoverLegacySourceGraph(
  featureRoot: string,
  limitOverrides: Partial<LegacySourceGraphLimits> = {},
): Promise<LegacySourceGraph> {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const startedAt = Date.now();
  const canonicalFeatureRoot = await realpath(featureRoot);
  const applicationRoot = await findEnclosingApplicationRoot(canonicalFeatureRoot);
  const aliases = await loadSupportedAliases(applicationRoot);
  const ownedPaths = await collectOwnedSourceFiles(canonicalFeatureRoot, limits, startedAt);
  const files = new Map<string, LegacyGraphFile>();
  const edges: LegacyDependencyEdge[] = [];
  const environmentSources = new Map<
    string,
    { runtime: LegacyEnvironmentReference["runtime"]; sourcePaths: Set<string> }
  >();
  let scannedBytes = 0;
  let truncation: LegacySourceGraph["truncation"];

  const pending: Array<{
    absolutePath: string;
    ownership: LegacyGraphFile["ownership"];
  }> = ownedPaths.map((absolutePath) => ({ absolutePath, ownership: "feature" }));
  while (pending.length > 0) {
    const next = pending.shift()!;
    if (files.has(next.absolutePath)) continue;
    if (Date.now() - startedAt >= limits.maxElapsedMs) {
      truncation = {
        limit: "maxElapsedMs",
        sourcePath: publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot),
      };
      break;
    }
    if (files.size >= limits.maxFiles) {
      truncation = {
        limit: "maxFiles",
        sourcePath: publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot),
      };
      break;
    }
    const details = await lstat(next.absolutePath);
    if (!details.isFile() || details.isSymbolicLink()) continue;
    if (scannedBytes + details.size > limits.maxBytes) {
      truncation = {
        limit: "maxBytes",
        sourcePath: publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot),
      };
      break;
    }
    const content = await readFile(next.absolutePath, "utf8");
    scannedBytes += Buffer.byteLength(content, "utf8");
    const sourcePath = publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot);
    const graphFile: LegacyGraphFile = {
      absolutePath: next.absolutePath,
      sourcePath,
      applicationRelativePath: path
        .relative(applicationRoot, next.absolutePath)
        .split(path.sep)
        .join("/"),
      content,
      digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      ownership: next.ownership,
    };
    files.set(next.absolutePath, graphFile);

    if (!SCRIPT_EXTENSION.test(next.absolutePath)) continue;
    for (const environment of discoverEnvironmentReferences(content, next.absolutePath)) {
      const key = `${environment.runtime}:${environment.name}`;
      const existing = environmentSources.get(key) ?? {
        runtime: environment.runtime,
        sourcePaths: new Set<string>(),
      };
      existing.sourcePaths.add(sourcePath);
      environmentSources.set(key, existing);
    }
    for (const specifier of discoverModuleSpecifiers(content, next.absolutePath)) {
      const resolved = await resolveGraphDependency({
        importer: next.absolutePath,
        specifier,
        applicationRoot,
        aliases,
      });
      if (resolved === undefined || files.has(resolved.absolutePath)) continue;
      edges.push({
        importer: sourcePath,
        specifier,
        resolvedPath: path
          .relative(applicationRoot, resolved.absolutePath)
          .split(path.sep)
          .join("/"),
        resolver: resolved.resolver,
      });
      pending.push({ absolutePath: resolved.absolutePath, ownership: "supporting-dependency" });
    }
  }

  const environmentRefs = await enrichEnvironmentReferences(
    [...environmentSources.entries()].map(([key, value]) => ({
      key,
      runtime: value.runtime,
      name: key.slice(key.indexOf(":") + 1),
      sourcePaths: [...value.sourcePaths].sort(),
    })),
    applicationRoot,
  );
  const allFiles = [...files.values()].sort((left, right) =>
    left.applicationRelativePath.localeCompare(right.applicationRelativePath),
  );
  const sourceHash = createHash("sha256");
  for (const file of allFiles) {
    sourceHash.update(file.applicationRelativePath).update("\0").update(file.digest).update("\0");
  }
  sourceHash.update(JSON.stringify(environmentRefs)).update("\0");

  return {
    featureRoot: canonicalFeatureRoot,
    applicationRoot,
    files: allFiles,
    ownedFiles: allFiles.filter((file) => file.ownership === "feature"),
    supportingFiles: allFiles.filter((file) => file.ownership === "supporting-dependency"),
    edges: edges.sort((left, right) =>
      `${left.importer}:${left.specifier}`.localeCompare(`${right.importer}:${right.specifier}`),
    ),
    aliases,
    environmentRefs,
    sourceDigest: `sha256:${sourceHash.digest("hex")}`,
    truncated: truncation !== undefined,
    ...(truncation === undefined ? {} : { truncation }),
  };
}

async function findEnclosingApplicationRoot(featureRoot: string): Promise<string> {
  let current = featureRoot;
  while (true) {
    if (await isRegularFile(path.join(current, "package.json"))) return current;
    if (await isDirectory(path.join(current, ".git"))) return featureRoot;
    const parent = path.dirname(current);
    if (parent === current) return featureRoot;
    current = parent;
  }
}

async function loadSupportedAliases(applicationRoot: string): Promise<Record<string, string>> {
  const aliases = new Map<string, string>();
  for (const configName of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(applicationRoot, configName);
    if (!(await isRegularFile(configPath))) continue;
    let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    try {
      parsed = JSON.parse(
        jsonConfigurationText(await readFile(configPath, "utf8")),
      ) as typeof parsed;
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
  const vueConfig = path.join(applicationRoot, "vue.config.js");
  if (await isRegularFile(vueConfig)) {
    const content = await readFile(vueConfig, "utf8");
    const expression =
      /["']([^"']+)["']\s*:\s*path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*["']([^"']+)["']/gu;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(content)) !== null) {
      aliases.set(match[1]!, path.resolve(applicationRoot, match[2]!));
    }
  }
  return Object.fromEntries([...aliases].sort(([left], [right]) => left.localeCompare(right)));
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

async function collectOwnedSourceFiles(
  root: string,
  limits: LegacySourceGraphLimits,
  startedAt: number,
): Promise<string[]> {
  const result: string[] = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > limits.maxDepth || Date.now() - startedAt >= limits.maxElapsedMs) break;
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
        result.push(await realpath(absolutePath));
      }
    }
  }
  return result.sort();
}

function discoverModuleSpecifiers(content: string, filePath: string): string[] {
  const parsed = parseLegacySource(content, filePath);
  const specifiers = new Set<string>();
  walkLegacyAst(parsed.root, (node) => {
    if (
      ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
    ) {
      const source = node["source"];
      if (
        isLegacyAstNode(source) &&
        source.type === "StringLiteral" &&
        typeof source["value"] === "string"
      ) {
        specifiers.add(source["value"]);
      }
    } else if (isCallNode(node)) {
      const callee = node["callee"];
      const args = node["arguments"];
      if (
        isLegacyAstNode(callee) &&
        callee.type === "Identifier" &&
        callee["name"] === "require" &&
        Array.isArray(args) &&
        args.length === 1 &&
        isLegacyAstNode(args[0]) &&
        args[0].type === "StringLiteral" &&
        typeof args[0]["value"] === "string"
      ) {
        specifiers.add(args[0]["value"]);
      }
    }
  });
  return [...specifiers].sort();
}

function discoverEnvironmentReferences(
  content: string,
  filePath: string,
): Array<{ runtime: LegacyEnvironmentReference["runtime"]; name: string }> {
  const parsed = parseLegacySource(content, filePath);
  const result = new Map<
    string,
    { runtime: LegacyEnvironmentReference["runtime"]; name: string }
  >();
  walkLegacyAst(parsed.root, (node) => {
    const processName = processEnvironmentName(node);
    if (processName !== undefined) {
      result.set(`process.env:${processName}`, { runtime: "process.env", name: processName });
    }
    const importMetaName = importMetaEnvironmentName(node);
    if (importMetaName !== undefined) {
      result.set(`import.meta.env:${importMetaName}`, {
        runtime: "import.meta.env",
        name: importMetaName,
      });
    }
  });
  return [...result.values()];
}

function processEnvironmentName(node: LegacyAstNode): string | undefined {
  const name = legacyMemberProperty(node);
  const env = legacyMemberObject(node);
  if (name === undefined || env === undefined || legacyMemberProperty(env) !== "env")
    return undefined;
  const root = legacyMemberObject(env);
  return root?.type === "Identifier" && root["name"] === "process" ? name : undefined;
}

function importMetaEnvironmentName(node: LegacyAstNode): string | undefined {
  const name = legacyMemberProperty(node);
  const env = legacyMemberObject(node);
  if (name === undefined || env === undefined || legacyMemberProperty(env) !== "env")
    return undefined;
  const meta = legacyMemberObject(env);
  return meta?.type === "MetaProperty" &&
    legacyPropertyName(meta["meta"] as LegacyAstNode | undefined) === "import"
    ? name
    : undefined;
}

function isCallNode(node: LegacyAstNode): boolean {
  return node.type === "CallExpression" || node.type === "OptionalCallExpression";
}

async function resolveGraphDependency(input: {
  importer: string;
  specifier: string;
  applicationRoot: string;
  aliases: Record<string, string>;
}): Promise<{ absolutePath: string; resolver: LegacyDependencyEdge["resolver"] } | undefined> {
  let candidate: string;
  let resolver: LegacyDependencyEdge["resolver"];
  if (input.specifier.startsWith(".")) {
    candidate = path.resolve(path.dirname(input.importer), input.specifier);
    resolver = dependencyKind(input.specifier, "relative-import");
  } else {
    const alias = Object.keys(input.aliases)
      .sort((left, right) => right.length - left.length)
      .find((prefix) => input.specifier === prefix || input.specifier.startsWith(`${prefix}/`));
    if (alias === undefined) return undefined;
    const suffix = input.specifier.slice(alias.length).replace(/^\/+/, "");
    candidate = path.resolve(input.aliases[alias]!, suffix);
    resolver = dependencyKind(input.specifier, "alias");
  }
  const resolved = await resolveSourceFile(candidate);
  if (resolved === undefined || !isWithin(input.applicationRoot, resolved)) return undefined;
  return { absolutePath: resolved, resolver };
}

async function resolveSourceFile(candidate: string): Promise<string | undefined> {
  for (const suffix of RESOLUTION_EXTENSIONS) {
    const attempted = `${candidate}${suffix}`;
    if (await isRegularFile(attempted)) return realpath(attempted);
  }
  return undefined;
}

function dependencyKind(
  specifier: string,
  fallback: "relative-import" | "alias",
): LegacyDependencyEdge["resolver"] {
  if (/\.(?:css|scss|sass|less)$/i.test(specifier)) return "style";
  if (/\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|otf)$/i.test(specifier)) return "asset";
  return fallback;
}

async function enrichEnvironmentReferences(
  references: Array<{
    key: string;
    runtime: LegacyEnvironmentReference["runtime"];
    name: string;
    sourcePaths: string[];
  }>,
  applicationRoot: string,
): Promise<LegacyEnvironmentReference[]> {
  const envFiles: string[] = [];
  const directory = await opendir(applicationRoot);
  for await (const entry of directory) {
    if (entry.isFile() && /^\.env(?:\..+)?$/u.test(entry.name)) {
      envFiles.push(path.join(applicationRoot, entry.name));
    }
  }
  envFiles.sort();
  const contents = await Promise.all(
    envFiles.map(async (envFile) => ({
      sourceName: path.basename(envFile),
      text: await readFile(envFile, "utf8"),
    })),
  );
  return references
    .map((reference) => {
      const origins = new Set<string>();
      const sanitizedOrigins: Array<{ sourceName: string; origin: string }> = [];
      if (isSafeUrlEnvironmentName(reference.name)) {
        for (const content of contents) {
          const value = environmentValue(content.text, reference.name);
          const origin = value === undefined ? undefined : sanitizedHttpOrigin(value);
          if (origin !== undefined) {
            origins.add(origin);
            sanitizedOrigins.push({ sourceName: content.sourceName, origin });
          }
        }
      }
      const sanitizedOrigin = origins.size === 1 ? [...origins][0] : undefined;
      return {
        runtime: reference.runtime,
        name: reference.name,
        sourcePaths: reference.sourcePaths,
        ...(sanitizedOrigin === undefined ? {} : { sanitizedOrigin }),
        ...(sanitizedOrigins.length === 0 ? {} : { sanitizedOrigins }),
      };
    })
    .sort((left, right) =>
      `${left.runtime}:${left.name}`.localeCompare(`${right.runtime}:${right.name}`),
    );
}

function environmentValue(content: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*?)\\s*$`, "mu").exec(content);
  if (match === null) return undefined;
  const value = match[1]!.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isSafeUrlEnvironmentName(name: string): boolean {
  return (
    !/(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|TOKEN)(?:_|$)/iu.test(name) &&
    /(?:^|_)(?:API|BASE|ENDPOINT|GATEWAY|GW|HOST|ORIGIN|URI|URL)(?:_|$)/iu.test(name)
  );
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

function publicGraphPath(
  absolutePath: string,
  featureRoot: string,
  applicationRoot: string,
): string {
  if (isWithin(featureRoot, absolutePath)) {
    return path.relative(featureRoot, absolutePath).split(path.sep).join("/");
  }
  return `@app/${path.relative(applicationRoot, absolutePath).split(path.sep).join("/")}`;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    return (await lstat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await lstat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
