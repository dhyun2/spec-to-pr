import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RenderedDesignContract } from "../../src/design-contract/design-contract-renderer.js";
import { writeDesignContractArtifacts } from "../../src/design-contract/design-contract-writer.js";

let directory: string;

const now = "2026-06-23T00:00:00.000Z";
const changeName = "deliver-reservation-management";
const rendered: RenderedDesignContract = {
  contractJson: "{}\n",
  contractMd: "# Contract\n",
  componentMapJson: "[]\n",
  tokenMapJson: "[]\n",
  typographyMapJson: "[]\n",
  assetMapJson: "[]\n",
  uiImplementationRulesMd: "# Rules\n",
  designGapSummaryMd: "# Gaps\n",
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-design-contract-writer-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("Design contract writer", () => {
  it("writes design contract artifacts inside project root", async () => {
    const result = await writeDesignContractArtifacts({
      projectRoot: directory,
      changeName,
      rendered,
      generatedAt: now,
    });

    expect(result.files.map((file) => file.relativePath)).toContain(
      "openspec/changes/deliver-reservation-management/artifacts/design-contract/figma-design-contract.json",
    );
    expect(result.artifactRefs.some((artifact) => artifact.kind === "figma-design-contract")).toBe(
      true,
    );
    expect(result.artifactRefs.some((artifact) => artifact.kind === "design-system-map")).toBe(
      true,
    );
    expect(
      result.artifactRefs.some((artifact) => artifact.kind === "ui-implementation-rules"),
    ).toBe(true);
  });

  it("detects conflicting existing files", async () => {
    await writeDesignContractArtifacts({
      projectRoot: directory,
      changeName,
      rendered,
      generatedAt: now,
    });

    await writeFile(
      path.join(
        directory,
        "openspec",
        "changes",
        changeName,
        "artifacts",
        "design-contract",
        "ui-implementation-rules.md",
      ),
      "# Different\n",
      "utf8",
    );

    await expect(
      writeDesignContractArtifacts({
        projectRoot: directory,
        changeName,
        rendered,
        generatedAt: now,
      }),
    ).rejects.toThrow(/already exists/);
  });
});
