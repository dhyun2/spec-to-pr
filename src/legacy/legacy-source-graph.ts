import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  type LegacyAstNode,
  isLegacyAstNode,
  legacyAstNode as astNode,
  legacyExportedSelection,
  legacyIdentifierName as identifierName,
  legacyLocalSelection,
  legacyMemberObject,
  legacyMemberProperty,
  legacyProgramBody as programBody,
  legacyPropertyName,
  legacyStringLiteralValue as stringLiteralValue,
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

export const LEGACY_SOURCE_DIGEST_ALGORITHM_V1 = "legacy-source-graph-v1" as const;
export const LEGACY_SOURCE_DIGEST_ALGORITHM_V2 = "selected-exports-v2" as const;
export type LegacySourceDigestAlgorithm =
  typeof LEGACY_SOURCE_DIGEST_ALGORITHM_V1 | typeof LEGACY_SOURCE_DIGEST_ALGORITHM_V2;

export type LegacySourceGraphOptions = {
  digestAlgorithm?: LegacySourceDigestAlgorithm;
};

const DEFAULT_LIMITS: LegacySourceGraphLimits = {
  maxFiles: 1_000,
  maxBytes: 20 * 1024 * 1024,
  maxDepth: 32,
  maxElapsedMs: 5_000,
};
const MAX_ENVIRONMENT_EVIDENCE_FILES = 100;

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
  digestAlgorithm: LegacySourceDigestAlgorithm;
  sourceDigest: `sha256:${string}`;
  truncated: boolean;
  truncation?: { limit: string; sourcePath: string };
};

type SourceReadBudget = {
  limits: LegacySourceGraphLimits;
  startedAt: number;
  files: Map<string, { content: string }>;
  scannedBytes: number;
  truncation?: { limit: keyof LegacySourceGraphLimits; absolutePath: string };
};

type ExportInspection = {
  readBudget: SourceReadBudget;
  parsedFiles: Map<string, ReturnType<typeof parseLegacySource>>;
  results: Map<string, boolean>;
};

export async function discoverLegacySourceGraph(
  featureRoot: string,
  limitOverrides: Partial<LegacySourceGraphLimits> = {},
  options: LegacySourceGraphOptions = {},
): Promise<LegacySourceGraph> {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const digestAlgorithm = options.digestAlgorithm ?? LEGACY_SOURCE_DIGEST_ALGORITHM_V2;
  const startedAt = Date.now();
  const canonicalFeatureRoot = await realpath(featureRoot);
  const applicationRoot = await findEnclosingApplicationRoot(canonicalFeatureRoot);
  const aliases = await loadSupportedAliases(applicationRoot);
  const ownedPaths = await collectOwnedSourceFiles(canonicalFeatureRoot, limits, startedAt);
  const files = new Map<string, LegacyGraphFile>();
  const edges: LegacyDependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  const environmentSources = new Map<
    string,
    { runtime: LegacyEnvironmentReference["runtime"]; sourcePaths: Set<string> }
  >();
  const readBudget: SourceReadBudget = {
    limits,
    startedAt,
    files: new Map(),
    scannedBytes: 0,
  };
  const exportInspection: ExportInspection = {
    readBudget,
    parsedFiles: new Map(),
    results: new Map(),
  };
  let truncation: LegacySourceGraph["truncation"];

  const pending: Array<{
    absolutePath: string;
    ownership: LegacyGraphFile["ownership"];
    requestedExports?: string[];
  }> = ownedPaths.map((absolutePath) => ({ absolutePath, ownership: "feature" }));
  const fullyExpanded = new Set<string>();
  const expandedExports = new Map<string, Set<string>>();
  traversal: while (pending.length > 0) {
    const next = pending.shift()!;
    let requestedExports: string[] | undefined;
    if (next.requestedExports === undefined) {
      if (fullyExpanded.has(next.absolutePath)) continue;
      fullyExpanded.add(next.absolutePath);
    } else {
      if (fullyExpanded.has(next.absolutePath)) continue;
      const expanded = expandedExports.get(next.absolutePath) ?? new Set<string>();
      requestedExports = [...new Set(next.requestedExports)].filter(
        (selector) => !expanded.has(selector),
      );
      if (requestedExports.length === 0) continue;
      requestedExports.forEach((selector) => expanded.add(selector));
      expandedExports.set(next.absolutePath, expanded);
    }
    if (Date.now() - startedAt >= limits.maxElapsedMs) {
      truncation = {
        limit: "maxElapsedMs",
        sourcePath: publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot),
      };
      break;
    }

    let graphFile = files.get(next.absolutePath);
    if (graphFile === undefined) {
      const source = await readBudgetedSourceFile(next.absolutePath, readBudget);
      if (readBudget.truncation !== undefined) {
        truncation = publicTruncation(readBudget.truncation, canonicalFeatureRoot, applicationRoot);
        break;
      }
      if (source === undefined) continue;
      const content = source.content;
      const sourcePath = publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot);
      graphFile = {
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
    }

    if (!SCRIPT_EXTENSION.test(next.absolutePath)) continue;
    for (const environment of discoverEnvironmentReferences(graphFile.content, next.absolutePath)) {
      const key = `${environment.runtime}:${environment.name}`;
      const existing = environmentSources.get(key) ?? {
        runtime: environment.runtime,
        sourcePaths: new Set<string>(),
      };
      existing.sourcePaths.add(graphFile.sourcePath);
      environmentSources.set(key, existing);
    }
    const references: LegacyModuleReference[] =
      digestAlgorithm === LEGACY_SOURCE_DIGEST_ALGORITHM_V1
        ? discoverModuleSpecifiers(graphFile.content, next.absolutePath).map((specifier) => ({
            specifier,
          }))
        : discoverModuleReferences(graphFile.content, next.absolutePath, requestedExports);
    for (const reference of references) {
      const resolved = await resolveGraphDependency({
        importer: next.absolutePath,
        specifier: reference.specifier,
        applicationRoot,
        aliases,
      });
      if (resolved === undefined) continue;
      if (
        digestAlgorithm === LEGACY_SOURCE_DIGEST_ALGORITHM_V2 &&
        reference.requiredExports !== undefined &&
        !(await sourceDirectlyExports(
          resolved.absolutePath,
          reference.requiredExports,
          exportInspection,
        ))
      ) {
        if (readBudget.truncation !== undefined) {
          truncation = publicTruncation(
            readBudget.truncation,
            canonicalFeatureRoot,
            applicationRoot,
          );
          break traversal;
        }
        continue;
      }
      const resolvedPath = path
        .relative(applicationRoot, resolved.absolutePath)
        .split(path.sep)
        .join("/");
      const edgeKey = `${graphFile.sourcePath}\0${reference.specifier}\0${resolvedPath}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({
          importer: graphFile.sourcePath,
          specifier: reference.specifier,
          resolvedPath,
          resolver: resolved.resolver,
        });
      }
      pending.push({
        absolutePath: resolved.absolutePath,
        ownership: "supporting-dependency",
        ...(reference.requestedExports === undefined
          ? {}
          : { requestedExports: reference.requestedExports }),
      });
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
    readBudget,
  );
  if (truncation === undefined && readBudget.truncation !== undefined) {
    truncation = publicTruncation(readBudget.truncation, canonicalFeatureRoot, applicationRoot);
  }
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
    digestAlgorithm,
    sourceDigest: `sha256:${sourceHash.digest("hex")}`,
    truncated: truncation !== undefined,
    ...(truncation === undefined ? {} : { truncation }),
  };
}

async function readBudgetedSourceFile(
  absolutePath: string,
  budget: SourceReadBudget,
): Promise<{ content: string } | undefined> {
  if (budget.truncation !== undefined) return undefined;
  if (Date.now() - budget.startedAt >= budget.limits.maxElapsedMs) {
    budget.truncation = { limit: "maxElapsedMs", absolutePath };
    return undefined;
  }
  const cached = budget.files.get(absolutePath);
  if (cached !== undefined) return cached;
  let details;
  try {
    details = await lstat(absolutePath);
  } catch {
    return undefined;
  }
  if (!details.isFile() || details.isSymbolicLink()) return undefined;
  if (budget.files.size >= budget.limits.maxFiles) {
    budget.truncation = { limit: "maxFiles", absolutePath };
    return undefined;
  }
  if (budget.scannedBytes + details.size > budget.limits.maxBytes) {
    budget.truncation = { limit: "maxBytes", absolutePath };
    return undefined;
  }
  const content = await readFile(absolutePath, "utf8");
  const byteLength = Buffer.byteLength(content, "utf8");
  if (budget.scannedBytes + byteLength > budget.limits.maxBytes) {
    budget.truncation = { limit: "maxBytes", absolutePath };
    return undefined;
  }
  if (Date.now() - budget.startedAt >= budget.limits.maxElapsedMs) {
    budget.truncation = { limit: "maxElapsedMs", absolutePath };
    return undefined;
  }
  const source = { content };
  budget.files.set(absolutePath, source);
  budget.scannedBytes += byteLength;
  return source;
}

function publicTruncation(
  truncation: NonNullable<SourceReadBudget["truncation"]>,
  featureRoot: string,
  applicationRoot: string,
): NonNullable<LegacySourceGraph["truncation"]> {
  return {
    limit: truncation.limit,
    sourcePath: publicGraphPath(truncation.absolutePath, featureRoot, applicationRoot),
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

type LegacyModuleReference = {
  specifier: string;
  requestedExports?: string[];
  requiredExports?: string[];
};

function discoverModuleSpecifiers(content: string, filePath: string): string[] {
  const parsed = parseLegacySource(content, filePath);
  const specifiers = new Set<string>();
  walkLegacyAst(parsed.root, (node) => {
    if (
      ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
    ) {
      const source = stringLiteralValue(astNode(node["source"]));
      if (source !== undefined) specifiers.add(source);
      return;
    }
    if (!isCallNode(node)) return;
    const callee = astNode(node["callee"]);
    const args = node["arguments"];
    if (
      callee?.type === "Identifier" &&
      callee["name"] === "require" &&
      Array.isArray(args) &&
      args.length === 1
    ) {
      const source = stringLiteralValue(astNode(args[0]));
      if (source !== undefined) specifiers.add(source);
    }
  });
  return [...specifiers].sort();
}

function discoverModuleReferences(
  content: string,
  filePath: string,
  requestedExports?: string[],
): LegacyModuleReference[] {
  const parsed = parseLegacySource(content, filePath);
  const references = new Map<string, Set<string> | undefined>();
  const conditionalExports = new Map<string, Set<string>>();
  const unconditionalReferences = new Set<string>();
  const addReference = (source: string, selectors?: string[], requiredExports?: string[]): void => {
    addModuleReference(references, source, selectors);
    if (requiredExports === undefined) {
      unconditionalReferences.add(source);
      conditionalExports.delete(source);
      return;
    }
    if (unconditionalReferences.has(source)) return;
    const existing = conditionalExports.get(source) ?? new Set<string>();
    requiredExports.forEach((name) => existing.add(name));
    conditionalExports.set(source, existing);
  };
  const relevantNodes = relevantExportNodes(parsed.root, requestedExports);

  for (const statement of programBody(parsed.root)) {
    if (statement.type === "ImportDeclaration") {
      const source = stringLiteralValue(astNode(statement["source"]));
      if (source === undefined) continue;
      const specifiers = Array.isArray(statement["specifiers"])
        ? statement["specifiers"].filter(isLegacyAstNode)
        : [];
      if (specifiers.length === 0) {
        addReference(source);
        continue;
      }
      for (const specifier of specifiers) {
        const local = identifierName(specifier["local"]);
        if (local === undefined) continue;
        const imported =
          specifier.type === "ImportDefaultSpecifier"
            ? "default"
            : specifier.type === "ImportNamespaceSpecifier"
              ? "*"
              : legacyPropertyName(astNode(specifier["imported"]));
        if (imported === undefined) continue;
        const selectors = importedBindingSelectors(relevantNodes, local, imported);
        if (selectors.length > 0) addReference(source, selectors);
      }
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration" && statement.type !== "ExportAllDeclaration") {
      continue;
    }
    const source = stringLiteralValue(astNode(statement["source"]));
    if (source === undefined) continue;
    if (statement.type === "ExportAllDeclaration") {
      addReference(source, requestedExports, requestedExports);
      continue;
    }
    const specifiers = Array.isArray(statement["specifiers"])
      ? statement["specifiers"].filter(isLegacyAstNode)
      : [];
    if (requestedExports === undefined || requestedExports.includes("*")) {
      const selectors = specifiers.flatMap((specifier) => {
        const local = legacyPropertyName(astNode(specifier["local"]));
        return local === undefined ? [] : [local];
      });
      addReference(source, selectors.length === 0 ? undefined : selectors);
      continue;
    }
    const forwarded: string[] = [];
    for (const selector of requestedExports) {
      const [base, ...members] = selector.split(".");
      for (const specifier of specifiers) {
        if (legacyPropertyName(astNode(specifier["exported"])) !== base) continue;
        const local = legacyPropertyName(astNode(specifier["local"]));
        if (local !== undefined) forwarded.push([local, ...members].join("."));
      }
    }
    if (forwarded.length > 0) addReference(source, forwarded);
  }

  for (const relevant of relevantNodes) {
    walkLegacyAst(relevant, (node) => {
      if (!isCallNode(node)) return;
      const callee = astNode(node["callee"]);
      const args = node["arguments"];
      if (
        callee?.type === "Identifier" &&
        callee["name"] === "require" &&
        Array.isArray(args) &&
        args.length === 1
      ) {
        const source = stringLiteralValue(astNode(args[0]));
        if (source !== undefined) addReference(source);
      }
    });
  }

  return [...references.entries()]
    .map(([specifier, selectors]) => ({
      specifier,
      ...(selectors === undefined ? {} : { requestedExports: [...selectors].sort() }),
      ...(conditionalExports.has(specifier)
        ? { requiredExports: [...conditionalExports.get(specifier)!].sort() }
        : {}),
    }))
    .sort((left, right) => left.specifier.localeCompare(right.specifier));
}

function addModuleReference(
  references: Map<string, Set<string> | undefined>,
  source: string,
  selectors?: string[],
): void {
  if (references.has(source) && references.get(source) === undefined) return;
  if (selectors === undefined || selectors.includes("*")) {
    references.set(source, undefined);
    return;
  }
  const existing = references.get(source) ?? new Set<string>();
  selectors.forEach((selector) => existing.add(selector));
  references.set(source, existing);
}

function importedBindingSelectors(
  relevantNodes: LegacyAstNode[],
  local: string,
  imported: string,
): string[] {
  const selectors = new Set<string>();
  for (const relevant of relevantNodes) {
    walkLegacyAst(relevant, (node, parent) => {
      if (node.type !== "Identifier" || node["name"] !== local) return;
      if (
        parent !== undefined &&
        ["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(
          parent.type,
        )
      ) {
        return;
      }
      if (
        parent !== undefined &&
        ["MemberExpression", "OptionalMemberExpression"].includes(parent.type) &&
        astNode(parent["object"]) === node
      ) {
        const property = legacyMemberProperty(parent);
        if (property !== undefined) {
          selectors.add(imported === "*" ? property : `${imported}.${property}`);
          return;
        }
      }
      selectors.add(imported);
    });
  }
  return [...selectors];
}

function relevantExportNodes(root: LegacyAstNode, requestedExports?: string[]): LegacyAstNode[] {
  if (requestedExports === undefined || requestedExports.includes("*")) return [root];
  const result: LegacyAstNode[] = [];
  const seen = new Set<LegacyAstNode>();
  const pending = requestedExports.flatMap((selector) => {
    const selected = legacyExportedSelection(root, selector);
    return selected === undefined ? [] : [selected];
  });
  while (pending.length > 0) {
    const selected = pending.shift()!;
    if (seen.has(selected)) continue;
    seen.add(selected);
    result.push(selected);
    walkLegacyAst(selected, (node) => {
      if (!isCallNode(node)) return;
      const callee = astNode(node["callee"]);
      const localName = callee === undefined ? undefined : identifierName(callee);
      const local = localName === undefined ? undefined : legacyLocalSelection(root, localName);
      if (local !== undefined && !seen.has(local)) pending.push(local);
    });
  }
  return result;
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

async function sourceDirectlyExports(
  absolutePath: string,
  requestedExports: string[],
  inspection: ExportInspection,
  visited = new Set<string>(),
  depth = 0,
): Promise<boolean> {
  if (!SCRIPT_EXTENSION.test(absolutePath)) return true;
  if (visited.has(absolutePath)) return false;
  if (Date.now() - inspection.readBudget.startedAt >= inspection.readBudget.limits.maxElapsedMs) {
    inspection.readBudget.truncation = { limit: "maxElapsedMs", absolutePath };
    return false;
  }
  if (depth > inspection.readBudget.limits.maxDepth) {
    inspection.readBudget.truncation = { limit: "maxDepth", absolutePath };
    return false;
  }
  const requestedNames = [
    ...new Set(requestedExports.map((selector) => selector.split(".")[0]!)),
  ].sort();
  const resultKey = `${absolutePath}\0${requestedNames.join("\0")}`;
  const cached = inspection.results.get(resultKey);
  if (cached !== undefined) return cached;
  visited.add(absolutePath);
  const source = await readBudgetedSourceFile(absolutePath, inspection.readBudget);
  if (source === undefined) return false;
  let parsed = inspection.parsedFiles.get(absolutePath);
  if (parsed === undefined) {
    parsed = parseLegacySource(source.content, absolutePath);
    inspection.parsedFiles.set(absolutePath, parsed);
  }
  if (Date.now() - inspection.readBudget.startedAt >= inspection.readBudget.limits.maxElapsedMs) {
    inspection.readBudget.truncation = { limit: "maxElapsedMs", absolutePath };
    return false;
  }
  const requestedNameSet = new Set(requestedNames);
  const exportAllSources: string[] = [];
  for (const statement of programBody(parsed.root)) {
    if (statement.type === "ExportAllDeclaration") {
      const source = stringLiteralValue(astNode(statement["source"]));
      if (source !== undefined) exportAllSources.push(source);
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration" && requestedNameSet.has("default")) {
      inspection.results.set(resultKey, true);
      return true;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = astNode(statement["declaration"]);
    if (declaration !== undefined) {
      const names =
        declaration.type === "VariableDeclaration" && Array.isArray(declaration["declarations"])
          ? declaration["declarations"].flatMap((item) => {
              const name = isLegacyAstNode(item) ? identifierName(item["id"]) : undefined;
              return name === undefined ? [] : [name];
            })
          : [identifierName(declaration["id"])].filter(
              (name): name is string => name !== undefined,
            );
      if (names.some((name) => requestedNameSet.has(name))) {
        inspection.results.set(resultKey, true);
        return true;
      }
    }
    if (!Array.isArray(statement["specifiers"])) continue;
    if (
      statement["specifiers"].some(
        (specifier) =>
          isLegacyAstNode(specifier) &&
          requestedNameSet.has(legacyPropertyName(astNode(specifier["exported"])) ?? ""),
      )
    ) {
      inspection.results.set(resultKey, true);
      return true;
    }
  }
  const namedRequests = requestedExports.filter((selector) => !selector.startsWith("default"));
  if (namedRequests.length === 0) {
    inspection.results.set(resultKey, false);
    return false;
  }
  for (const source of exportAllSources) {
    if (!source.startsWith(".")) {
      inspection.results.set(resultKey, true);
      return true;
    }
    const target = await resolveSourceFile(path.resolve(path.dirname(absolutePath), source));
    if (
      target !== undefined &&
      (await sourceDirectlyExports(target, namedRequests, inspection, new Set(visited), depth + 1))
    ) {
      inspection.results.set(resultKey, true);
      return true;
    }
    if (inspection.readBudget.truncation !== undefined) return false;
  }
  inspection.results.set(resultKey, false);
  return false;
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
  readBudget: SourceReadBudget,
): Promise<LegacyEnvironmentReference[]> {
  if (references.length === 0 || readBudget.truncation !== undefined) {
    return references
      .map((reference) => ({
        runtime: reference.runtime,
        name: reference.name,
        sourcePaths: reference.sourcePaths,
      }))
      .sort((left, right) =>
        `${left.runtime}:${left.name}`.localeCompare(`${right.runtime}:${right.name}`),
      );
  }
  const envFiles: string[] = [];
  let envFileCount = 0;
  const directory = await opendir(applicationRoot);
  for await (const entry of directory) {
    if (Date.now() - readBudget.startedAt >= readBudget.limits.maxElapsedMs) {
      readBudget.truncation = {
        limit: "maxElapsedMs",
        absolutePath: path.join(applicationRoot, entry.name),
      };
      break;
    }
    if (entry.isFile() && /^\.env(?:\..+)?$/u.test(entry.name)) {
      envFileCount += 1;
      envFiles.push(path.join(applicationRoot, entry.name));
      envFiles.sort();
      if (envFiles.length > MAX_ENVIRONMENT_EVIDENCE_FILES + 1) {
        envFiles.pop();
      }
    }
  }
  const contents: Array<{ sourceName: string; text: string }> = [];
  if (readBudget.truncation === undefined) {
    for (const envFile of envFiles.slice(0, MAX_ENVIRONMENT_EVIDENCE_FILES)) {
      const source = await readBudgetedSourceFile(envFile, readBudget);
      if (source === undefined) break;
      contents.push({ sourceName: path.basename(envFile), text: source.content });
    }
  }
  if (readBudget.truncation === undefined && envFileCount > MAX_ENVIRONMENT_EVIDENCE_FILES) {
    readBudget.truncation = {
      limit: "maxFiles",
      absolutePath: envFiles[MAX_ENVIRONMENT_EVIDENCE_FILES] ?? path.join(applicationRoot, ".env"),
    };
  }
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
