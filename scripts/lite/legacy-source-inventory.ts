import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|s[ac]ss|less)$/iu;
const STYLE_FILE = /\.(?:css|s[ac]ss|less)$/iu;
const LOCAL_IMPORT_EXTENSION = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".scss",
  ".sass",
  ".css",
  ".less",
  ".html",
] as const;
const ASSET_IMPORT = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot)(?:[?#].*)?$/iu;
const ROUTE_ASSET = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|woff2?|ttf)(?:[?#].*)?$/iu;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/iu;

export type LegacySourceInventory = {
  schemaVersion: 1;
  legacyProjectRoot: string;
  sourcePaths: string[];
  routes: SourceRoute[];
  assets: SourceAsset[];
  selectors: SourceSelector[];
  breakpoints: SourceBreakpoint[];
  runtimeDependencies: SourceRuntimeDependency[];
  /** Files outside sourcePaths are evidence dependencies, not an expanded migration scope. */
  supportingDependencies: SourceSupportingDependency[];
  /** Non-fatal discovery failures that must be surfaced as migration Gaps. */
  warnings: SourceInventoryWarning[];
};

export type SourceRoute = {
  id: string;
  sourceFile: string;
  route: string;
  scope: "migration" | "supporting";
  kind: "declaration" | "navigation";
};

export type SourceAsset = {
  id: string;
  sourceFile: string;
  reference: string;
  kind: "css-url" | "image-src" | "asset-import";
};

export type SourceSelector = {
  id: string;
  sourceFile: string;
  selector: string;
};

export type SourceBreakpoint = {
  id: string;
  sourceFile: string;
  query: string;
};

export type SourceRuntimeDependency = {
  id: string;
  sourceFile: string;
  marker: string;
  kind: "map-sdk" | "carousel" | "native-bridge";
};

export type SourceSupportingDependency = {
  id: string;
  sourceFile: string;
  importedBy: string[];
  specifiers: string[];
};

export type SourceInventoryWarning = {
  id: string;
  sourceFile: string;
  code: "dynamic-import-unresolved" | "local-import-unresolved" | "dependency-limit";
  message: string;
  specifier?: string;
};

export type LegacySourceInventoryOptions = {
  legacyProjectRoot: string;
  sourcePaths: string[];
  maxSupportingFiles?: number;
};

/**
 * Read-only heuristic inventory for a bounded legacy feature. It intentionally records
 * evidence rather than guessing replacements: every discovered route, asset, selector,
 * breakpoint, and runtime marker must be mapped by the migration manifest or exposed as a Gap.
 */
export async function collectLegacySourceInventory(
  options: LegacySourceInventoryOptions,
): Promise<LegacySourceInventory> {
  if (!path.isAbsolute(options.legacyProjectRoot)) {
    throw new Error("LEGACY_SOURCE_INVENTORY_INVALID: legacyProjectRoot must be absolute");
  }
  if (
    options.sourcePaths.length === 0 ||
    options.sourcePaths.some((value) => !isSafeRelativePath(value))
  ) {
    throw new Error(
      "LEGACY_SOURCE_INVENTORY_INVALID: sourcePaths must contain safe legacy-relative paths",
    );
  }
  if (
    options.maxSupportingFiles !== undefined &&
    (!Number.isInteger(options.maxSupportingFiles) || options.maxSupportingFiles < 1)
  ) {
    throw new Error(
      "LEGACY_SOURCE_INVENTORY_INVALID: maxSupportingFiles must be a positive integer",
    );
  }

  const scopedFiles = (
    await Promise.all(
      options.sourcePaths.map(async (sourcePath) =>
        listTextFiles(resolveWithin(options.legacyProjectRoot, sourcePath)),
      ),
    )
  )
    .flat()
    .sort();
  const scopedFileSet = new Set(scopedFiles);
  const maxSupportingFiles = options.maxSupportingFiles ?? 500;
  const dependencyEvidence = new Map<
    string,
    { importedBy: Set<string>; specifiers: Set<string> }
  >();
  const warnings: Omit<SourceInventoryWarning, "id">[] = [];
  const files: string[] = [];
  const queued = new Set(scopedFiles);
  const queue = [...scopedFiles];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) break;
    files.push(file);
    const contents = await readFile(file, "utf8");
    const sourceFile = relativePath(options.legacyProjectRoot, file);
    const imports = extractImports(contents);

    for (const unresolved of imports.unresolvedDynamic) {
      warnings.push({
        sourceFile,
        code: "dynamic-import-unresolved",
        message: `동적 import 경로를 정적으로 확인할 수 없습니다: ${unresolved}`,
      });
    }

    for (const reference of imports.references) {
      if (!isLocalImport(reference.specifier) || ASSET_IMPORT.test(reference.specifier)) continue;
      const resolved = await resolveLocalImport(
        options.legacyProjectRoot,
        file,
        reference.specifier,
      );
      if (resolved === undefined) {
        warnings.push({
          sourceFile,
          code: "local-import-unresolved",
          specifier: reference.specifier,
          message: `로컬 import를 찾을 수 없습니다: ${reference.specifier}`,
        });
        continue;
      }
      if (
        !scopedFileSet.has(resolved) &&
        !dependencyEvidence.has(resolved) &&
        dependencyEvidence.size >= maxSupportingFiles
      ) {
        warnings.push({
          sourceFile,
          code: "dependency-limit",
          specifier: reference.specifier,
          message: `supporting dependency ${maxSupportingFiles}개 한도를 넘어 추적하지 않았습니다: ${reference.specifier}`,
        });
        continue;
      }
      if (!scopedFileSet.has(resolved)) {
        const evidence = dependencyEvidence.get(resolved) ?? {
          importedBy: new Set<string>(),
          specifiers: new Set<string>(),
        };
        evidence.importedBy.add(sourceFile);
        evidence.specifiers.add(reference.specifier);
        dependencyEvidence.set(resolved, evidence);
      }
      if (!queued.has(resolved)) {
        queued.add(resolved);
        queue.push(resolved);
      }
    }
  }

  files.sort();
  const routes: Omit<SourceRoute, "id">[] = [];
  const assets: Omit<SourceAsset, "id">[] = [];
  const selectors: Omit<SourceSelector, "id">[] = [];
  const breakpoints: Omit<SourceBreakpoint, "id">[] = [];
  const runtimeDependencies: Omit<SourceRuntimeDependency, "id">[] = [];

  for (const file of files) {
    const sourceFile = relativePath(options.legacyProjectRoot, file);
    const contents = await readFile(file, "utf8");
    for (const route of extractRoutes(contents)) {
      routes.push({
        sourceFile,
        ...route,
        scope: scopedFileSet.has(file) ? "migration" : "supporting",
      });
    }
    for (const asset of extractAssets(contents)) assets.push({ sourceFile, ...asset });
    // Supporting imports help us discover shared runtime and asset dependencies, but they are
    // not part of the user-bounded CSS migration contract. Pulling a global _base.scss into the
    // selector matrix can otherwise turn one page migration into thousands of unrelated rows.
    if (STYLE_FILE.test(file) && scopedFileSet.has(file)) {
      for (const selector of extractSelectors(contents)) selectors.push({ sourceFile, selector });
      for (const query of extractBreakpoints(contents)) breakpoints.push({ sourceFile, query });
    }
    for (const dependency of extractRuntimeDependencies(
      contents,
      extractImports(contents).references,
    )) {
      runtimeDependencies.push({ sourceFile, ...dependency });
    }
  }

  const supportingDependencies = [...dependencyEvidence.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, evidence], index) => ({
      id: `support-${String(index + 1).padStart(3, "0")}`,
      sourceFile: relativePath(options.legacyProjectRoot, file),
      importedBy: [...evidence.importedBy].sort(),
      specifiers: [...evidence.specifiers].sort(),
    }));

  return {
    schemaVersion: 1,
    legacyProjectRoot: options.legacyProjectRoot,
    sourcePaths: options.sourcePaths,
    routes: withIds(
      "route",
      uniqueBy(routes, (item) => `${item.sourceFile}\u0000${item.route}\u0000${item.kind}`),
    ),
    assets: withIds(
      "asset",
      uniqueBy(assets, (item) => `${item.sourceFile}\u0000${item.reference}\u0000${item.kind}`),
    ),
    selectors: withIds(
      "selector",
      uniqueBy(selectors, (item) => `${item.sourceFile}\u0000${item.selector}`),
    ),
    breakpoints: withIds(
      "breakpoint",
      uniqueBy(breakpoints, (item) => `${item.sourceFile}\u0000${item.query}`),
    ),
    runtimeDependencies: withIds(
      "runtime",
      uniqueBy(runtimeDependencies, (item) => `${item.sourceFile}\u0000${item.marker}`),
    ),
    supportingDependencies,
    warnings: withIds(
      "warning",
      uniqueBy(
        warnings,
        (item) => `${item.sourceFile}\u0000${item.code}\u0000${item.specifier ?? item.message}`,
      ),
    ),
  };
}

function extractRoutes(
  contents: string,
): Array<{ route: string; kind: "declaration" | "navigation" }> {
  const routes = new Map<string, { route: string; kind: "declaration" | "navigation" }>();
  const addRoute = (value: string | undefined, kind: "declaration" | "navigation"): void => {
    const route = normalizeRoute(value);
    if (route !== undefined) routes.set(`${kind}\u0000${route}`, { route, kind });
  };

  for (const match of contents.matchAll(/\bpath\s*:\s*(["'`])([^"'`]+)\1/gu)) {
    addRoute(match[2], "declaration");
  }
  for (const pattern of [
    /\b(?:this\.)?\$?router\.(?:push|replace)\(\s*(["'`])([^"'`]+)\1/gu,
    /\b(?:window\.)?location\.(?:assign|replace)\(\s*(["'`])([^"'`]+)\1/gu,
    /\b(?:[\w$]+\.)*viewOpen\(\s*(["'`])([^"'`]+)\1/gu,
    /\b(?:window\.)?location\.href\s*=\s*(["'`])([^"'`]+)\1/gu,
  ]) {
    for (const match of contents.matchAll(pattern)) addRoute(match[2], "navigation");
  }
  // Template expressions may contain quoted bracket access (for example item['id']).
  for (const match of contents.matchAll(/\bpath\s*:\s*`([^`]+)`/gu)) {
    addRoute(match[1], "declaration");
  }
  for (const pattern of [
    /\b(?:this\.)?\$?router\.(?:push|replace)\(\s*`([^`]+)`/gu,
    /\b(?:window\.)?location\.(?:assign|replace)\(\s*`([^`]+)`/gu,
    /\b(?:[\w$]+\.)*viewOpen\(\s*`([^`]+)`/gu,
    /\b(?:window\.)?location\.href\s*=\s*`([^`]+)`/gu,
  ]) {
    for (const match of contents.matchAll(pattern)) addRoute(match[1], "navigation");
  }
  // Legacy utilities often build a hash URL in a local variable and pass that variable to
  // viewOpen later. The embedded hash route is still a concrete user navigation contract.
  for (const match of contents.matchAll(/`([^`]*#\/[^`]*)`/gu)) {
    addRoute(match[1], "navigation");
  }
  for (const match of contents.matchAll(
    /(?:\bto|:to|v-bind:to|\bhref|:href|v-bind:href)\s*=\s*(["'])(.*?)\1/gsu,
  )) {
    addRoute(match[2], "navigation");
  }
  return [...routes.values()].sort(
    (left, right) => left.route.localeCompare(right.route) || left.kind.localeCompare(right.kind),
  );
}

function normalizeRoute(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let route = value.trim();
  if (
    route.length >= 2 &&
    ((route.startsWith("`") && route.endsWith("`")) ||
      (route.startsWith("'") && route.endsWith("'")) ||
      (route.startsWith('"') && route.endsWith('"')))
  ) {
    route = route.slice(1, -1).trim();
  }
  let fallbackIndex = 0;
  route = route.replace(/\$\{([^}]+)\}/gu, (_match, expression: string) => {
    const bracketProperty = expression.match(/\[['"]([A-Za-z_$][\w$-]*)['"]\]\s*$/u)?.[1];
    const identifiers = expression.match(/[A-Za-z_$][\w$]*/gu) ?? [];
    const candidate = bracketProperty ?? identifiers.at(-1);
    if (candidate !== undefined && !["this", "undefined", "null"].includes(candidate)) {
      return `:${candidate.replace(/^\$/u, "")}`;
    }
    fallbackIndex += 1;
    return `:param${fallbackIndex}`;
  });
  route = route.replace(/\\\//gu, "/");
  const hashRouteIndex = route.indexOf("#/");
  if (hashRouteIndex >= 0) route = route.slice(hashRouteIndex + 1);
  if (!route.startsWith("/") || route.startsWith("//") || /[\r\n]/u.test(route)) return undefined;
  if (ROUTE_ASSET.test(route)) return undefined;
  return route;
}

function extractAssets(contents: string): Array<Omit<SourceAsset, "id" | "sourceFile">> {
  const assets: Array<Omit<SourceAsset, "id" | "sourceFile">> = [];
  for (const match of contents.matchAll(/\burl\(\s*(["']?)([^"')]+)\1\s*\)/gu)) {
    const reference = match[2]?.trim();
    if (isAssetReference(reference)) assets.push({ reference, kind: "css-url" });
  }
  for (const match of contents.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gu)) {
    const reference = match[1]?.trim();
    if (isAssetReference(reference)) assets.push({ reference, kind: "image-src" });
  }
  for (const match of contents.matchAll(
    /\bfrom\s*["']([^"']+\.(?:svg|png|jpe?g|gif|webp|woff2?|ttf))["']/giu,
  )) {
    const reference = match[1]?.trim();
    if (reference !== undefined) assets.push({ reference, kind: "asset-import" });
  }
  return assets;
}

function extractSelectors(contents: string): string[] {
  const selectors = new Set<string>();
  for (const match of contents.matchAll(/^\s*([^@${][^{\n]+?)\s*\{/gmu)) {
    const selector = match[1]?.trim().replace(/\s+/gu, " ");
    if (selector !== undefined && !selector.startsWith("//") && selector.length > 0) {
      selectors.add(selector);
    }
  }
  return [...selectors].sort();
}

function extractBreakpoints(contents: string): string[] {
  const breakpoints = new Set<string>();
  for (const match of contents.matchAll(/@media\s*([^\{]+)/gu)) {
    const query = match[1]?.trim().replace(/\s+/gu, " ");
    if (query !== undefined && query.length > 0) breakpoints.add(query);
  }
  return [...breakpoints].sort();
}

function extractRuntimeDependencies(
  contents: string,
  imports: readonly ImportReference[] = extractImports(contents).references,
): Array<Omit<SourceRuntimeDependency, "id" | "sourceFile">> {
  const dependencies: Array<Omit<SourceRuntimeDependency, "id" | "sourceFile">> = [];
  if (/\b(?:window\.)?kakao\.maps(?:\.Map)?\b/u.test(contents)) {
    dependencies.push({ marker: "kakao.maps.Map", kind: "map-sdk" });
  }
  if (/\bnew\s+Swiper\b|\bSwiper\(/u.test(contents)) {
    dependencies.push({ marker: "Swiper", kind: "carousel" });
  }
  if (/\b(?:window\.)?(?:webkit\.)?messageHandlers\b|\bReactNativeWebView\b/u.test(contents)) {
    dependencies.push({ marker: "native-bridge", kind: "native-bridge" });
  }
  for (const { specifier } of imports) {
    if (/(?:^|\/)vue-awesome-swiper(?:\/|$)/iu.test(specifier)) {
      dependencies.push({ marker: "vue-awesome-swiper", kind: "carousel" });
    } else if (/^swiper(?:\/|$)/iu.test(specifier)) {
      dependencies.push({ marker: "Swiper", kind: "carousel" });
    }
    if (/(?:^|\/)(?:kakao[-_]?map)(?:[./_-]|$)/iu.test(specifier)) {
      dependencies.push({ marker: "kakao-map-wrapper", kind: "map-sdk" });
    }
    if (/(?:^|\/)(?:native[-_]?bridge|webview[-_]?bridge)(?:[./_-]|$)/iu.test(specifier)) {
      dependencies.push({ marker: "native-bridge-wrapper", kind: "native-bridge" });
    }
  }
  return uniqueBy(dependencies, (item) => `${item.kind}\u0000${item.marker}`);
}

type ImportReference = {
  specifier: string;
};

function extractImports(contents: string): {
  references: ImportReference[];
  unresolvedDynamic: string[];
} {
  const references: ImportReference[] = [];
  const add = (specifier: string | undefined): void => {
    const value = specifier?.trim();
    if (value !== undefined && value.length > 0) references.push({ specifier: value });
  };
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*["']([^"']+)["']/gu,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /@(?:import|use|forward)\s*(?:url\(\s*)?["']([^"']+)["']/gu,
  ]) {
    for (const match of contents.matchAll(pattern)) add(match[1]);
  }

  const unresolvedDynamic: string[] = [];
  for (const match of contents.matchAll(/\bimport\s*\(\s*([^)]{1,300})\s*\)/gu)) {
    const expression = match[1]?.trim();
    if (expression === undefined || /^['"][^'"]+['"]$/u.test(expression)) {
      continue;
    }
    if (/^`[^`]*`$/u.test(expression) && !expression.includes("${")) {
      add(expression.slice(1, -1));
      continue;
    }
    unresolvedDynamic.push(expression.replace(/\s+/gu, " "));
  }
  return {
    references: uniqueBy(references, (item) => item.specifier),
    unresolvedDynamic: [...new Set(unresolvedDynamic)].sort(),
  };
}

function isLocalImport(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("~@/");
}

async function resolveLocalImport(
  legacyProjectRoot: string,
  importer: string,
  rawSpecifier: string,
): Promise<string | undefined> {
  const specifier = rawSpecifier.replace(/[?#].*$/u, "");
  const base =
    specifier.startsWith("@/") || specifier.startsWith("~@/")
      ? resolveWithin(legacyProjectRoot, `src/${specifier.replace(/^~?@\//u, "")}`)
      : path.resolve(path.dirname(importer), specifier);
  if (!isWithin(legacyProjectRoot, base)) return undefined;

  const extension = path.extname(base);
  const candidates =
    extension.length > 0
      ? [base]
      : [
          base,
          ...LOCAL_IMPORT_EXTENSION.map((candidateExtension) => `${base}${candidateExtension}`),
          ...LOCAL_IMPORT_EXTENSION.map((candidateExtension) =>
            path.join(base, `index${candidateExtension}`),
          ),
          ...LOCAL_IMPORT_EXTENSION.map((candidateExtension) =>
            path.join(path.dirname(base), `_${path.basename(base)}${candidateExtension}`),
          ),
        ];
  for (const candidate of candidates) {
    if (!isWithin(legacyProjectRoot, candidate) || !existsSync(candidate)) continue;
    const candidateStat = await stat(candidate);
    if (candidateStat.isFile() && TEXT_FILE.test(candidate)) return path.resolve(candidate);
  }
  return undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isAssetReference(reference: string | undefined): reference is string {
  if (reference === undefined || reference.length === 0) return false;
  if (/^(?:data|javascript|tel|mailto|hybridfunction):/iu.test(reference)) return false;
  if (reference.startsWith("#") || /[`{}$]/u.test(reference)) return false;
  // Vue bindings such as `:href="banner.adImageUrl"` are expressions, not committed assets.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/u.test(reference)) return false;
  return true;
}

function withIds<T extends object>(
  prefix: string,
  entries: readonly T[],
): Array<T & { id: string }> {
  return entries.map((entry, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    ...entry,
  }));
}

function uniqueBy<T>(entries: readonly T[], key: (entry: T) => string): T[] {
  return [...new Map(entries.map((entry) => [key(entry), entry])).values()];
}

async function listTextFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) return TEXT_FILE.test(directory) ? [directory] : [];
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return listTextFiles(entryPath);
        return TEXT_FILE.test(entry.name) ? [entryPath] : [];
      }),
    )
  ).flat();
}

function resolveWithin(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  const relativePath = path.relative(path.resolve(root), resolved);
  if (relativePath.startsWith(`..${path.sep}`) || relativePath === "..") {
    throw new Error(
      `LEGACY_SOURCE_INVENTORY_INVALID: source path escapes legacy root: ${relative}`,
    );
  }
  return resolved;
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..");
}

type CliOptions = LegacySourceInventoryOptions & { outputPath?: string };

function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new Error(
        "Usage: legacy-source-inventory --legacy-root <path> --source-paths <comma-separated> [--output <json>]",
      );
    }
    values.set(flag, value);
  }
  const legacyProjectRoot = values.get("--legacy-root");
  const sourcePaths = values.get("--source-paths");
  if (legacyProjectRoot === undefined || sourcePaths === undefined) {
    throw new Error(
      "Usage: legacy-source-inventory --legacy-root <path> --source-paths <comma-separated> [--output <json>]",
    );
  }
  const outputPath = values.get("--output");
  return {
    legacyProjectRoot,
    sourcePaths: sourcePaths
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (/legacy-source-inventory\.(?:[cm]?js|ts)$/u.test(invokedPath)) {
  void runCli();
}

async function runCli(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const inventory = await collectLegacySourceInventory(options);
    if (options.outputPath !== undefined) {
      await mkdir(path.dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify(inventory)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
