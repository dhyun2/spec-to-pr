import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveOpenSpecChangePaths, toRepoRelativePath } from "../openspec/openspec-paths.js";
import type { OpenSpecChangeName } from "../openspec/openspec-paths.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import type { Sha256Digest } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RenderedGherkinArtifacts } from "./gherkin-renderer.js";

export type WrittenGherkinFile = {
  absolutePath: string;
  relativePath: string;
  digest: Sha256Digest;
  changed: boolean;
};

export type GherkinWriteResult = {
  files: WrittenGherkinFile[];
  artifactRefs: ArtifactRef[];
};

export async function writeGherkinArtifacts(input: {
  projectRoot: string;
  changeName: OpenSpecChangeName;
  rendered: RenderedGherkinArtifacts;
  generatedAt: string;
  force?: boolean;
}): Promise<GherkinWriteResult> {
  const changePaths = resolveOpenSpecChangePaths({
    projectRoot: input.projectRoot,
    changeName: input.changeName,
  });

  const gherkinRoot = path.join(changePaths.artifactsRoot, "gherkin");

  const files = [
    ...input.rendered.featureFiles.map((file) => ({
      absolutePath: path.join(gherkinRoot, file.fileName),
      content: file.content,
      mediaType: "text/x-gherkin",
      kind: "gherkin" as const,
    })),
    {
      absolutePath: path.join(changePaths.artifactsRoot, "gherkin-index.json"),
      content: input.rendered.gherkinIndexJson,
      mediaType: "application/json",
      kind: "gherkin" as const,
    },
    {
      absolutePath: path.join(changePaths.artifactsRoot, "test-matrix.json"),
      content: input.rendered.testMatrixJson,
      mediaType: "application/json",
      kind: "test-matrix" as const,
    },
    {
      absolutePath: path.join(changePaths.artifactsRoot, "test-matrix.md"),
      content: input.rendered.testMatrixMd,
      mediaType: "text/markdown",
      kind: "test-matrix" as const,
    },
  ];

  const writtenFiles: Array<WrittenGherkinFile & { content: string; kind: "gherkin" | "test-matrix"; mediaType: string }> =
    [];

  for (const file of files) {
    assertInsideProjectRoot(input.projectRoot, file.absolutePath);

    const changed = await writeWithConflictPolicy({
      absolutePath: file.absolutePath,
      content: file.content,
      force: input.force === true,
    });

    writtenFiles.push({
      absolutePath: file.absolutePath,
      relativePath: toRepoRelativePath(input.projectRoot, file.absolutePath),
      digest: sha256Digest(Buffer.from(file.content, "utf8")),
      changed,
      content: file.content,
      kind: file.kind,
      mediaType: file.mediaType,
    });
  }

  const artifactRefs = writtenFiles.map((file) =>
    ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: file.kind,
      uri: `repo://${file.relativePath}`,
      mediaType: file.mediaType,
      digest: file.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.generatedAt,
      metadata: {
        changeName: input.changeName,
        relativePath: file.relativePath,
        changed: file.changed,
      },
    }),
  );

  return {
    files: writtenFiles.map((file) => ({
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      digest: file.digest,
      changed: file.changed,
    })),
    artifactRefs,
  };
}

async function writeWithConflictPolicy(input: {
  absolutePath: string;
  content: string;
  force: boolean;
}): Promise<boolean> {
  await mkdir(path.dirname(input.absolutePath), {
    recursive: true,
    mode: 0o700,
  });

  const existing = await readExisting(input.absolutePath);

  if (existing !== undefined) {
    if (existing === input.content) {
      return false;
    }

    if (!input.force) {
      throw new Error(`Generated Gherkin artifact already exists: ${input.absolutePath}`);
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

function assertInsideProjectRoot(projectRoot: string, absolutePath: string): void {
  const relative = path.relative(projectRoot, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project root: ${absolutePath}`);
  }
}
