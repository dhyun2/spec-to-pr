import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAllowedFilesPolicy,
  createForbiddenImportsPolicy,
} from "../../src/design-ui/design-ui-context-builder.js";
import { validateDesignUiAgentResult } from "../../src/design-ui/design-ui-result-validator.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/constants.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-design-ui-validator-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("Design/UI result validator", () => {
  it("accepts design-ui implementation changes inside writable globs", async () => {
    const result = await validateDesignUiAgentResult({
      result: baseResult({
        changedFiles: ["src/features/reservation/ui/reservation-list.tsx"],
      }),
      allowedFiles: createAllowedFilesPolicy(),
      forbiddenImports: createForbiddenImportsPolicy(),
      worktreePath: directory,
    });

    expect(result.valid).toBe(true);
  });

  it("rejects generated API changes", async () => {
    const result = await validateDesignUiAgentResult({
      result: baseResult({
        changedFiles: ["src/shared/api/generated/staff/client.ts"],
      }),
      allowedFiles: createAllowedFilesPolicy(),
      forbiddenImports: createForbiddenImportsPolicy(),
      worktreePath: directory,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("forbidden file"))).toBe(true);
  });

  it("rejects direct fetch in UI files when content is present", async () => {
    const file = "src/features/reservation/ui/reservation-list.tsx";
    await mkdir(path.join(directory, "src/features/reservation/ui"), { recursive: true });
    await writeFile(path.join(directory, file), "export const load = () => fetch('/api');\n");

    const result = await validateDesignUiAgentResult({
      result: baseResult({
        changedFiles: [file],
      }),
      allowedFiles: createAllowedFilesPolicy(),
      forbiddenImports: createForbiddenImportsPolicy(),
      worktreePath: directory,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("must not call fetch"))).toBe(true);
  });
});

function baseResult(input: { changedFiles: string[] }) {
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION,
    id: "ar_11111111111111111111111111111111",
    runId: "run_11111111111111111111111111111111",
    kind: "implementation",
    agent: "design-ui",
    status: "passed",
    baseSha: "abcdef1",
    commitSha: "1234567",
    changedFiles: input.changedFiles,
    evidenceIds: [],
    artifactIds: [],
    gapIds: [],
    checks: [],
    decisions: [],
    startedAt: "2026-06-23T00:00:00.000Z",
    completedAt: "2026-06-23T00:00:01.000Z",
  };
}
