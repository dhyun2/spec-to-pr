import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { sha256Digest } from "../source-registry/content-hash.js";

export type SourceGuardTestWriteResult = {
  relativePath: string;
  changed: boolean;
  artifact: ArtifactRef;
};

export async function writeSourceGuardTest(input: {
  projectRoot: string;
  generatedAt: string;
  force?: boolean;
}): Promise<SourceGuardTestWriteResult> {
  const relativePath = "tests/architecture/source-guard.generated.test.ts";
  const absolutePath = path.join(input.projectRoot, relativePath);
  const content = renderSourceGuardTest();

  await mkdir(path.dirname(absolutePath), {
    recursive: true,
    mode: 0o700,
  });

  const changed = await writeWithConflictPolicy({
    absolutePath,
    content,
    force: input.force === true,
  });
  const artifact = ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: "test-report",
    uri: `repo://${relativePath}`,
    mediaType: "text/typescript",
    digest: sha256Digest(Buffer.from(content, "utf8")),
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: input.generatedAt,
    metadata: {
      generatedBy: "architecture-guard-v1",
      relativePath,
      changed,
      purpose: "source-guard-test",
    },
  });

  return {
    relativePath,
    changed,
    artifact,
  };
}

function renderSourceGuardTest(): string {
  return `import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

describe("generated source guards", () => {
  it("does not allow UI files to import generated API clients directly", () => {
    const violations = collectSourceFiles(process.cwd())
      .filter((file) => file.includes("/ui/") || file.includes("\\\\ui\\\\"))
      .flatMap((file) => {
        const content = readFileSync(file, "utf8");
        const relative = path.relative(process.cwd(), file);
        const patterns = [
          /from\\s+["'][^"']*shared\\/api\\/generated[^"']*["']/,
          /from\\s+["'][^"']*\\/generated\\/[^"']*["']/,
        ];

        return patterns.some((pattern) => pattern.test(content)) ? [relative] : [];
      });

    expect(violations).toEqual([]);
  });

  it("does not allow UI files to call fetch directly", () => {
    const violations = collectSourceFiles(process.cwd())
      .filter((file) => file.includes("/ui/") || file.includes("\\\\ui\\\\"))
      .flatMap((file) => {
        const content = readFileSync(file, "utf8");
        const relative = path.relative(process.cwd(), file);

        return /\\bfetch\\s*\\(/.test(content) ? [relative] : [];
      });

    expect(violations).toEqual([]);
  });
});

function collectSourceFiles(root: string): string[] {
  const result: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        result.push(absolutePath);
      }
    }
  }

  visit(root);

  return result;
}
`;
}

async function writeWithConflictPolicy(input: {
  absolutePath: string;
  content: string;
  force: boolean;
}): Promise<boolean> {
  const existing = await readExisting(input.absolutePath);

  if (existing !== undefined) {
    if (existing === input.content) {
      return false;
    }

    if (!input.force) {
      throw new Error(`Source guard test already exists with different content: ${input.absolutePath}`);
    }
  }

  await writeFile(input.absolutePath, input.content, {
    encoding: "utf8",
    mode: 0o600,
  });

  return true;
}

async function readExisting(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  }
}
