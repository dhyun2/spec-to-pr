import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256Digest } from "../source-registry/content-hash.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import type { Sha256Digest } from "../runtime/scalars.js";
import { resolveOpenSpecChangePaths, specFilePath, toRepoRelativePath } from "./openspec-paths.js";
import type { OpenSpecChangeName } from "./openspec-paths.js";
import type { RenderedOpenSpecChange } from "./openspec-renderer.js";

export type OpenSpecWritePolicy = {
  force?: boolean;
};

export type WrittenOpenSpecFile = {
  absolutePath: string;
  relativePath: string;
  digest: Sha256Digest;
  changed: boolean;
};

export type OpenSpecWriteResult = {
  files: WrittenOpenSpecFile[];
  artifactRefs: ArtifactRef[];
};

export async function writeOpenSpecChange(input: {
  projectRoot: string;
  changeName: OpenSpecChangeName;
  rendered: RenderedOpenSpecChange;
  generatedAt: string;
  policy?: OpenSpecWritePolicy;
}): Promise<OpenSpecWriteResult> {
  const paths = resolveOpenSpecChangePaths({
    projectRoot: input.projectRoot,
    changeName: input.changeName,
  });

  const filesToWrite: Array<{ absolutePath: string; content: string; kind: "openspec" | "log" }> = [
    {
      absolutePath: paths.proposalPath,
      content: input.rendered.proposalMd,
      kind: "openspec",
    },
    {
      absolutePath: paths.designPath,
      content: input.rendered.designMd,
      kind: "openspec",
    },
    {
      absolutePath: paths.tasksPath,
      content: input.rendered.tasksMd,
      kind: "openspec",
    },
    {
      absolutePath: paths.evidenceSummaryPath,
      content: input.rendered.evidenceSummaryMd,
      kind: "openspec",
    },
    {
      absolutePath: paths.traceabilityMatrixPath,
      content: input.rendered.traceabilityMatrixMd,
      kind: "openspec",
    },
    {
      absolutePath: paths.gapSummaryPath,
      content: input.rendered.gapSummaryMd,
      kind: "openspec",
    },
    {
      absolutePath: paths.manifestPath,
      content: input.rendered.manifestJson,
      kind: "openspec",
    },
    ...input.rendered.specs.map((spec) => ({
      absolutePath: specFilePath({
        specsRoot: paths.specsRoot,
        area: spec.area,
      }),
      content: spec.content,
      kind: "openspec" as const,
    })),
  ];

  const writtenFiles: WrittenOpenSpecFile[] = [];

  for (const file of filesToWrite) {
    assertInsideProjectRoot(input.projectRoot, file.absolutePath);

    const content = ensureFinalNewline(file.content);
    const changed = await writeFileWithConflictPolicy({
      absolutePath: file.absolutePath,
      content,
      force: input.policy?.force === true,
    });

    writtenFiles.push({
      absolutePath: file.absolutePath,
      relativePath: toRepoRelativePath(input.projectRoot, file.absolutePath),
      digest: sha256Digest(Buffer.from(content, "utf8")),
      changed,
    });
  }

  const artifactRefs = writtenFiles.map((file) =>
    ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "openspec",
      uri: `repo://${file.relativePath}`,
      mediaType: file.relativePath.endsWith(".json") ? "application/json" : "text/markdown",
      digest: file.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.generatedAt,
      metadata: {
        relativePath: file.relativePath,
        changed: file.changed,
        changeName: input.changeName,
      },
    }),
  );

  return {
    files: writtenFiles,
    artifactRefs,
  };
}

async function writeFileWithConflictPolicy(input: {
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
      throw new Error(`OpenSpec file already exists with different content: ${input.absolutePath}`);
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

function ensureFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
