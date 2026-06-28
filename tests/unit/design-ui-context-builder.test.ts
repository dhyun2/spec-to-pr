import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDesignUiContextPack } from "../../src/design-ui/design-ui-context-builder.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-design-ui-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("Design/UI context builder", () => {
  it("writes the required context pack files", async () => {
    const context = await buildDesignUiContextPack({
      runId: "run_11111111111111111111111111111111",
      changeName: "deliver-reservation-management",
      worktreePath: path.join(directory, "worktree"),
      contextRoot: path.join(directory, "context"),
      designContractArtifactId: "art_11111111111111111111111111111111",
      figmaInventoryArtifactId: "art_22222222222222222222222222222222",
      openSpecArtifactIds: [],
      gherkinArtifactIds: [],
      apiContractArtifactIds: [],
      evidenceIds: [],
      gapIds: [],
    });

    expect(context.agent).toBe("design-ui");
    expect(context.files.agentBrief).toContain("agent-brief.md");
    expect(context.files.allowedFiles).toContain("allowed-files.json");

    const brief = await readFile(context.files.agentBrief, "utf8");
    expect(brief).toContain("Do not import generated API clients");
  });
});
