import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RenderedOpenSpecChange } from "../../src/openspec/openspec-renderer.js";
import { writeOpenSpecChange } from "../../src/openspec/openspec-writer.js";

let directory: string;

const now = "2026-06-23T00:00:00.000Z";

const rendered: RenderedOpenSpecChange = {
  proposalMd: "# Proposal\n",
  designMd: "# Design\n",
  tasksMd: "# Tasks\n",
  specs: [
    {
      area: "reservation-management",
      content: "# reservation-management\n",
    },
  ],
  evidenceSummaryMd: "# Evidence\n",
  traceabilityMatrixMd: "# Matrix\n",
  gapSummaryMd: "# Gaps\n",
  manifestJson: "{}\n",
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-openspec-writer-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("OpenSpec writer", () => {
  it("writes change files inside project root", async () => {
    const result = await writeOpenSpecChange({
      projectRoot: directory,
      changeName: "deliver-reservation-management",
      rendered,
      generatedAt: now,
    });

    expect(result.files.map((file) => file.relativePath)).toContain(
      "openspec/changes/deliver-reservation-management/proposal.md",
    );
    expect(result.artifactRefs.every((artifact) => artifact.kind === "openspec")).toBe(true);
  });

  it("detects conflicting existing files", async () => {
    const proposalPath = path.join(
      directory,
      "openspec",
      "changes",
      "deliver-reservation-management",
      "proposal.md",
    );
    await writeFile(proposalPath, "# Different\n", "utf8").catch(async () => {
      await writeOpenSpecChange({
        projectRoot: directory,
        changeName: "deliver-reservation-management",
        rendered,
        generatedAt: now,
      });
      await writeFile(proposalPath, "# Different\n", "utf8");
    });

    await expect(
      writeOpenSpecChange({
        projectRoot: directory,
        changeName: "deliver-reservation-management",
        rendered,
        generatedAt: now,
      }),
    ).rejects.toThrow(/already exists/);
  });
});
