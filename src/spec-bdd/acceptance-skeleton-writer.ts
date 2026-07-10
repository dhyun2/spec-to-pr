import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TestMatrix, TestMatrixRow } from "../gherkin/test-matrix.js";

export type AcceptanceSkeletonWriteResult = {
  directory: string;
  files: string[];
};

export async function writeAcceptanceSkeletons(input: {
  projectRoot: string;
  changeName: string;
  matrix: TestMatrix;
  force?: boolean;
}): Promise<AcceptanceSkeletonWriteResult> {
  const directory = path.join(
    input.projectRoot,
    "tests",
    "acceptance",
    "generated",
    input.changeName,
  );

  assertInsideProjectRoot(input.projectRoot, directory);

  await mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });

  const files: string[] = [];

  for (const row of input.matrix.rows) {
    const fileName = `${sanitizeFileName(row.scenarioId)}.test.md`;
    const absolutePath = path.join(directory, fileName);
    const content = renderSkeleton(row);

    await writeFile(absolutePath, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: input.force === true ? "w" : "wx",
    }).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "EEXIST"
      ) {
        return;
      }

      throw error;
    });

    files.push(path.relative(input.projectRoot, absolutePath).split(path.sep).join("/"));
  }

  return {
    directory: path.relative(input.projectRoot, directory).split(path.sep).join("/"),
    files,
  };
}

function renderSkeleton(row: TestMatrixRow): string {
  return `# Acceptance Skeleton - ${row.scenarioId}

## Requirement

${row.requirementId}

## Scenario

${row.scenarioName}

## Layer

${row.layer}

## Automation

${row.automation}

## Evidence

- Brief: ${row.briefEvidenceIds.join(", ") || "-"}
- Figma: ${row.figmaEvidenceIds.join(", ") || "-"}
- OpenAPI: ${row.openApiEvidenceIds.join(", ") || "-"}

## Gaps

${row.gapIds.length === 0 ? "No linked gaps." : row.gapIds.map((id) => `- ${id}`).join("\n")}

## Future implementation notes

This file is a generated acceptance skeleton. It is not an executable test yet.
Later tasks may convert this skeleton into Cucumber, Playwright, Vitest, or project-specific acceptance tests.
`;
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function assertInsideProjectRoot(projectRoot: string, absolutePath: string): void {
  const relative = path.relative(projectRoot, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project root: ${absolutePath}`);
  }
}
