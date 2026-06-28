import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveOpenSpecChangePaths, toRepoRelativePath } from "../openspec/openspec-paths.js";
import type { OpenSpecChangeName } from "../openspec/openspec-paths.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RenderedDesignContract } from "./design-contract-renderer.js";

export type DesignContractWriteResult = {
  files: Array<{
    relativePath: string;
    changed: boolean;
  }>;
  artifactRefs: ArtifactRef[];
};

export async function writeDesignContractArtifacts(input: {
  projectRoot: string;
  changeName: OpenSpecChangeName;
  rendered: RenderedDesignContract;
  generatedAt: string;
  force?: boolean;
}): Promise<DesignContractWriteResult> {
  const changePaths = resolveOpenSpecChangePaths({
    projectRoot: input.projectRoot,
    changeName: input.changeName,
  });

  const root = path.join(changePaths.artifactsRoot, "design-contract");
  const files = [
    {
      name: "figma-design-contract.json",
      content: input.rendered.contractJson,
      mediaType: "application/json",
      kind: "figma-design-contract" as const,
    },
    {
      name: "figma-design-contract.md",
      content: input.rendered.contractMd,
      mediaType: "text/markdown",
      kind: "figma-design-contract" as const,
    },
    {
      name: "component-map.json",
      content: input.rendered.componentMapJson,
      mediaType: "application/json",
      kind: "design-system-map" as const,
    },
    {
      name: "token-map.json",
      content: input.rendered.tokenMapJson,
      mediaType: "application/json",
      kind: "design-system-map" as const,
    },
    {
      name: "typography-map.json",
      content: input.rendered.typographyMapJson,
      mediaType: "application/json",
      kind: "design-system-map" as const,
    },
    {
      name: "asset-map.json",
      content: input.rendered.assetMapJson,
      mediaType: "application/json",
      kind: "design-system-map" as const,
    },
    {
      name: "ui-implementation-rules.md",
      content: input.rendered.uiImplementationRulesMd,
      mediaType: "text/markdown",
      kind: "ui-implementation-rules" as const,
    },
    {
      name: "design-gap-summary.md",
      content: input.rendered.designGapSummaryMd,
      mediaType: "text/markdown",
      kind: "figma-design-contract" as const,
    },
  ];

  const written = [];

  for (const file of files) {
    const absolutePath = path.join(root, file.name);
    assertInsideProjectRoot(input.projectRoot, absolutePath);

    const changed = await writeWithConflictPolicy({
      absolutePath,
      content: file.content,
      force: input.force === true,
    });

    written.push({
      ...file,
      absolutePath,
      changed,
      relativePath: toRepoRelativePath(input.projectRoot, absolutePath),
    });
  }

  const artifactRefs = written.map((file) =>
    ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: file.kind,
      uri: `repo://${file.relativePath}`,
      mediaType: file.mediaType,
      digest: sha256Digest(Buffer.from(file.content, "utf8")),
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
    files: written.map((file) => ({
      relativePath: file.relativePath,
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
      throw new Error(`Design contract file already exists: ${input.absolutePath}`);
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
