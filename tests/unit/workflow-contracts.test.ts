import { describe, expect, it } from "vitest";

import { RUN_STAGE_NAMES } from "../../src/run/stages.js";
import {
  AGENT_ROLES,
  IMPLEMENTATION_AGENT_ROLES,
  VERIFICATION_AGENT_ROLES,
} from "../../src/runtime/constants.js";
import {
  ReviewSubmissionSchema,
  WorkflowResumeContextSchema,
  WorkflowSubmissionSchema,
} from "../../src/workflow/index.js";

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

  it("bounds every compact resume-context dimension", () => {
    expect(
      WorkflowResumeContextSchema.safeParse({
        goal: "Continue the feature",
        evidencePaths: ["x".repeat(1_001)],
        submissions: [],
      }).success,
    ).toBe(false);
  });

  it("requires executable artifacts for passed implementation submissions", () => {
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

  it("requires concrete API types, schemas, wrappers, mocks, and contract tests", () => {
    const paths = [
      "generated/api.ts",
      "generated/schema.ts",
      "generated/wrapper.ts",
      "generated/mock.ts",
      "test-results/api-contract.json",
    ];
    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "api-ready",
        status: "passed",
        summary: "API contract surface and mocks are ready.",
        implementationContextId: "ctx_checkout_01",
        artifactPaths: paths,
        apiArtifacts: {
          types: [paths[0]],
          schemas: [paths[1]],
          wrappers: [paths[2]],
          mocks: [paths[3]],
          contractTests: [paths[4]],
        },
      }).success,
    ).toBe(true);

    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "api-ready",
        status: "passed",
        summary: "Mocks are only claimed.",
        implementationContextId: "ctx_checkout_01",
        artifactPaths: ["generated/mock.ts"],
        apiArtifacts: {
          types: [],
          schemas: [],
          wrappers: [],
          mocks: ["generated/mock.ts"],
          contractTests: [],
        },
      }).success,
    ).toBe(false);

    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "api-ready",
        status: "passed",
        summary: "One file is reused as every API artifact.",
        implementationContextId: "ctx_checkout_01",
        artifactPaths: ["generated/all.ts"],
        apiArtifacts: {
          types: ["generated/all.ts"],
          schemas: ["generated/all.ts"],
          wrappers: ["generated/all.ts"],
          mocks: ["generated/all.ts"],
          contractTests: ["generated/all.ts"],
        },
      }).success,
    ).toBe(false);
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

  it("requires structured passing gate results for approved reviews", () => {
    expect(
      ReviewSubmissionSchema.safeParse({
        kind: "functional-review",
        verdict: "approved",
        summary: "Functional checks passed.",
        findings: [],
        requirements: [{ id: "parser", verdict: "accepted" }],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [
          {
            id: "functional",
            status: "failed",
            evidencePaths: ["test-results/unit.json"],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      ReviewSubmissionSchema.safeParse({
        kind: "functional-review",
        verdict: "approved",
        summary: "Functional checks passed.",
        findings: [],
        requirements: [],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [
          {
            id: "functional",
            status: "passed",
            evidencePaths: ["test-results/unit.json"],
          },
        ],
      }).success,
    ).toBe(false);
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

  it("rejects broad E2E selectors and multiple feature videos", () => {
    const base = {
      kind: "implementation",
      status: "passed",
      summary: "Feature implemented.",
      apiReady: true,
      implementationContextId: "ctx_checkout_01",
      uiChanged: true,
      changedFiles: ["src/checkout.tsx"],
      artifactPaths: ["results.json", "checkout.webm"],
    };

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        featureEvidence: {
          scope: "targeted-feature",
          testSelector: "e2e",
          testCommand: "playwright test e2e",
          resultPath: "results.json",
          videoPath: "checkout.webm",
        },
      }).success,
    ).toBe(false);

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        featureEvidence: {
          scope: "targeted-feature",
          testSelector: "e2e/checkout.spec.ts",
          testCommand: "playwright test e2e/checkout.spec.ts e2e/admin.spec.ts",
          resultPath: "results.json",
          videoPath: "checkout.webm",
        },
      }).success,
    ).toBe(false);

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        featureEvidence: {
          scope: "targeted-feature",
          testSelector: "e2e/checkout.spec.ts",
          testCommand: "echo e2e/checkout.spec.ts && playwright test",
          resultPath: "results.json",
          videoPath: "checkout.webm",
        },
      }).success,
    ).toBe(false);

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        artifactPaths: ["results.json", "checkout.webm", "retry.webm"],
        featureEvidence: {
          scope: "targeted-feature",
          testSelector: "e2e/checkout.spec.ts",
          testCommand: "playwright test e2e/checkout.spec.ts",
          resultPath: "results.json",
          videoPath: "checkout.webm",
        },
      }).success,
    ).toBe(false);

    for (const forbiddenOption of ["--list", "--pass-with-no-tests"]) {
      expect(
        WorkflowSubmissionSchema.safeParse({
          ...base,
          featureEvidence: {
            scope: "targeted-feature",
            testSelector: "e2e/checkout.spec.ts",
            testCommand: `playwright test e2e/checkout.spec.ts ${forbiddenOption}`,
            resultPath: "results.json",
            videoPath: "checkout.webm",
          },
        }).success,
      ).toBe(false);
    }
  });

  it("requires one explicit Figma manifest and PNG evidence", () => {
    const base = {
      kind: "figma-bundle",
      provider: "host-connected-figma",
      capturedAt: "2026-07-13T00:00:00.000Z",
      fileUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
      nodeIds: ["1:2"],
      manifestPath: "figma/design-context.json",
    };

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        artifactPaths: ["figma/design-context.json", "visual/checkout.png"],
      }).success,
    ).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        artifactPaths: ["figma/design-context.json", "visual/checkout.svg"],
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        manifestPath: "figma/missing.json",
        artifactPaths: ["figma/design-context.json", "visual/checkout.png"],
      }).success,
    ).toBe(false);
  });
});
