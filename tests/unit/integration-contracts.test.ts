import { describe, expect, it } from "vitest";

import {
  IntegrationPlanSchema,
  IntegrationResultSchema,
} from "../../src/integration/integration-contracts.js";

describe("integration contracts", () => {
  it("models an integration plan and result", () => {
    const plan = IntegrationPlanSchema.parse({
      runId: "run_11111111111111111111111111111111",
      status: "planned",
      strategy: "cherry-pick",
      baseCommit: "abcdef1",
      integrationBranch: "spec-to-pr/111111111111/integration",
      integrationWorktreePath: "/tmp/project/.spec-to-pr/worktrees/run_1/integration",
      candidates: [
        {
          agentResultId: "ar_11111111111111111111111111111111",
          agent: "api-contract",
          commitSha: "1111111",
          baseSha: "abcdef1",
          order: 1,
          approvedByReviewCouncil: true,
          changedFiles: ["src/features/reservation/api/fetch-reservations.ts"],
        },
      ],
      maxRepairAttempts: 2,
      createdAt: "2026-06-23T00:00:00.000Z",
    });

    const result = IntegrationResultSchema.parse({
      runId: plan.runId,
      status: "passed",
      integrationBranch: plan.integrationBranch,
      integrationWorktreePath: plan.integrationWorktreePath,
      headSha: "1111111",
      appliedCandidates: plan.candidates,
      skippedCandidates: [],
      conflictReportArtifactIds: [],
      repairAttempts: [],
      artifactIds: [],
      gapIds: [],
      startedAt: plan.createdAt,
      completedAt: "2026-06-23T00:00:01.000Z",
    });

    expect(result.appliedCandidates).toHaveLength(1);
  });
});
