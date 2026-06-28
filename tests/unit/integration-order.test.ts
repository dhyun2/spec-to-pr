import { describe, expect, it } from "vitest";

import { buildIntegrationCandidates } from "../../src/integration/integration-order.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/index.js";

describe("integration order", () => {
  it("orders approved implementation results deterministically", () => {
    const candidates = buildIntegrationCandidates({
      approvedAgentResultIds: [
        "ar_22222222222222222222222222222222",
        "ar_11111111111111111111111111111111",
      ],
      agentResults: [
        {
          schemaVersion: RUNTIME_CONTRACT_VERSION,
          id: "ar_22222222222222222222222222222222",
          runId: "run_11111111111111111111111111111111",
          kind: "implementation",
          agent: "design-ui",
          status: "passed",
          baseSha: "abcdef1",
          commitSha: "2222222",
          changedFiles: ["src/ui.tsx"],
          evidenceIds: [],
          artifactIds: [],
          gapIds: [],
          checks: [],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
        {
          schemaVersion: RUNTIME_CONTRACT_VERSION,
          id: "ar_11111111111111111111111111111111",
          runId: "run_11111111111111111111111111111111",
          kind: "implementation",
          agent: "api-contract",
          status: "passed",
          baseSha: "abcdef1",
          commitSha: "1111111",
          changedFiles: ["src/api.ts"],
          evidenceIds: [],
          artifactIds: [],
          gapIds: [],
          checks: [],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
      ],
    });

    expect(candidates.map((candidate) => candidate.agent)).toEqual([
      "api-contract",
      "design-ui",
    ]);
  });
});
