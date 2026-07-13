import { describe, expect, it } from "vitest";

import { RUN_STAGE_NAMES } from "../../src/run/stages.js";
import {
  AGENT_ROLES,
  IMPLEMENTATION_AGENT_ROLES,
  VERIFICATION_AGENT_ROLES,
} from "../../src/runtime/constants.js";
import { ReviewSubmissionSchema, WorkflowSubmissionSchema } from "../../src/workflow/index.js";

describe("workflow v2 contracts", () => {
  it("uses the eight coarse durable stages", () => {
    expect(RUN_STAGE_NAMES).toEqual([
      "intake",
      "contracts",
      "implementation",
      "functional-review",
      "design-review",
      "report",
      "publish",
      "archive",
    ]);
  });

  it("uses one implementation role and two reviewer roles", () => {
    expect(IMPLEMENTATION_AGENT_ROLES).toEqual(["implementation"]);
    expect(VERIFICATION_AGENT_ROLES).toEqual(["functional-reviewer", "design-reviewer"]);
    expect(AGENT_ROLES).toEqual([
      "orchestrator",
      "implementation",
      "functional-reviewer",
      "design-reviewer",
      "pr-publisher",
    ]);
  });

  it("requires the API-ready checkpoint for UI implementation submissions", () => {
    const result = WorkflowSubmissionSchema.safeParse({
      kind: "implementation",
      status: "passed",
      summary: "Implemented the API client and UI.",
      uiChanged: true,
      apiReady: false,
      changedFiles: ["src/page.tsx"],
      artifactPaths: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects approved reviews with major findings", () => {
    const result = ReviewSubmissionSchema.safeParse({
      kind: "functional-review",
      verdict: "approved",
      summary: "A major contract issue remains.",
      findings: [
        {
          severity: "major",
          title: "Contract mismatch",
          evidence: ["tests/contract.test.ts"],
        },
      ],
      requirements: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects approved reviews with blocked requirements", () => {
    const result = ReviewSubmissionSchema.safeParse({
      kind: "design-review",
      verdict: "approved",
      summary: "A required state is blocked.",
      findings: [],
      requirements: [{ id: "empty-state", verdict: "blocked" }],
    });

    expect(result.success).toBe(false);
  });

  it("requires concrete artifacts for passed submissions", () => {
    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "contracts",
        status: "passed",
        summary: "Contracts generated.",
        artifactPaths: [],
      }).success,
    ).toBe(false);

    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "implementation",
        status: "passed",
        summary: "Implementation completed.",
        apiReady: true,
        uiChanged: false,
        changedFiles: ["src/parser.ts"],
        artifactPaths: [],
      }).success,
    ).toBe(false);

    expect(
      ReviewSubmissionSchema.safeParse({
        kind: "functional-review",
        verdict: "approved",
        summary: "Review passed.",
        findings: [],
        requirements: [{ id: "parser", verdict: "accepted" }],
        artifactPaths: [],
      }).success,
    ).toBe(false);
  });
});
