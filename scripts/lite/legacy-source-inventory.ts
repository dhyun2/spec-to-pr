import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|s[ac]ss|less)$/iu;
const STYLE_FILE = /\.(?:css|s[ac]ss|less)$/iu;
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
};

export type SourceRoute = {
  id: string;
  sourceFile: string;
  route: string;
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

export type LegacySourceInventoryOptions = {
  legacyProjectRoot: string;
  sourcePaths: string[];
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

  const files = (
    await Promise.all(
      options.sourcePaths.map(async (sourcePath) =>
        listTextFiles(resolveWithin(options.legacyProjectRoot, sourcePath)),
      ),
    )
  )
    .flat()
    .sort();
  const routes: Omit<SourceRoute, "id">[] = [];
  const assets: Omit<SourceAsset, "id">[] = [];
  const selectors: Omit<SourceSelector, "id">[] = [];
  const breakpoints: Omit<SourceBreakpoint, "id">[] = [];
  const runtimeDependencies: Omit<SourceRuntimeDependency, "id">[] = [];

  for (const file of files) {
    const sourceFile = relativePath(options.legacyProjectRoot, file);
    const contents = await readFile(file, "utf8");
    for (const route of extractRoutes(contents)) routes.push({ sourceFile, route });
    for (const asset of extractAssets(contents)) assets.push({ sourceFile, ...asset });
    if (STYLE_FILE.test(file)) {
      for (const selector of extractSelectors(contents)) selectors.push({ sourceFile, selector });
      for (const query of extractBreakpoints(contents)) breakpoints.push({ sourceFile, query });
    }
    for (const dependency of extractRuntimeDependencies(contents)) {
      runtimeDependencies.push({ sourceFile, ...dependency });
    }
  }

  return {
    schemaVersion: 1,
    legacyProjectRoot: options.legacyProjectRoot,
    sourcePaths: options.sourcePaths,
    routes: withIds(
      "route",
      uniqueBy(routes, (item) => `${item.sourceFile}\u0000${item.route}`),
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
  };
}

function extractRoutes(contents: string): string[] {
  const routes = new Set<string>();
  for (const pattern of [
    /\bpath\s*:\s*["'`]([^"'`]+)["'`]/gu,
    /\brouter\.(?:push|replace)\(\s*["'`]([^"'`]+)["'`]/gu,
  ]) {
    for (const match of contents.matchAll(pattern)) {
      const route = match[1]?.trim();
      if (route?.startsWith("/")) routes.add(route);
    }
  }
  return [...routes].sort();
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
  return dependencies;
}

function isAssetReference(reference: string | undefined): reference is string {
  return (
    reference !== undefined &&
    reference.length > 0 &&
    !reference.startsWith("data:") &&
    !reference.startsWith("#") &&
    !reference.startsWith("javascript:")
  );
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
