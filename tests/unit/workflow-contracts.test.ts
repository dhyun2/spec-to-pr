import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  WorkflowStartInputSchema,
  buildParserSafeChunks,
} from "../../src/application/workflow-service.js";
import { RUN_STAGE_NAMES } from "../../src/run/stages.js";
import {
  AGENT_ROLES,
  IMPLEMENTATION_AGENT_ROLES,
  VERIFICATION_AGENT_ROLES,
} from "../../src/runtime/constants.js";
import { canonicalizeFileContent } from "../../src/source-registry/canonical-content.js";
import {
  BlockerKindSchema,
  ReviewSubmissionSchema,
  ContractsSubmissionSchema,
  DeliveryProfileSchema,
  GuidanceTraceSchema,
  ImplementationReviewPacketSchema,
  VisualLineageOutcomeV2Schema,
  VisualRepairEvidenceV2Schema,
  WorkflowActionSchema,
  WorkflowBlockerSchema,
  WorkflowResumeContextSchema,
  WorkflowSubmissionSchema,
} from "../../src/workflow/index.js";

describe("workflow v2 contracts", () => {
  it("versions rich visual repair actions without fabricating legacy artifact evidence", () => {
    const runId = `run_${"a".repeat(32)}`;
    const reviewPacketId = `packet_${"b".repeat(64)}`;
    const lineageId = `packet_${"c".repeat(64)}`;
    const repairEvidenceArtifactId = `art_${"d".repeat(32)}`;

    expect(
      WorkflowActionSchema.parse({
        kind: "implementation-repair",
        repairEvidenceVersion: "v2",
        runId,
        reviewPacketId,
        lineageId,
        nextAttempt: 2,
        failedTargets: [{ targetId: "shop-default", reviewMatchRatio: 0.87 }],
        repairEvidenceArtifactId,
      }),
    ).toMatchObject({ repairEvidenceVersion: "v2", repairEvidenceArtifactId });

    const legacy = WorkflowActionSchema.parse({
      kind: "implementation-repair",
      repairEvidenceVersion: "legacy-v1",
      runId,
      reviewPacketId,
      lineageId,
      nextAttempt: 2,
      failedTargets: [{ targetId: "shop-default", reviewMatchRatio: 0.87 }],
    });
    expect(legacy).toMatchObject({ repairEvidenceVersion: "legacy-v1" });
    expect(legacy).not.toHaveProperty("repairEvidenceArtifactId");
  });

  it("binds rich visual repair evidence to the immutable implementation head", () => {
    const evidence = {
      schemaVersion: "visual-repair-evidence-v2",
      runId: `run_${"a".repeat(32)}`,
      lineageId: `packet_${"b".repeat(64)}`,
      reviewPacketId: `packet_${"c".repeat(64)}`,
      headSha: "d".repeat(40),
      rendererLineageId: `sha256:${"e".repeat(64)}`,
      attempt: 1,
      generatedAt: "2026-07-28T00:00:00.000Z",
      failedTargets: [
        {
          targetId: "shop-default",
          name: "Shop",
          route: "/shop",
          state: "default",
          fixture: "mock:shop",
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
          metrics: {
            width: 1280,
            height: 720,
            comparedPixelCount: 921_600,
            maskedPixelCount: 0,
            maskedAreaRatio: 0,
            exactMatchRatio: 0.8,
            reviewMatchRatio: 0.87,
            meanDistance: 0.04,
            maxDistance: 0.2,
            pixelTolerance: 0.02,
            threshold: 0.92,
          },
          diffArtifactId: `art_${"e".repeat(32)}`,
          overlayArtifactId: `art_${"f".repeat(32)}`,
          captureSummary: {
            provider: "playwright",
            browser: "chromium 138",
            fontsReady: true,
            assetsReady: true,
          },
          causeHints: ["implementation"],
        },
      ],
    } as const;

    expect(VisualRepairEvidenceV2Schema.parse(evidence)).toMatchObject({
      reviewPacketId: evidence.reviewPacketId,
      headSha: evidence.headSha,
      attempt: 1,
    });
    const { headSha: _headSha, ...unbound } = evidence;
    expect(VisualRepairEvidenceV2Schema.safeParse(unbound).success).toBe(false);
  });

  it("binds closed visual lineage outcomes to the committed renderer lineage", () => {
    const outcome = {
      schemaVersion: "visual-repair-lineage-v2",
      runId: `run_${"a".repeat(32)}`,
      lineageId: `packet_${"b".repeat(64)}`,
      reviewPacketId: `packet_${"c".repeat(64)}`,
      headSha: "d".repeat(40),
      rendererLineageId: `sha256:${"e".repeat(64)}`,
      attempt: 1,
      generatedAt: "2026-07-28T00:00:00.000Z",
      status: "closed",
    } as const;

    expect(VisualLineageOutcomeV2Schema.parse(outcome)).toEqual(outcome);
  });

  it("defines the bounded strict workflow blocker contract", () => {
    const blocker = {
      stage: "implementation",
      code: "MISSING_BROWSER",
      kind: "missing-tool",
      summary: "A browser runtime is unavailable.",
      retryable: false,
      resumable: true,
      completedWork: ["Contracts were accepted."],
      evidencePaths: ["test-results/browser-check.json"],
      attemptedRecovery: ["Checked the project-local browser installation."],
      unrunValidations: ["targeted-feature-e2e"],
      exactUnblockAction: "Install the project browser runtime and resume implementation.",
    } as const;

    expect(BlockerKindSchema.options).toEqual([
      "missing-input",
      "missing-tool",
      "policy",
      "verification",
      "publish-precondition",
      "budget-split",
      "unexpected",
    ]);
    expect(WorkflowBlockerSchema.parse(blocker)).toEqual(blocker);
    expect(WorkflowBlockerSchema.safeParse({ ...blocker, secret: "do not store" }).success).toBe(
      false,
    );
    expect(
      WorkflowBlockerSchema.safeParse({ ...blocker, transcript: ["raw prompt"] }).success,
    ).toBe(false);
    expect(
      WorkflowBlockerSchema.safeParse({
        ...blocker,
        completedWork: Array.from({ length: 21 }, (_, index) => `step ${index}`),
      }).success,
    ).toBe(false);
    expect(
      WorkflowBlockerSchema.safeParse({
        ...blocker,
        evidencePaths: ["/Users/private/project/result.json"],
      }).success,
    ).toBe(false);
    for (const unsafePath of [
      String.raw`C:\private\result.json`,
      "C:relative-result.json",
      String.raw`\rooted\result.json`,
      String.raw`\\server\share\result.json`,
      "../outside.json",
      "test-results/token=ghp_1234567890abcdef.json",
      String.raw`proof\GITHUB_TOKEN=ghp_1234567890abcdef.txt`,
      "proof/GITHUB_TOKEN%253Dghp_1234567890abcdef.txt",
      "proof/x-GITHUB_TOKEN=ghp_1234567890abcdef.txt",
      "proof/(GITHUB_TOKEN=ghp_1234567890abcdef).txt",
      "proof/GITHUB_TOKEN%2525253Dghp_1234567890abcdef.txt",
      "proof/GITHUB_TOKEN-abcdef1234567890.txt",
      "proof/password-supersecretvalue.txt",
      "proof/token-abcdef1234567890.txt",
      "token-validation.json/leak.txt",
      "logs/Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.log",
      "reports/https://user:password@example.com/result.json",
      "evidence/github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ.txt",
    ]) {
      expect(
        WorkflowBlockerSchema.safeParse({ ...blocker, evidencePaths: [unsafePath] }).success,
      ).toBe(false);
    }
    for (const safePath of [
      "test-results/token-validation.json",
      "docs/credential-rotation-guide.md",
      "reports/authorization-errors.json",
      "artifacts/.coverage-summary.json",
    ]) {
      expect(
        WorkflowBlockerSchema.safeParse({ ...blocker, evidencePaths: [safePath] }).success,
      ).toBe(true);
    }
    expect(
      WorkflowBlockerSchema.safeParse({ ...blocker, exactUnblockAction: "x".repeat(1_001) })
        .success,
    ).toBe(false);
  });

  it("accepts optional typed blockers only for unsuccessful stage submissions", () => {
    const blocker = {
      stage: "contracts",
      code: "MISSING_APPROVAL",
      kind: "missing-input",
      summary: "A required approval is missing.",
      retryable: false,
      resumable: true,
      completedWork: [],
      evidencePaths: [],
      attemptedRecovery: [],
      unrunValidations: ["functional"],
      exactUnblockAction: "Provide the approval and resubmit contracts.",
    } as const;
    const failedContracts = {
      kind: "contracts",
      status: "blocked",
      summary: "Waiting for approval.",
      blocker,
    } as const;

    expect(WorkflowSubmissionSchema.safeParse(failedContracts).success).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "contracts",
        status: "blocked",
        summary: "Older payload without a typed blocker.",
      }).success,
    ).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "contracts",
        status: "passed",
        summary: "Contracts passed.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: [
          { id: "approval", title: "Approval", acceptanceCriteria: ["Approval is recorded."] },
        ],
        blocker,
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "implementation",
        status: "failed",
        summary: "Implementation failed.",
        apiReady: false,
        uiChanged: false,
        blocker: { ...blocker, stage: "implementation", kind: "unexpected" },
      }).success,
    ).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        kind: "functional-review",
        reviewPacketId: `packet_${"a".repeat(64)}`,
        verdict: "blocked",
        summary: "Verification is blocked.",
        blocker: { ...blocker, stage: "functional-review", kind: "verification" },
      }).success,
    ).toBe(true);
  });

  it("bounds composable source arrays and preserves legacy singular source inputs", () => {
    const base = {
      projectRoot: "/tmp/example",
      requestText: "Implement checkout",
    };

    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        docsPath: "docs/legacy.md",
        docsPaths: ["docs/rules.md"],
        openApiPath: "docs/legacy-openapi.yaml",
        openApiPaths: ["docs/checkout-openapi.yaml"],
        guidancePaths: ["AGENTS.md"],
        skillHints: ["react-best-practices", "design-system"],
      }).success,
    ).toBe(true);

    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "brief",
        scope: "ui",
        briefPath: "briefs/checkout.md",
        figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
        openApiUrl: "https://api.example.com/docs",
      }).success,
    ).toBe(true);
    for (const openApiUrl of [
      "http://api.example.com/openapi.yaml",
      "https://user:secret@api.example.com/openapi.yaml",
      "https://api.example.com/openapi.yaml?api_key=secret",
    ]) {
      expect(
        WorkflowStartInputSchema.safeParse({
          ...base,
          openApiUrl,
        }).success,
      ).toBe(false);
    }

    for (const field of ["docsPaths", "openApiPaths", "guidancePaths", "skillHints"] as const) {
      expect(
        WorkflowStartInputSchema.safeParse({
          ...base,
          [field]: Array.from({ length: 21 }, (_, index) => `${field}-${index}`),
        }).success,
      ).toBe(false);
    }

    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        skillHints: ["../skills/react-best-practices"],
      }).success,
    ).toBe(false);

    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        briefPath: "b".repeat(1_000),
      }).success,
    ).toBe(true);
    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        briefPath: "b".repeat(1_001),
      }).success,
    ).toBe(false);
  });

  it("enforces the four canonical start contracts and UI baseline fencing", () => {
    const base = {
      projectRoot: "/tmp/target",
      requestText: "Implement checkout",
    };
    const fullSources = {
      briefPath: "briefs/checkout.md",
      figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
      openApiPaths: ["docs/openapi.yaml"],
    };

    for (const mode of ["brief", "feature"] as const) {
      expect(
        WorkflowStartInputSchema.safeParse({
          ...base,
          mode,
          scope: "ui",
          ...fullSources,
        }).success,
      ).toBe(true);
      expect(
        WorkflowStartInputSchema.safeParse({
          ...base,
          mode,
          scope: "non-ui",
          ...fullSources,
        }).success,
      ).toBe(false);
    }

    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "brief",
        briefPath: fullSources.briefPath,
      }).success,
    ).toBe(false);
    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "feature",
        ...fullSources,
        openApiPaths: [],
      }).success,
    ).toBe(false);
    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "legacy",
        scope: "ui",
      }).success,
    ).toBe(false);
    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "legacy",
        scope: "ui",
        legacyProjectRoot: "/tmp/legacy",
        legacyNetworkEvidencePath: "evidence/legacy.har",
      }).success,
    ).toBe(true);
    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "figma",
        scope: "ui",
        figmaUrl: fullSources.figmaUrl,
        legacyNetworkEvidencePath: "evidence/legacy.har",
      }).success,
    ).toBe(false);
    expect(
      WorkflowStartInputSchema.safeParse({
        ...base,
        mode: "figma",
        scope: "ui",
        figmaUrl: fullSources.figmaUrl,
      }).success,
    ).toBe(true);

    for (const scope of ["non-ui", "docs"] as const) {
      expect(
        WorkflowStartInputSchema.safeParse({
          ...base,
          scope,
          figmaUrl: fullSources.figmaUrl,
        }).success,
      ).toBe(false);
      expect(
        WorkflowStartInputSchema.safeParse({
          ...base,
          mode: "legacy",
          scope,
          legacyProjectRoot: "/tmp/legacy",
        }).success,
      ).toBe(false);
    }
  });

  it("keeps CRLF and Unicode graphemes intact across parser chunks", () => {
    const contents = [
      `${"x".repeat(10)}\r\n${"y".repeat(199_999)}`,
      `${"x".repeat(10)}e\u0301${"y".repeat(199_999)}`,
      `${"x".repeat(10)}😀${"y".repeat(199_999)}`,
    ];
    const canonicalize = (text: string) =>
      canonicalizeFileContent({
        path: "source.txt",
        mediaType: "text/plain; charset=utf-8",
        rawContent: Buffer.from(text, "utf8"),
      }).canonicalContent.toString("utf8");

    for (const content of contents) {
      const chunks = buildParserSafeChunks(content);
      expect(chunks.every((chunk) => chunk.trim().length > 0)).toBe(true);
      expect(chunks.map(canonicalize).join("")).toBe(canonicalize(content));
    }
  });

  it("uses complete Unicode grapheme boundaries for parser chunks", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const cases = [
      { name: "decomposed Hangul Jamo", sequence: "\u1100\u1161", tail: 199_999 },
      { name: "ZWJ emoji", sequence: "👩‍💻", tail: 199_997 },
      { name: "regional-indicator flag", sequence: "🇰🇷", tail: 199_998 },
    ];
    const supplementaryVariationSequence = `漢\u{e0100}`;
    if ([...segmenter.segment(supplementaryVariationSequence)].length === 1) {
      cases.push({
        name: "supplementary variation selector",
        sequence: supplementaryVariationSequence,
        tail: 199_998,
      });
    }
    const canonicalize = (text: string) =>
      canonicalizeFileContent({
        path: "source.txt",
        mediaType: "text/plain; charset=utf-8",
        rawContent: Buffer.from(text, "utf8"),
      }).canonicalContent.toString("utf8");
    const splitCases: string[] = [];
    const changedCanonicalContent: string[] = [];

    for (const item of cases) {
      const content = `${"x".repeat(10)}${item.sequence}${"y".repeat(item.tail)}`;
      const chunks = buildParserSafeChunks(content);
      const boundaries = new Set<number>([0]);
      for (const grapheme of segmenter.segment(content)) {
        boundaries.add(grapheme.index + grapheme.segment.length);
      }
      let offset = 0;
      for (const chunk of chunks.slice(0, -1)) {
        offset += chunk.length;
        if (!boundaries.has(offset)) splitCases.push(item.name);
      }
      if (chunks.map(canonicalize).join("") !== canonicalize(content)) {
        changedCanonicalContent.push(item.name);
      }
    }

    expect(splitCases).toEqual([]);
    expect(changedCanonicalContent).toEqual([]);
  });

  it("stores unique normalized source and guidance trace fields", () => {
    const profile = {
      mode: "feature",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
      docsPaths: ["docs/business-rules.md"],
      openApiPaths: ["docs/openapi.yaml"],
      guidancePaths: ["docs/architecture/ARCHITECTURE.md"],
      discoveredGuidancePaths: ["AGENTS.md"],
      skillHints: ["react-best-practices"],
      requirements: {
        brief: true,
        legacyBaseline: false,
        targetedFeatureE2E: true,
        featureVideo: true,
        figmaBundle: true,
      },
    };

    expect(DeliveryProfileSchema.safeParse(profile).success).toBe(true);
    expect(DeliveryProfileSchema.parse(profile).recommendedSkills).toEqual([]);
    expect(
      DeliveryProfileSchema.safeParse({
        ...profile,
        docsPaths: ["docs/business-rules.md", "docs/business-rules.md"],
      }).success,
    ).toBe(false);

    expect(
      ContractsSubmissionSchema.safeParse({
        kind: "contracts",
        status: "passed",
        summary: "Contracts and project guidance applied.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: [
          {
            id: "checkout",
            title: "Checkout",
            acceptanceCriteria: ["Checkout follows project guidance."],
          },
        ],
        guidanceTrace: {
          explicit: ["docs/architecture/ARCHITECTURE.md"],
          discovered: ["AGENTS.md"],
          skillHints: ["react-best-practices"],
        },
      }).success,
    ).toBe(true);
    expect(
      GuidanceTraceSchema.safeParse({
        explicit: Array.from({ length: 20 }, (_, index) => `docs/guidance-${index}.md`),
        discovered: ["AGENTS.md"],
        skillHints: [],
      }).success,
    ).toBe(false);
    expect(
      GuidanceTraceSchema.parse({ explicit: [], discovered: [], skillHints: [] }).appliedSkills,
    ).toEqual([]);
  });

  it("requires a structured requirement manifest and focused legacy baseline evidence", () => {
    const requirementManifest = [
      {
        id: "checkout-submit",
        title: "Submit checkout",
        acceptanceCriteria: ["A valid cart creates exactly one order."],
      },
    ];

    expect(
      ContractsSubmissionSchema.safeParse({
        kind: "contracts",
        status: "passed",
        summary: "Contracts generated.",
        artifactPaths: ["contracts/requirements.json"],
      }).success,
    ).toBe(false);
    expect(
      ContractsSubmissionSchema.safeParse({
        kind: "contracts",
        status: "passed",
        summary: "Contracts and focused baseline generated.",
        artifactPaths: ["contracts/requirements.json", "contracts/legacy-baseline.md"],
        requirementManifest,
        legacyBaseline: {
          scope: "checkout submission only",
          evidencePaths: ["contracts/legacy-baseline.md"],
          checks: [
            {
              command: "pnpm test -- checkout",
              resultPath: "contracts/legacy-baseline.md",
              status: "passed",
            },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      ContractsSubmissionSchema.safeParse({
        kind: "contracts",
        status: "passed",
        summary: "A failing baseline cannot authorize implementation.",
        artifactPaths: ["contracts/requirements.json", "contracts/legacy-baseline.md"],
        requirementManifest,
        legacyBaseline: {
          scope: "checkout submission only",
          evidencePaths: ["contracts/legacy-baseline.md"],
          checks: [
            {
              command: "pnpm test -- checkout",
              resultPath: "contracts/legacy-baseline.md",
              status: "failed",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a feature-scoped legacy Draft bundle only when every OpenSpec document is submitted", () => {
    const submission = {
      kind: "contracts",
      status: "passed",
      summary: "Shop migration contracts and review bundle generated.",
      artifactPaths: [
        ".spec-to-pr/shop/manifest.json",
        "openspec/changes/migrate-shop-vue3/proposal.md",
        "openspec/changes/migrate-shop-vue3/specs/shop-migration/spec.md",
        "openspec/changes/migrate-shop-vue3/tasks.md",
      ],
      requirementManifest: [
        {
          id: "shop-routing",
          title: "Shop routing",
          acceptanceCriteria: ["The migrated Shop route remains reachable."],
        },
      ],
      draftBundle: {
        manifestPath: ".spec-to-pr/shop/manifest.json",
        changeName: "migrate-shop-vue3",
        proposalPath: "openspec/changes/migrate-shop-vue3/proposal.md",
        specPaths: ["openspec/changes/migrate-shop-vue3/specs/shop-migration/spec.md"],
        tasksPath: "openspec/changes/migrate-shop-vue3/tasks.md",
      },
    } as const;

    expect(ContractsSubmissionSchema.safeParse(submission).success).toBe(true);
    expect(
      ContractsSubmissionSchema.safeParse({
        ...submission,
        artifactPaths: [submission.draftBundle.manifestPath],
      }).success,
    ).toBe(false);
  });

  it("ties review packet identity to its run and actual diff digest", () => {
    const packet = {
      id: `packet_${"a".repeat(64)}`,
      revision: 1,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      evidenceDigest: `sha256:${"c".repeat(64)}`,
    };

    expect(ImplementationReviewPacketSchema.safeParse(packet).success).toBe(false);
    expect(
      ImplementationReviewPacketSchema.safeParse({
        ...packet,
        runId: "run_11111111111111111111111111111111",
        diffDigest: `sha256:${"d".repeat(64)}`,
        changedFiles: ["src/checkout.tsx"],
      }).success,
    ).toBe(true);
  });

  it("requires every review to identify its immutable implementation packet", () => {
    const validReview = {
      kind: "functional-review",
      verdict: "approved",
      summary: "Functional checks passed.",
      findings: [],
      requirements: [{ id: "checkout-submit", verdict: "accepted" }],
      artifactPaths: ["test-results/unit.json"],
      gateResults: [
        {
          id: "functional",
          status: "passed",
          evidencePaths: ["test-results/unit.json"],
        },
      ],
    } as const;

    expect(ReviewSubmissionSchema.safeParse(validReview).success).toBe(false);
    expect(
      ReviewSubmissionSchema.safeParse({
        ...validReview,
        reviewPacketId: `packet_${"a".repeat(64)}`,
      }).success,
    ).toBe(true);
  });

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

  it("models API operation usage and labels lab versus field performance honestly", () => {
    const implementation = {
      kind: "implementation",
      status: "passed",
      summary: "Implemented and measured checkout.",
      apiReady: true,
      implementationContextId: "ctx_checkout_01",
      uiChanged: true,
      changedFiles: ["src/page.tsx"],
      artifactPaths: ["test-results/api-coverage.json", "test-results/performance.json"],
      apiCoverage: [
        {
          operationKey: "POST /checkout",
          method: "POST",
          path: "/checkout",
          operationId: "checkout",
          status: "exercised",
          productionCallSites: ["src/page.tsx#submitCheckout"],
          mockHandlers: ["generated/mock.ts#checkout"],
          executableEvidencePaths: ["test-results/api-coverage.json"],
          blocking: false,
        },
      ],
      performanceEvidence: {
        lab: {
          route: "/checkout",
          tool: "Lighthouse",
          command: "pnpm lighthouse /checkout",
          deviceProfile: "mobile",
          throttling: "simulated-4g",
          sampleCount: 3,
          resultPath: "test-results/performance.json",
          metrics: { lcpMs: 2100, cls: 0.04, tbtMs: 120 },
        },
        field: { status: "unavailable", reason: "No existing CrUX or authorized RUM source." },
      },
    };

    expect(WorkflowSubmissionSchema.safeParse(implementation).success).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...implementation,
        performanceEvidence: {
          ...implementation.performanceEvidence,
          lab: {
            ...implementation.performanceEvidence.lab,
            metrics: { lcpMs: 2100, cls: 0.04, inpMs: 120 },
          },
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

  it("requires native v2 geometry plus exact target/node/state/fixture contracts", () => {
    const stateContract = (overrides: Record<string, unknown> = {}) => {
      const fields = {
        targetId: "checkout",
        nodeId: "1:2",
        state: "default",
        fixtureId: "mock:checkout",
        facts: [
          { id: "cinema", kind: "variant", subject: "CINEMA 4K", value: "available" },
          { id: "money", kind: "visibility", subject: "G패스 머니", value: true },
          { id: "parking", kind: "text", subject: "주차", value: "가능" },
        ],
        requiredAssertionIds: ["assert-checkout-state"],
        ...overrides,
      };
      return {
        ...fields,
        digest: `sha256:${createHash("sha256")
          .update(
            JSON.stringify({
              ...fields,
              facts: [...fields.facts].sort((left, right) => left.id.localeCompare(right.id)),
              requiredAssertionIds: [...fields.requiredAssertionIds].sort(),
            }),
          )
          .digest("hex")}`,
      };
    };
    const base = {
      kind: "figma-bundle",
      provider: "host-connected-figma",
      capturedAt: "2026-07-13T00:00:00.000Z",
      fileUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
      fileUrls: ["https://www.figma.com/design/abc/file?node-id=1-2"],
      nodeIds: ["1:2"],
      capturedComponents: [],
      designMapping: {
        designSystem: {
          packageName: "@frontend/ui",
          packageVersion: "1.2.3",
          guidanceSkill: "design-system",
        },
        components: [],
        fonts: [],
        tokens: [],
      },
      manifestPath: "figma/design-context.json",
      stateContracts: [stateContract()],
      visualTargets: [
        {
          targetId: "checkout",
          name: "Checkout",
          state: "default",
          route: "/checkout",
          baselineKind: "figma",
          baselinePath: "visual/checkout.png",
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          fixture: "mock:checkout",
          figmaCapture: {
            schemaVersion: "figma-capture-geometry-v2",
            provider: "host-connected-figma-native-export",
            nodeId: "1:2",
            state: "default",
            captureKind: "viewport",
            logicalSize: { width: 1440, height: 900 },
            exportScale: 1,
            bitmapSize: { width: 1440, height: 900 },
            colorSpace: "srgb",
          },
          masks: [],
        },
      ],
      artifactPaths: ["figma/design-context.json", "visual/checkout.png"],
    };

    expect(WorkflowSubmissionSchema.safeParse(base).success).toBe(true);
    for (const nodeIds of [[], ["9:9"], ["1:2", "9:9"], ["1:2", "1:2"]]) {
      expect(WorkflowSubmissionSchema.safeParse({ ...base, nodeIds }).success).toBe(false);
    }
    for (const stateContracts of [
      [],
      [stateContract(), stateContract()],
      [stateContract({ targetId: "wrong-target" })],
      [stateContract({ nodeId: "9:9" })],
      [stateContract({ state: "selected" })],
      [stateContract({ fixtureId: "mock:reused" })],
    ]) {
      expect(WorkflowSubmissionSchema.safeParse({ ...base, stateContracts }).success).toBe(false);
    }
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        visualTargets: base.visualTargets.map((target) => ({
          ...target,
          figmaCapture: {
            nodeId: "1:2",
            captureKind: "viewport",
            logicalSize: { width: 1440, height: 900 },
            exportScale: 1,
            bitmapSize: { width: 1440, height: 900 },
            colorSpace: "srgb",
          },
        })),
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        artifactPaths: ["figma/design-context.json", "visual/checkout.svg"],
      }).success,
    ).toBe(false);
  });

  it("rejects fixture reuse, prose authority, and identical facts for different states", () => {
    const facts = [
      { id: "cinema", kind: "variant", subject: "CINEMA 4K", value: "available" },
      { id: "money", kind: "visibility", subject: "G패스 머니", value: true },
      { id: "parking", kind: "text", subject: "주차", value: "가능" },
    ];
    const contract = (
      targetId: string,
      nodeId: string,
      state: string,
      fixtureId: string,
      stateFacts: typeof facts,
    ) => {
      const fields = {
        targetId,
        nodeId,
        state,
        fixtureId,
        facts: stateFacts,
        requiredAssertionIds: [`assert-${state}`],
      };
      return {
        ...fields,
        digest: `sha256:${createHash("sha256")
          .update(
            JSON.stringify({
              ...fields,
              facts: [...stateFacts].sort((left, right) => left.id.localeCompare(right.id)),
              requiredAssertionIds: [...fields.requiredAssertionIds].sort(),
            }),
          )
          .digest("hex")}`,
      };
    };
    const target = (targetId: string, nodeId: string, state: string, fixture: string) => ({
      targetId,
      name: state,
      state,
      route: `/shop?state=${state}`,
      baselineKind: "figma",
      baselinePath: `visual/${state}.png`,
      viewport: { width: 360, height: 1831 },
      deviceScaleFactor: 1,
      fixture,
      figmaCapture: {
        schemaVersion: "figma-capture-geometry-v2",
        provider: "host-connected-figma-native-export",
        nodeId,
        state,
        captureKind: "full-frame",
        logicalSize: { width: 360, height: 1831 },
        exportScale: 1,
        bitmapSize: { width: 360, height: 1831 },
        colorSpace: "srgb",
      },
      masks: [],
    });
    const available = contract("shop-available", "1:2", "available", "fixture:available", facts);
    const unavailableFacts = facts.map((fact) =>
      fact.id === "cinema"
        ? { ...fact, value: "unavailable" }
        : fact.id === "money"
          ? { ...fact, value: false }
          : { ...fact, value: "불가" },
    );
    const unavailable = contract(
      "shop-unavailable",
      "1:3",
      "unavailable",
      "fixture:unavailable",
      unavailableFacts,
    );
    const base = {
      kind: "figma-bundle",
      provider: "host-connected-figma",
      capturedAt: "2026-07-13T00:00:00.000Z",
      fileUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
      fileUrls: [
        "https://www.figma.com/design/abc/file?node-id=1-2",
        "https://www.figma.com/design/abc/file?node-id=1-3",
      ],
      nodeIds: ["1:2", "1:3"],
      capturedComponents: [],
      designMapping: {
        designSystem: { packageName: "@frontend/ui", packageVersion: "1.2.3" },
        components: [],
        fonts: [],
        tokens: [],
      },
      manifestPath: "figma/design-context.json",
      stateContracts: [available, unavailable],
      visualTargets: [
        target("shop-available", "1:2", "available", "fixture:available"),
        target("shop-unavailable", "1:3", "unavailable", "fixture:unavailable"),
      ],
      artifactPaths: [
        "figma/design-context.json",
        "visual/available.png",
        "visual/unavailable.png",
      ],
    };

    expect(WorkflowSubmissionSchema.safeParse(base).success).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        stateContracts: [
          available,
          contract("shop-unavailable", "1:3", "unavailable", "fixture:available", unavailableFacts),
        ],
        visualTargets: [
          base.visualTargets[0],
          target("shop-unavailable", "1:3", "unavailable", "fixture:available"),
        ],
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        stateContracts: [
          available,
          {
            ...unavailable,
            prose: "Only CINEMA 4K differs.",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        stateContracts: [
          available,
          contract("shop-unavailable", "1:3", "unavailable", "fixture:unavailable", facts),
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only visual captures and never caller-supplied scores or decisions", () => {
    const reviewPacketId = `packet_${"a".repeat(64)}`;
    const submission = {
      kind: "visual-comparison",
      reviewPacketId,
      captures: [
        {
          targetId: "checkout",
          route: "/checkout",
          state: "default",
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          fixture: "mock:checkout",
          provider: "playwright",
          capturedAt: "2026-07-20T00:00:00.000Z",
          actualPath: `visual/actual/${reviewPacketId}/checkout.png`,
          actualDigest: `sha256:${"1".repeat(64)}`,
        },
      ],
      artifactPaths: [`visual/actual/${reviewPacketId}/checkout.png`],
    };

    expect(WorkflowSubmissionSchema.safeParse(submission).success).toBe(true);
    const receiptPath = `visual/actual/${reviewPacketId}/checkout.json`;
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        captures: [
          {
            ...submission.captures[0],
            receiptPath,
            receiptDigest: `sha256:${"2".repeat(64)}`,
          },
        ],
        artifactPaths: [...submission.artifactPaths, receiptPath],
      }).success,
    ).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        captures: [{ ...submission.captures[0], receiptPath }],
        artifactPaths: [...submission.artifactPaths, receiptPath],
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        reviewMatchRatio: 1,
        verdict: "passed",
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        captures: submission.captures.map(({ provider: _provider, ...capture }) => capture),
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        captures: submission.captures.map(({ capturedAt: _capturedAt, ...capture }) => capture),
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        captures: submission.captures.map(({ actualDigest: _actualDigest, ...capture }) => capture),
      }).success,
    ).toBe(false);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...submission,
        captures: [{ ...submission.captures[0], actualPath: "visual/baseline.png" }],
        artifactPaths: ["visual/baseline.png"],
      }).success,
    ).toBe(false);
  });

  it("requires unique JSON mock fixtures distinct from the manifest", () => {
    const base = {
      kind: "implementation",
      status: "passed",
      summary: "Implemented deterministic design data.",
      apiReady: false,
      uiChanged: true,
      changedFiles: ["src/view.tsx"],
      artifactPaths: ["test-results/unit.json", "mocks/manifest.json", "mocks/view.json"],
    };

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        mockDataEvidence: {
          manifestPath: "mocks/manifest.json",
          fixturePaths: ["mocks/view.json"],
        },
      }).success,
    ).toBe(true);
    for (const fixturePaths of [
      ["mocks/view.ts"],
      ["mocks/view.json", "mocks/view.json"],
      ["mocks/manifest.json"],
    ]) {
      expect(
        WorkflowSubmissionSchema.safeParse({
          ...base,
          artifactPaths: ["test-results/unit.json", "mocks/manifest.json", ...fixturePaths],
          mockDataEvidence: { manifestPath: "mocks/manifest.json", fixturePaths },
        }).success,
      ).toBe(false);
    }
  });

  it("accepts unique named fixtures and rejects duplicate fixture IDs", () => {
    const base = {
      kind: "implementation",
      status: "passed",
      summary: "Implemented deterministic Figma states.",
      apiReady: false,
      uiChanged: true,
      changedFiles: ["src/view.tsx"],
      artifactPaths: [
        "test-results/unit.json",
        "mocks/manifest.json",
        "mocks/available.json",
        "mocks/selected.json",
      ],
    };

    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        mockDataEvidence: {
          manifestPath: "mocks/manifest.json",
          fixtures: [
            { id: "shop:available", path: "mocks/available.json" },
            { id: "shop:selected", path: "mocks/selected.json" },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      WorkflowSubmissionSchema.safeParse({
        ...base,
        mockDataEvidence: {
          manifestPath: "mocks/manifest.json",
          fixtures: [
            { id: "shop:available", path: "mocks/available.json" },
            { id: "shop:available", path: "mocks/selected.json" },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
