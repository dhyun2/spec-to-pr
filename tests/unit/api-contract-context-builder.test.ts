import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApiContractAgentContext } from "../../src/api-agent/api-contract-context-builder.js";
import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-api-agent-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("API Contract Agent context builder", () => {
  it("builds a scoped context pack", async () => {
    const run = createInitialRun(
      {
        sources: [],
        baseCommit: "abcdef1",
      },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot: "/repo",
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    const result = await buildApiContractAgentContext({
      run: RunManifestSchema.parse({
        ...run,
        artifacts: [
          {
            id: "art_11111111111111111111111111111111",
            kind: "openapi-intake-report",
            uri: "artifact://openapi",
            mediaType: "application/json",
            digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            producedBy: "orchestrator",
            evidenceIds: [],
            createdAt: "2026-06-23T00:00:00.000Z",
          },
        ],
      }),
      worktreePath: "/worktree/api",
      baseSha: "abcdef1",
      outputRoot: directory,
      preparedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(result.context.openApiIntakeArtifactIds).toEqual([
      "art_11111111111111111111111111111111",
    ]);
    expect(result.context.allowedWriteGlobs.length).toBeGreaterThan(0);
    expect(result.files.map((file) => path.basename(file.path))).toContain("context.json");
  });
});
