import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const CodeComponentCandidateSchema = z
  .object({
    name: z.string().trim().min(1),
    importPath: z.string().trim().min(1),
    filePath: z.string().trim().min(1),
    source: z.enum(["shared-ui", "components", "package-ui", "unknown"]),
  })
  .strict();

export const CodeTokenCandidateSchema = z
  .object({
    name: z.string().trim().min(1),
    kind: z.enum(["css-variable", "class-name", "token-export", "unknown"]),
    filePath: z.string().trim().min(1),
    value: z.string().trim().optional(),
  })
  .strict();

export const ProjectDesignSystemInventorySchema = z
  .object({
    components: z.array(CodeComponentCandidateSchema).default([]),
    tokens: z.array(CodeTokenCandidateSchema).default([]),
    scannedPaths: z.array(z.string()).default([]),
  })
  .strict();

export type CodeComponentCandidate = z.infer<typeof CodeComponentCandidateSchema>;
export type CodeTokenCandidate = z.infer<typeof CodeTokenCandidateSchema>;
export type ProjectDesignSystemInventory = z.infer<typeof ProjectDesignSystemInventorySchema>;

const COMPONENT_ROOT_CANDIDATES = [
  "src/shared/ui",
  "src/shared/design-system",
  "src/components",
  "packages/ui",
  "packages/design-system",
  "apps",
];

const TOKEN_FILE_PATTERNS = ["tokens", "theme", "variables.css", "tailwind.config", "foundation"];
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage", ".next"]);

export async function scanProjectDesignSystem(
  projectRoot: string,
): Promise<ProjectDesignSystemInventory> {
  const components: CodeComponentCandidate[] = [];
  const tokens: CodeTokenCandidate[] = [];
  const scannedPaths: string[] = [];

  for (const relativeRoot of COMPONENT_ROOT_CANDIDATES) {
    const absoluteRoot = path.join(projectRoot, relativeRoot);

    if (!(await existsDirectory(absoluteRoot))) {
      continue;
    }

    scannedPaths.push(relativeRoot);

    const discovered = await scanComponentsInDirectory(projectRoot, absoluteRoot, relativeRoot);
    components.push(...discovered);
  }

  const packageDesignSystem = await scanFrontendUiPackage(projectRoot);
  components.push(...packageDesignSystem.components);
  scannedPaths.push(...packageDesignSystem.scannedPaths);

  const tokenFiles = await findTokenLikeFiles(projectRoot);

  for (const file of tokenFiles) {
    scannedPaths.push(file.relativePath);
    tokens.push(...(await scanTokensFromFile(file.absolutePath, file.relativePath)));
  }

  return ProjectDesignSystemInventorySchema.parse({
    components: dedupeComponents(components),
    tokens: dedupeTokens(tokens),
    scannedPaths,
  });
}

async function scanComponentsInDirectory(
  projectRoot: string,
  absoluteRoot: string,
  relativeRoot: string,
): Promise<CodeComponentCandidate[]> {
  const result: CodeComponentCandidate[] = [];
  const entries = await walk(absoluteRoot);

  for (const file of entries) {
    if (!/\.(tsx|ts|jsx|js)$/.test(file)) {
      continue;
    }

    const content = await readFile(file, "utf8");
    const relativePath = toPosix(path.relative(projectRoot, file));
    const names = extractExportedComponentNames(content, file);

    for (const name of names) {
      result.push(
        CodeComponentCandidateSchema.parse({
          name,
          importPath: inferImportPath(relativePath),
          filePath: relativePath,
          source: inferComponentSource(relativeRoot),
        }),
      );
    }
  }

  return result;
}

function extractExportedComponentNames(content: string, filePath: string): string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(
    /export\s+(?:declare\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g,
  )) {
    names.add(match[1]!);
  }

  for (const match of content.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)) {
    const parts = match[1]!.split(",").map((part) => part.trim());

    for (const part of parts) {
      const name = part
        .split(/\s+as\s+/i)
        .pop()
        ?.trim();

      if (name !== undefined && /^[A-Z][A-Za-z0-9_]*$/.test(name)) {
        names.add(name);
      }
    }
  }

  if (names.size === 0) {
    const baseName = path.basename(filePath).replace(/\.(tsx|ts|jsx|js)$/, "");

    if (/^[A-Z][A-Za-z0-9_]*$/.test(baseName)) {
      names.add(baseName);
    }
  }

  return [...names];
}

async function scanFrontendUiPackage(projectRoot: string): Promise<{
  components: CodeComponentCandidate[];
  scannedPaths: string[];
}> {
  const packageRoot = path.join(projectRoot, "node_modules", "@frontend", "ui");

  if (!(await existsDirectory(packageRoot))) {
    return {
      components: [],
      scannedPaths: [],
    };
  }

  const exportTargets = await frontendUiExportTargets(packageRoot);
  const components: CodeComponentCandidate[] = [];

  for (const target of exportTargets) {
    if (!(await existsFile(target.absolutePath))) {
      continue;
    }

    const content = await readFile(target.absolutePath, "utf8");
    const names = extractExportedComponentNames(content, target.absolutePath);
    const relativePath = toPosix(path.relative(projectRoot, target.absolutePath));

    for (const name of names) {
      components.push(
        CodeComponentCandidateSchema.parse({
          name,
          importPath: target.importPath,
          filePath: relativePath,
          source: "package-ui",
        }),
      );
    }
  }

  return {
    components,
    scannedPaths: components.length === 0 ? [] : ["node_modules/@frontend/ui"],
  };
}

async function frontendUiExportTargets(packageRoot: string): Promise<
  Array<{
    importPath: string;
    absolutePath: string;
  }>
> {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const targets: Array<{ importPath: string; absolutePath: string }> = [];

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      types?: unknown;
      exports?: unknown;
    };
    const rootTypes =
      exportTypesPath(readExportValue(packageJson.exports, ".")) ??
      (typeof packageJson.types === "string" ? packageJson.types : undefined);
    const vueIconTypes = exportTypesPath(readExportValue(packageJson.exports, "./icons/vue"));
    const reactIconTypes = exportTypesPath(readExportValue(packageJson.exports, "./icons/react"));

    if (rootTypes !== undefined) {
      targets.push({
        importPath: "@frontend/ui",
        absolutePath: path.join(packageRoot, rootTypes),
      });
    }

    if (vueIconTypes !== undefined) {
      targets.push({
        importPath: "@frontend/ui/icons/vue",
        absolutePath: path.join(packageRoot, vueIconTypes),
      });
    }

    if (reactIconTypes !== undefined) {
      targets.push({
        importPath: "@frontend/ui/icons/react",
        absolutePath: path.join(packageRoot, reactIconTypes),
      });
    }
  } catch {
    // Fall through to conventional package paths below.
  }

  targets.push(
    { importPath: "@frontend/ui", absolutePath: path.join(packageRoot, "dist", "index.d.ts") },
    { importPath: "@frontend/ui", absolutePath: path.join(packageRoot, "index.d.ts") },
    {
      importPath: "@frontend/ui/icons/vue",
      absolutePath: path.join(packageRoot, "dist", "icons", "vue.d.ts"),
    },
    {
      importPath: "@frontend/ui/icons/vue",
      absolutePath: path.join(packageRoot, "icons", "vue.d.ts"),
    },
    {
      importPath: "@frontend/ui/icons/react",
      absolutePath: path.join(packageRoot, "dist", "icons", "react.d.ts"),
    },
    {
      importPath: "@frontend/ui/icons/react",
      absolutePath: path.join(packageRoot, "icons", "react.d.ts"),
    },
  );

  return dedupeExportTargets(targets);
}

function readExportValue(exportsValue: unknown, key: string): unknown {
  if (typeof exportsValue !== "object" || exportsValue === null || Array.isArray(exportsValue)) {
    return undefined;
  }

  return (exportsValue as Record<string, unknown>)[key];
}

function exportTypesPath(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["types", "typings", "import", "default"]) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }

  return undefined;
}

async function findTokenLikeFiles(
  projectRoot: string,
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const files = await walk(projectRoot);
  const result = [];

  for (const file of files) {
    const relativePath = toPosix(path.relative(projectRoot, file));
    const lower = relativePath.toLowerCase();

    if (
      TOKEN_FILE_PATTERNS.some((pattern) => lower.includes(pattern)) &&
      /\.(css|scss|ts|tsx|js|json)$/.test(lower)
    ) {
      result.push({
        absolutePath: file,
        relativePath,
      });
    }
  }

  return result.slice(0, 200);
}

async function scanTokensFromFile(
  filePath: string,
  relativePath: string,
): Promise<CodeTokenCandidate[]> {
  const content = await readFile(filePath, "utf8");
  const result: CodeTokenCandidate[] = [];

  for (const match of content.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
    result.push(
      CodeTokenCandidateSchema.parse({
        name: match[1]!,
        kind: "css-variable",
        filePath: relativePath,
        value: match[2]!.trim(),
      }),
    );
  }

  for (const match of content.matchAll(
    /["'`]([A-Za-z0-9_-]*(?:color|text|bg|border|radius|shadow|spacing)[A-Za-z0-9_-]*)["'`]/gi,
  )) {
    result.push(
      CodeTokenCandidateSchema.parse({
        name: match[1]!,
        kind: "class-name",
        filePath: relativePath,
      }),
    );
  }

  for (const match of content.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g)) {
    result.push(
      CodeTokenCandidateSchema.parse({
        name: match[1]!,
        kind: "token-export",
        filePath: relativePath,
      }),
    );
  }

  return result;
}

async function walk(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await walk(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      result.push(absolutePath);
    }
  }

  return result;
}

async function existsDirectory(absolutePath: string): Promise<boolean> {
  try {
    const metadata = await stat(absolutePath);
    return metadata.isDirectory();
  } catch {
    return false;
  }
}

async function existsFile(absolutePath: string): Promise<boolean> {
  try {
    const metadata = await stat(absolutePath);
    return metadata.isFile();
  } catch {
    return false;
  }
}

function inferImportPath(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.(tsx|ts|jsx|js)$/, "");

  if (withoutExtension.endsWith("/index")) {
    return `@/${withoutExtension.slice(0, -"/index".length)}`;
  }

  return `@/${withoutExtension}`;
}

function inferComponentSource(relativeRoot: string) {
  if (relativeRoot.includes("shared/ui")) {
    return "shared-ui";
  }

  if (relativeRoot.includes("components")) {
    return "components";
  }

  if (relativeRoot.includes("packages")) {
    return "package-ui";
  }

  return "unknown";
}

function dedupeComponents(components: CodeComponentCandidate[]): CodeComponentCandidate[] {
  const byKey = new Map<string, CodeComponentCandidate>();

  for (const component of components) {
    byKey.set(`${component.name}:${component.importPath}`, component);
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeTokens(tokens: CodeTokenCandidate[]): CodeTokenCandidate[] {
  const byKey = new Map<string, CodeTokenCandidate>();

  for (const token of tokens) {
    byKey.set(`${token.name}:${token.kind}:${token.filePath}`, token);
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeExportTargets(
  targets: Array<{
    importPath: string;
    absolutePath: string;
  }>,
): Array<{
  importPath: string;
  absolutePath: string;
}> {
  const byKey = new Map<string, { importPath: string; absolutePath: string }>();

  for (const target of targets) {
    byKey.set(`${target.importPath}:${target.absolutePath}`, target);
  }

  return [...byKey.values()];
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
