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

  for (const match of content.matchAll(/export\s+(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    names.add(match[1]!);
  }

  for (const match of content.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)) {
    const parts = match[1]!.split(",").map((part) => part.trim());

    for (const part of parts) {
      const name = part.split(/\s+as\s+/i).pop()?.trim();

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

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
