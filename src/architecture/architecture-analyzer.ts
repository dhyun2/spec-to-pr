import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  ArchitectureReportSchema,
  createViolationId,
  type ArchitectureReport,
  type ArchitectureViolation,
} from "./architecture-report.js";
import { evaluateFsdImport } from "./fsd-boundary-rules.js";
import { parseSourceImports } from "./import-parser.js";
import { classifyModulePath, resolveImportTarget } from "./project-boundary.js";
import { evaluateSourceGuards } from "./source-guard-rules.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "artifacts",
]);

export async function analyzeArchitecture(input: {
  projectRoot: string;
  analyzedAt: string;
  aliases?: Record<string, string>;
  sourceRoots?: string[];
}): Promise<ArchitectureReport> {
  const files = await collectSourceFiles(input.projectRoot);
  const violations: ArchitectureViolation[] = [];
  let importCount = 0;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const sourceRef = classifyModulePath({
      absolutePath: file,
      projectRoot: input.projectRoot,
      ...(input.sourceRoots === undefined ? {} : { sourceRoots: input.sourceRoots }),
    });
    const imports = parseSourceImports({
      filePath: file,
      content,
    });

    importCount += imports.length;

    for (const sourceImport of imports) {
      const targetCandidate = resolveImportTarget({
        sourceFile: file,
        importSpecifier: sourceImport.specifier,
        projectRoot: input.projectRoot,
        ...(input.sourceRoots === undefined ? {} : { sourceRoots: input.sourceRoots }),
        ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
      });

      violations.push(
        ...evaluateSourceGuards({
          index: violations.length,
          source: sourceRef,
          sourceImport,
          sourceContent: content,
        }),
      );

      if (targetCandidate === undefined) {
        continue;
      }

      const resolvedTarget = await resolveExistingModule(targetCandidate);

      if (resolvedTarget === undefined) {
        violations.push({
          id: createViolationId(violations.length),
          kind: "unresolved-internal-import",
          severity: "minor",
          file: sourceRef.relativePath,
          line: sourceImport.line,
          column: sourceImport.column,
          importSpecifier: sourceImport.specifier,
          message: `Internal import could not be resolved: ${sourceImport.specifier}`,
          recommendation: "Check alias configuration or file extension resolution.",
        });
        continue;
      }

      const targetRef = classifyModulePath({
        absolutePath: resolvedTarget,
        projectRoot: input.projectRoot,
        ...(input.sourceRoots === undefined ? {} : { sourceRoots: input.sourceRoots }),
      });

      violations.push(
        ...evaluateFsdImport({
          index: violations.length,
          source: sourceRef,
          target: targetRef,
          sourceImport,
        }),
      );
    }
  }

  return ArchitectureReportSchema.parse({
    adapter: "architecture-guard-v1",
    projectRoot: input.projectRoot,
    analyzedAt: input.analyzedAt,
    fileCount: files.length,
    importCount,
    violationCount: violations.length,
    blockerCount: violations.filter((item) => item.severity === "blocker").length,
    majorCount: violations.filter((item) => item.severity === "major").length,
    minorCount: violations.filter((item) => item.severity === "minor").length,
    infoCount: violations.filter((item) => item.severity === "info").length,
    violations,
  });
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        result.push(absolutePath);
      }
    }
  }

  await visit(root);

  return result.sort();
}

async function resolveExistingModule(candidate: string): Promise<string | undefined> {
  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
    path.join(candidate, "index.js"),
    path.join(candidate, "index.jsx"),
  ];

  for (const item of candidates) {
    if (await isFile(item)) {
      return item;
    }
  }

  return undefined;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
