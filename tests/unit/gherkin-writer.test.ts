import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RenderedGherkinArtifacts } from "../../src/gherkin/gherkin-renderer.js";
import { writeGherkinArtifacts } from "../../src/gherkin/gherkin-writer.js";

let directory: string;

const now = "2026-06-23T00:00:00.000Z";
const changeName = "deliver-reservation-management";

const rendered: RenderedGherkinArtifacts = {
  featureFiles: [
    {
      fileName: "reservation-management.feature",
      content: "Feature: Reservation Management\n",
    },
  ],
  gherkinIndexJson: "{}\n",
  testMatrixJson: "{}\n",
  testMatrixMd: "# Test Matrix\n",
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-gherkin-writer-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("Gherkin writer", () => {
  it("writes gherkin and test matrix artifacts inside project root", async () => {
    const result = await writeGherkinArtifacts({
      projectRoot: directory,
      changeName,
      rendered,
      generatedAt: now,
    });

    expect(result.files.map((file) => file.relativePath)).toContain(
      "openspec/changes/deliver-reservation-management/artifacts/gherkin/reservation-management.feature",
    );
    expect(result.files.map((file) => file.relativePath)).toContain(
      "openspec/changes/deliver-reservation-management/artifacts/test-matrix.json",
    );
    expect(result.artifactRefs.some((artifact) => artifact.kind === "gherkin")).toBe(true);
    expect(result.artifactRefs.some((artifact) => artifact.kind === "test-matrix")).toBe(true);
  });

  it("detects conflicting existing files", async () => {
    await writeGherkinArtifacts({
      projectRoot: directory,
      changeName,
      rendered,
      generatedAt: now,
    });

    await writeFile(
      path.join(directory, "openspec", "changes", changeName, "artifacts", "test-matrix.md"),
      "# Different\n",
      "utf8",
    );

    await expect(
      writeGherkinArtifacts({
        projectRoot: directory,
        changeName,
        rendered,
        generatedAt: now,
      }),
    ).rejects.toThrow(/already exists/);
  });
});
