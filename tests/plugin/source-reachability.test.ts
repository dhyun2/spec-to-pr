import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "src");
const productionRoots = [
  // `pnpm check` is a supported production-maintainer entrypoint even though
  // its executable lives in scripts/. Follow it so its source plan is not
  // misclassified as an unreachable shipped module.
  "scripts/run-repository-checks.ts",
  "src/mcp/server.ts",
  "src/application/release-service.ts",
  "src/release/release-publish-plan.ts",
  "src/run/index.ts",
  "src/runtime/index.ts",
] as const;

describe("production source inventory", () => {
  it("ships only source reachable from a supported production entrypoint", async () => {
    const sourceFiles = await collectTypeScriptFiles(sourceRoot);
    const reachable = await collectReachableFiles(productionRoots);
    const unreachable = sourceFiles
      .map((file) => path.relative(projectRoot, file))
      .filter((file) => !reachable.has(file))
      .sort();

    expect(unreachable, `unreachable shipped source:\n${unreachable.join("\n")}`).toEqual([]);
  });
});

async function collectReachableFiles(roots: readonly string[]): Promise<Set<string>> {
  const reachable = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const relativeFile = pending.pop();
    if (relativeFile === undefined || reachable.has(relativeFile)) continue;

    reachable.add(relativeFile);
    const contents = await readFile(path.join(projectRoot, relativeFile), "utf8");
    for (const specifier of localSpecifiers(contents)) {
      const resolved = await resolveLocalModule(relativeFile, specifier);
      if (resolved !== undefined && !reachable.has(resolved)) pending.push(resolved);
    }
  }

  return reachable;
}

function localSpecifiers(contents: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier?.startsWith(".")) specifiers.push(specifier);
    }
  }

  return specifiers;
}

async function resolveLocalModule(
  importingFile: string,
  specifier: string,
): Promise<string | undefined> {
  const importingDirectory = path.dirname(path.join(projectRoot, importingFile));
  const rawTarget = path.resolve(importingDirectory, specifier);
  const withoutRuntimeExtension = rawTarget.replace(/\.(?:js|mjs|cjs)$/, "");
  const candidates = [
    `${withoutRuntimeExtension}.ts`,
    path.join(withoutRuntimeExtension, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (await isFile(candidate)) return path.relative(projectRoot, candidate);
  }

  return undefined;
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );

  return nested.flat();
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
