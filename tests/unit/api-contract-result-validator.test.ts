import { describe, expect, it } from "vitest";

import type { ApiContractAgentContext } from "../../src/api-agent/api-contract-agent-contracts.js";
import { validateApiContractAgentResult } from "../../src/api-agent/api-contract-result-validator.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/constants.js";

const context: ApiContractAgentContext = {
  runId: "run_11111111111111111111111111111111",
  preparedAt: "2026-06-23T00:00:00.000Z",
  projectRoot: "/repo",
  worktreePath: "/worktree/api",
  baseSha: "abcdef1",
  contextPackPath: "/context",
  allowedWriteGlobs: ["apps/*/src/features/**/api/**"],
  forbiddenWriteGlobs: ["apps/*/src/features/**/ui/**"],
  openApiIntakeArtifactIds: [],
  apiPipelineArtifactIds: [],
  traceabilityArtifactIds: [],
  testMatrixArtifactIds: [],
  evidenceIds: [],
  gapIds: [],
  instructions: [],
};

describe("API Contract Agent result validator", () => {
  it("accepts API implementation changes inside allowed globs", () => {
    const result = validateApiContractAgentResult({
      context,
      result: {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_11111111111111111111111111111111",
        runId: context.runId,
        kind: "implementation",
        agent: "api-contract",
        status: "passed",
        baseSha: "abcdef1",
        commitSha: "1234567",
        changedFiles: ["apps/rangepro/src/features/reservation/api/fetch-reservations.ts"],
        evidenceIds: [],
        artifactIds: [],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
    });

    expect(result.valid).toBe(true);
  });

  it("rejects UI file changes", () => {
    const result = validateApiContractAgentResult({
      context,
      result: {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_11111111111111111111111111111111",
        runId: context.runId,
        kind: "implementation",
        agent: "api-contract",
        status: "passed",
        baseSha: "abcdef1",
        commitSha: "1234567",
        changedFiles: ["apps/rangepro/src/features/reservation/ui/ReservationList.tsx"],
        evidenceIds: [],
        artifactIds: [],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("forbidden"))).toBe(true);
  });
});
