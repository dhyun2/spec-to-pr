import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  LegacySourceCache,
  createLegacySourceManifest,
  findLegacyApplicationRoot,
  isSafeLegacyUrlEnvironmentName,
  legacyEnvironmentReferencesDigest,
  legacyEnvironmentValue,
  legacyManifestConfigDigest,
  legacyManifestFile,
  legacyResolutionStateDigest,
  loadLegacyResolutionConfig,
  readLegacyBoundedDigestInput,
  sanitizedLegacyHttpOrigin,
  type LegacyResolutionDecision,
  type LegacySourceEnvironmentReference,
  type LegacySourceManifest,
  type LegacySourceRecord,
} from "./legacy-source-cache.js";
import {
  type LegacyAstNode,
  type ParsedLegacySource,
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
  maxDirectories: number;
  maxEntries: number;
};

export const LEGACY_SOURCE_DIGEST_ALGORITHM_V1 = "legacy-source-graph-v1" as const;
export const LEGACY_SOURCE_DIGEST_ALGORITHM_V2 = "selected-exports-v2" as const;
export type LegacySourceDigestAlgorithm =
  typeof LEGACY_SOURCE_DIGEST_ALGORITHM_V1 | typeof LEGACY_SOURCE_DIGEST_ALGORITHM_V2;

export type LegacySourceGraphOptions = {
  digestAlgorithm?: LegacySourceDigestAlgorithm;
  sourceCache?: LegacySourceCache;
};

const DEFAULT_LIMITS: LegacySourceGraphLimits = {
  maxFiles: 1_000,
  maxBytes: 20 * 1024 * 1024,
  maxDepth: 32,
  maxElapsedMs: 5_000,
  maxDirectories: 2_000,
  maxEntries: 20_000,
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

export type LegacyEnvironmentReference = LegacySourceEnvironmentReference;

export type LegacySourceGraph = {
  featureRoot: string;
  applicationRoot: string;
  files: LegacyGraphFile[];
  ownedFiles: LegacyGraphFile[];
  supportingFiles: LegacyGraphFile[];
  edges: LegacyDependencyEdge[];
  resolutionDecisions: LegacyResolutionDecision[];
  aliases: Record<string, string>;
  environmentRefs: LegacyEnvironmentReference[];
  digestAlgorithm: LegacySourceDigestAlgorithm;
  sourceDigest: `sha256:${string}`;
  sourceManifest: LegacySourceManifest;
  sourceCache: LegacySourceCache;
  visitedDirectories: number;
  visitedEntries: number;
  truncated: boolean;
  truncation?: { limit: string; sourcePath: string };
};

type SourceReadBudget = {
  limits: LegacySourceGraphLimits;
  startedAt: number;
  files: Map<string, LegacySourceRecord>;
  sourceCache: LegacySourceCache;
  scannedBytes: number;
  truncation?: { limit: keyof LegacySourceGraphLimits; absolutePath: string };
};

type ExportInspection = {
  readBudget: SourceReadBudget;
  results: Map<string, boolean>;
};

export async function discoverLegacySourceGraph(
  featureRoot: string,
  limitOverrides: Partial<LegacySourceGraphLimits> = {},
  options: LegacySourceGraphOptions = {},
): Promise<LegacySourceGraph> {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const digestAlgorithm = options.digestAlgorithm ?? LEGACY_SOURCE_DIGEST_ALGORITHM_V2;
  const sourceCache = options.sourceCache ?? new LegacySourceCache();
  const startedAt = Date.now();
  const canonicalFeatureRoot = await realpath(featureRoot);
  const applicationRoot = await findLegacyApplicationRoot(canonicalFeatureRoot);
  const resolutionConfig = await loadLegacyResolutionConfig(applicationRoot, sourceCache);
  const aliases = resolutionConfig.aliases;
  const owned = await collectOwnedSourceFiles(canonicalFeatureRoot, limits, startedAt);
  const files = new Map<string, LegacyGraphFile>();
  const edges: LegacyDependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  const resolutionDecisions = new Map<string, LegacyResolutionDecision>();
  const environmentSources = new Map<
    string,
    { runtime: LegacyEnvironmentReference["runtime"]; sourcePaths: Set<string> }
  >();
  const readBudget: SourceReadBudget = {
    limits,
    startedAt,
    files: new Map(),
    sourceCache,
    scannedBytes: 0,
  };
  const exportInspection: ExportInspection = {
    readBudget,
    results: new Map(),
  };
  let truncation: LegacySourceGraph["truncation"] =
    owned.truncation === undefined
      ? undefined
      : {
          limit: owned.truncation.limit,
          sourcePath: publicGraphPath(
            owned.truncation.sourcePath,
            canonicalFeatureRoot,
            applicationRoot,
          ),
        };

  const pending: Array<{
    absolutePath: string;
    ownership: LegacyGraphFile["ownership"];
    requestedExports?: string[];
  }> = owned.paths.map((absolutePath) => ({ absolutePath, ownership: "feature" }));
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
      const content = source.text();
      const sourcePath = publicGraphPath(next.absolutePath, canonicalFeatureRoot, applicationRoot);
      const discoveredFile: LegacyGraphFile = {
        absolutePath: next.absolutePath,
        sourcePath,
        applicationRelativePath: path
          .relative(applicationRoot, next.absolutePath)
          .split(path.sep)
          .join("/"),
        content,
        digest: source.digest,
        ownership: next.ownership,
      };
      graphFile = discoveredFile;
      files.set(next.absolutePath, discoveredFile);
    }
    if (graphFile === undefined) continue;

    if (!SCRIPT_EXTENSION.test(next.absolutePath)) continue;
    const parsed = sourceCache.record(graphFile.absolutePath, graphFile.digest)?.parsed();
    if (parsed === undefined) continue;
    for (const environment of discoverEnvironmentReferences(parsed)) {
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
        ? discoverModuleSpecifiers(parsed).map((specifier) => ({
            specifier,
          }))
        : discoverModuleReferences(parsed, requestedExports);
    for (const reference of references) {
      const resolved = await resolveGraphDependency({
        importer: next.absolutePath,
        specifier: reference.specifier,
        applicationRoot,
        aliases,
      });
      const decisionKey = `${graphFile.sourcePath}\0${reference.specifier}`;
      if (!resolutionDecisions.has(decisionKey)) {
        resolutionDecisions.set(decisionKey, {
          importer: graphFile.sourcePath,
          specifier: reference.specifier,
          resolvedPath:
            resolved === undefined
              ? "@missing"
              : path.relative(applicationRoot, resolved.absolutePath).split(path.sep).join("/"),
        });
      }
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
  const sortedResolutionDecisions = [...resolutionDecisions.values()].sort((left, right) =>
    `${left.importer}\0${left.specifier}`.localeCompare(`${right.importer}\0${right.specifier}`),
  );
  const resolutionStateDigest = await legacyResolutionStateDigest({
    featureRoot: canonicalFeatureRoot,
    applicationRoot,
    aliases,
    decisions: sortedResolutionDecisions,
  });
  const sourceManifest = createLegacySourceManifest({
    files: allFiles.flatMap((file) => {
      const record = sourceCache.record(file.absolutePath, file.digest);
      return record === undefined ? [] : [legacyManifestFile(record, file.applicationRelativePath)];
    }),
    environmentDigest: legacyEnvironmentReferencesDigest(environmentRefs),
    configDigest: legacyManifestConfigDigest(resolutionConfig.digest, resolutionStateDigest),
  });
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
    resolutionDecisions: sortedResolutionDecisions,
    aliases,
    environmentRefs,
    digestAlgorithm,
    sourceDigest: `sha256:${sourceHash.digest("hex")}`,
    sourceManifest,
    sourceCache,
    visitedDirectories: owned.visitedDirectories,
    visitedEntries: owned.visitedEntries,
    truncated: truncation !== undefined,
    ...(truncation === undefined ? {} : { truncation }),
  };
}

async function readBudgetedSourceFile(
  absolutePath: string,
  budget: SourceReadBudget,
  options: { boundedDigestInput?: boolean } = {},
): Promise<LegacySourceRecord | undefined> {
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
  const source =
    options.boundedDigestInput === true
      ? await readLegacyBoundedDigestInput(absolutePath, budget.sourceCache)
      : await budget.sourceCache.read(absolutePath);
  if (source === undefined) return undefined;
  const byteLength = source.byteLength;
  if (budget.scannedBytes + byteLength > budget.limits.maxBytes) {
    budget.truncation = { limit: "maxBytes", absolutePath };
    return undefined;
  }
  if (Date.now() - budget.startedAt >= budget.limits.maxElapsedMs) {
    budget.truncation = { limit: "maxElapsedMs", absolutePath };
    return undefined;
  }
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

async function collectOwnedSourceFiles(
  root: string,
  limits: LegacySourceGraphLimits,
  startedAt: number,
): Promise<{
  paths: string[];
  visitedDirectories: number;
  visitedEntries: number;
  truncation?: { limit: string; sourcePath: string };
}> {
  const result: string[] = [];
  const pending = [{ directory: root, depth: 0 }];
  let visitedDirectories = 0;
  let visitedEntries = 0;
  let truncation: { limit: string; sourcePath: string } | undefined;
  while (pending.length > 0) {
    const current = pending.pop()!;
    visitedDirectories += 1;
    if (visitedDirectories > limits.maxDirectories) {
      truncation = { limit: "maxDirectories", sourcePath: current.directory };
      break;
    }
    if (current.depth > limits.maxDepth) {
      truncation = { limit: "maxDepth", sourcePath: current.directory };
      break;
    }
    if (Date.now() - startedAt >= limits.maxElapsedMs) {
      truncation = { limit: "maxElapsedMs", sourcePath: current.directory };
      break;
    }
    const directory = await opendir(current.directory);
    const entries = [];
    for await (const entry of directory) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > limits.maxEntries) {
        truncation = { limit: "maxEntries", sourcePath: path.join(current.directory, entry.name) };
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        pending.push({ directory: absolutePath, depth: current.depth + 1 });
      } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
        result.push(await realpath(absolutePath));
      }
    }
    if (truncation !== undefined) break;
  }
  return {
    paths: result.sort(),
    visitedDirectories,
    visitedEntries,
    ...(truncation === undefined ? {} : { truncation }),
  };
}

type LegacyModuleReference = {
  specifier: string;
  requestedExports?: string[];
  requiredExports?: string[];
};

function discoverModuleSpecifiers(parsed: ParsedLegacySource): string[] {
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
  parsed: ParsedLegacySource,
  requestedExports?: string[],
): LegacyModuleReference[] {
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
  parsed: ParsedLegacySource,
): Array<{ runtime: LegacyEnvironmentReference["runtime"]; name: string }> {
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
  const parsed = source.parsed();
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
      const source = await readBudgetedSourceFile(envFile, readBudget, {
        boundedDigestInput: true,
      });
      if (source === undefined) continue;
      contents.push({ sourceName: path.basename(envFile), text: source.text() });
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
      if (isSafeLegacyUrlEnvironmentName(reference.name)) {
        for (const content of contents) {
          const value = legacyEnvironmentValue(content.text, reference.name);
          const origin = value === undefined ? undefined : sanitizedLegacyHttpOrigin(value);
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
