import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

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
    const parsed = ts.parseConfigFileTextToJson(configPath, await readFile(configPath, "utf8"));
    if (parsed.error !== undefined || parsed.config === undefined) continue;
    const compilerOptions = parsed.config.compilerOptions as
      { baseUrl?: string; paths?: Record<string, string[]> } | undefined;
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
  const sourceFile = sourceFileFor(content, filePath);
  const specifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      specifiers.add(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers].sort();
}

function discoverEnvironmentReferences(
  content: string,
  filePath: string,
): Array<{ runtime: LegacyEnvironmentReference["runtime"]; name: string }> {
  const sourceFile = sourceFileFor(content, filePath);
  const result = new Map<
    string,
    { runtime: LegacyEnvironmentReference["runtime"]; name: string }
  >();
  const visit = (node: ts.Node): void => {
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
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...result.values()];
}

function processEnvironmentName(node: ts.Node): string | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const env = node.expression;
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== "env") return undefined;
  return ts.isIdentifier(env.expression) && env.expression.text === "process"
    ? node.name.text
    : undefined;
}

function importMetaEnvironmentName(node: ts.Node): string | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const env = node.expression;
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== "env") return undefined;
  const meta = env.expression;
  return ts.isMetaProperty(meta) && meta.keywordToken === ts.SyntaxKind.ImportKeyword
    ? node.name.text
    : undefined;
}

function sourceFileFor(content: string, filePath: string): ts.SourceFile {
  const script = /\.(?:vue|svelte)$/i.test(filePath)
    ? [...content.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
        .map((match) => match[1] ?? "")
        .join("\n")
    : content;
  const kind = /\.tsx$/i.test(filePath)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(filePath)
      ? ts.ScriptKind.JSX
      : /\.tsx?$/i.test(filePath)
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  return ts.createSourceFile(filePath, script, ts.ScriptTarget.Latest, true, kind);
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
