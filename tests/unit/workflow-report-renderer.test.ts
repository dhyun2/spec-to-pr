import { describe, expect, it } from "vitest";

import { WorkflowReportMetadataSchema } from "../../src/pr-report/pr-report-model.js";
import {
  renderBlockedWorkflowReport,
  renderReadyWorkflowReport,
} from "../../src/pr-report/workflow-report-renderer.js";

const READY_REPORT_GOLDEN = `# SpecToPR Run run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

## Decision

Ready for draft review.

## Review packet

- ID: packet_checkout_01
- Revision: 7
- Base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- Head: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
- Evidence digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
- Diff digest: sha256:2222222222222222222222222222222222222222222222222222222222222222

## Project guidance

### Explicit

- docs/architecture/ARCHITECTURE.md

### Automatically discovered

- AGENTS.md

## Applied optional skills

- react-best-practices
- api-generator

## Requirement traceability

| Requirement | Acceptance criteria | Review verdict |
| --- | --- | --- |
| checkout-submit: Submit checkout | The order is submitted. | accepted, accepted |

## Focused legacy baseline

- Scope: checkout parser
- passed: \`pnpm test\` → test-results/legacy.json

## Changed files

- src/checkout.tsx
- tests/checkout.test.tsx

## Evidence

- contracts/requirements.json
- test-results/checkout.json
- visual/diff.png

## Validation gates

- functional-review/functional: passed (test-results/checkout.json)
- design-review/accessibility: passed (visual/diff.png)

## Risks

- minor: Keep an eye on narrow viewports

## Feature E2E video

- test-results/checkout.mp4
`;

const BLOCKED_REPORT_GOLDEN = `# SpecToPR Run run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

## Decision

Blocked. Diagnostic report only.

## Blocker

- Stage: implementation
- Kind: missing-tool
- Code: MISSING_TOOL
- Retryable: no
- Resumable: yes
- Summary: Cannot read [project-root]/config.json with token&#61;[REDACTED] available.

## Completed work

- intake stage passed.
- Contracts saved under [project-root]/contracts.

## Evidence

- contracts/requirements.json

## Attempted recovery

- authorization: [REDACTED]

## Unrun validations

- functional
- accessibility

## Exact unblock action

Set password&#61;[REDACTED] and AWS_SECRET_ACCESS_KEY&#61;[REDACTED] in [project-root]/.env and resume implementation.
`;

describe("workflow report renderer", () => {
  it("preserves the ready workflow report byte-for-byte", () => {
    const report = renderReadyWorkflowReport({
      runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reviewPacket: {
        id: "packet_checkout_01",
        revision: 7,
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        evidenceDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        diffDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        changedFiles: ["src/checkout.tsx", "tests/checkout.test.tsx"],
      },
      guidanceTrace: {
        explicit: ["docs/architecture/ARCHITECTURE.md"],
        discovered: ["AGENTS.md"],
        skillHints: ["react-best-practices"],
        appliedSkills: ["api-generator", "react-best-practices"],
      },
      requirementManifest: [
        {
          id: "checkout-submit",
          title: "Submit checkout",
          acceptanceCriteria: ["The order is submitted."],
        },
      ],
      legacyBaseline: {
        scope: "checkout parser",
        checks: [
          {
            status: "passed",
            command: "pnpm test",
            resultPath: "test-results/legacy.json",
          },
        ],
      },
      evidencePaths: [
        "contracts/requirements.json",
        "test-results/checkout.json",
        "visual/diff.png",
      ],
      reviews: [
        {
          kind: "functional-review",
          requirements: [{ id: "checkout-submit", verdict: "accepted" }],
          gateResults: [
            {
              id: "functional",
              status: "passed",
              evidencePaths: ["test-results/checkout.json"],
            },
          ],
          findings: [],
        },
        {
          kind: "design-review",
          requirements: [{ id: "checkout-submit", verdict: "accepted" }],
          gateResults: [
            {
              id: "accessibility",
              status: "passed",
              evidencePaths: ["visual/diff.png"],
            },
          ],
          findings: [{ severity: "minor", title: "Keep an eye on narrow viewports" }],
        },
      ],
      featureVideoPath: "test-results/checkout.mp4",
    });

    expect(report).toBe(READY_REPORT_GOLDEN);
  });

  it("renders a complete blocked diagnostic and redacts project roots and secrets", () => {
    const report = renderBlockedWorkflowReport({
      runId: "run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      projectRoot: "/Users/alice/private/app",
      blocker: {
        stage: "implementation",
        kind: "missing-tool",
        code: "MISSING_TOOL",
        retryable: false,
        resumable: true,
        summary: "Cannot read /Users/alice/private/app/config.json with token=topsecret available.",
        completedWork: [
          "intake stage passed.",
          "Contracts saved under /Users/alice/private/app/contracts.",
        ],
        evidencePaths: ["contracts/requirements.json"],
        attemptedRecovery: ["authorization: Bearer abc.def.ghi"],
        unrunValidations: ["functional", "accessibility"],
        exactUnblockAction:
          "Set password=hunter2 and AWS_SECRET_ACCESS_KEY=aws-secret-value in /Users/alice/private/app/.env and resume implementation.",
      },
    });

    expect(report).toBe(BLOCKED_REPORT_GOLDEN);
    expect(report).not.toContain("/Users/alice/private/app");
    expect(report).not.toContain("topsecret");
    expect(report).not.toContain("abc.def.ghi");
    expect(report).not.toContain("hunter2");
    expect(report).not.toContain("aws-secret-value");
  });

  it("keeps every blocked diagnostic section explicit when no details were recorded", () => {
    const report = renderBlockedWorkflowReport({
      runId: "run_cccccccccccccccccccccccccccccccc",
      projectRoot: "/workspace/project",
      blocker: {
        stage: "functional-review",
        kind: "verification",
        code: "VERIFICATION_BLOCKED",
        retryable: true,
        resumable: true,
        summary: "Verification requires attention.",
        completedWork: [],
        evidencePaths: [],
        attemptedRecovery: [],
        unrunValidations: [],
        exactUnblockAction: "Rerun functional review.",
      },
    });

    expect(report.match(/- None recorded\./g)).toHaveLength(4);
  });

  it("redacts complete Authorization values and URI userinfo", () => {
    const report = renderBlockedWorkflowReport({
      runId: "run_dddddddddddddddddddddddddddddddd",
      projectRoot: "/workspace/project",
      blocker: {
        stage: "publish",
        kind: "publish-precondition",
        code: "PUBLISH_PRECONDITION",
        retryable: false,
        resumable: true,
        summary: "Publisher credentials were rejected.",
        completedWork: [],
        evidencePaths: [],
        attemptedRecovery: [
          "Authorization: Basic dXNlcjpwYXNz",
          'Authorization: Digest username="alice", response="secret-response"',
          "Fetched https://alice:p@ss@example.com/private and postgres://db:pw@db.example/app",
        ],
        unrunValidations: [],
        exactUnblockAction: "Configure credentials and retry publish.",
      },
    });

    for (const secret of ["dXNlcjpwYXNz", "alice", "secret-response", "p@ss", "db:pw"]) {
      expect(report).not.toContain(secret);
    }
    expect(report.match(/Authorization: \[REDACTED\]/g)).toHaveLength(2);
    expect(report).toContain("https://[REDACTED]@example.com/private");
    expect(report).toContain("postgres://[REDACTED]@db.example/app");
  });

  it("neutralizes Markdown and HTML in every blocked free-text field", () => {
    const report = renderBlockedWorkflowReport({
      runId: "run_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      projectRoot: "/workspace/project",
      blocker: {
        stage: "design-review",
        kind: "verification",
        code: "VERIFICATION_BLOCKED",
        retryable: false,
        resumable: true,
        summary: "# Forged heading\n<script>alert(1)</script> [link](https://evil.example)",
        completedWork: ["- forged list item"],
        evidencePaths: ["reports/[artifact](javascript:alert(1)).json"],
        attemptedRecovery: ["<!-- forged comment -->"],
        unrunValidations: ["1. forged ordered item"],
        exactUnblockAction: "> forged quote\n## forged action heading",
      },
    });

    expect(report.match(/^## [^\n]+$/gm)).toEqual([
      "## Decision",
      "## Blocker",
      "## Completed work",
      "## Evidence",
      "## Attempted recovery",
      "## Unrun validations",
      "## Exact unblock action",
    ]);
    for (const activeMarkup of [
      "# Forged heading",
      "<script>",
      "</script>",
      "[link](",
      "- - forged list item",
      "[artifact](",
      "<!--",
      "1. forged ordered item",
      "\n> forged quote",
      "## forged action heading",
    ]) {
      expect(report).not.toContain(activeMarkup);
    }
    expect(report).toContain("&#35; Forged heading");
    expect(report).toContain("&#60;script&#62;");
    expect(report).toContain("&#91;link&#93;&#40;");
    expect(report).toContain("&#45; forged list item");
    expect(report).toContain("1&#46; forged ordered item");
  });

  it("keeps workflow report intent and decision metadata consistent", () => {
    expect(
      WorkflowReportMetadataSchema.parse({
        reportKind: "pr-body-markdown",
        reportIntent: "ready",
        decision: "ready",
      }),
    ).toEqual({
      reportKind: "pr-body-markdown",
      reportIntent: "ready",
      decision: "ready",
    });
    expect(
      WorkflowReportMetadataSchema.parse({
        reportKind: "pr-body-markdown",
        reportIntent: "blocked-diagnostic",
        decision: "blocked",
      }),
    ).toEqual({
      reportKind: "pr-body-markdown",
      reportIntent: "blocked-diagnostic",
      decision: "blocked",
    });
    expect(
      WorkflowReportMetadataSchema.safeParse({
        reportKind: "pr-body-markdown",
        reportIntent: "blocked-diagnostic",
        decision: "ready",
      }).success,
    ).toBe(false);
  });
});
