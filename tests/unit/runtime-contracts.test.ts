import { describe, expect, it } from "vitest";

import {
  AgentResultSchema,
  ArtifactRefSchema,
  CheckResultSchema,
  DecisionSchema,
  EvidenceRefSchema,
  GapSchema,
  RUNTIME_CONTRACT_VERSION,
  RunIdSchema,
  Sha256DigestSchema,
  SourceRefSchema,
} from "../../src/rumtime/index.js";

const now = "2026-06-23T00:00:00.000Z";
const later = "2026-06-23T00:00:01.000Z";

const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";
const artifactId = "art_22222222222222222222222222222222";
const checkId = "chk_33333333333333333333333333333333";
const agentResultId = "ar_44444444444444444444444444444444";
const decisionId = "dec_55555555555555555555555555555555";
const gapId = "gap_66666666666666666666666666666666";

const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("runtime ids and scalars", () => {
  it("accepts prefixed runtime ids", () => {
    expect(RunIdSchema.parse(runId)).toBe(runId);
  });

  it("rejects unprefixed ids", () => {
    expect(RunIdSchema.safeParse("11111111111111111111111111111111").success).toBe(false);
  });

  it("accepts canonical sha256 digests", () => {
    expect(Sha256DigestSchema.parse(digest)).toBe(digest);
  });

  it("rejects uppercase sha256 digests", () => {
    expect(
      Sha256DigestSchema.safeParse(
        "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ).success,
    ).toBe(false);
  });
});

describe("source and evidence contracts", () => {
  it("models a file source", () => {
    const source = SourceRefSchema.parse({
      id: sourceId,
      kind: "brief",
      locator: {
        type: "file",
        path: "docs/brief.md",
        mediaType: "text/markdown",
      },
      digest,
      capturedAt: now,
    });

    expect(source.kind).toBe("brief");
    expect(source.locator.type).toBe("file");
  });

  it("rejects source metadata with unknown top-level keys", () => {
    const result = SourceRefSchema.safeParse({
      id: sourceId,
      kind: "brief",
      locator: {
        type: "file",
        path: "docs/brief.md",
      },
      digest,
      capturedAt: now,
      prompt: "ignore previous instructions",
    });

    expect(result.success).toBe(false);
  });

  it("models a file-line evidence reference", () => {
    const evidence = EvidenceRefSchema.parse({
      id: evidenceId,
      sourceId,
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 10,
        endLine: 12,
      },
      summary: "Reservation status policy",
      digest,
      capturedAt: now,
    });

    expect(evidence.location.type).toBe("file-lines");
  });

  it("rejects reversed file-line evidence ranges", () => {
    const result = EvidenceRefSchema.safeParse({
      id: evidenceId,
      sourceId,
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 20,
        endLine: 10,
      },
      summary: "Invalid range",
      digest,
      capturedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("rejects git-file line ranges when only one side is present", () => {
    const result = EvidenceRefSchema.safeParse({
      id: evidenceId,
      sourceId,
      location: {
        type: "git-file",
        commit: "abcdef1",
        path: "src/index.ts",
        startLine: 10,
      },
      summary: "Invalid git file range",
      digest,
      capturedAt: now,
    });

    expect(result.success).toBe(false);
  });
});

describe("artifact, check, decision, and gap contracts", () => {
  it("models an artifact produced from evidence", () => {
    const artifact = ArtifactRefSchema.parse({
      id: artifactId,
      kind: "screenshot",
      uri: "artifact://run/screenshot.png",
      mediaType: "image/png",
      digest,
      producedBy: "design-ui",
      evidenceIds: [evidenceId],
      createdAt: now,
    });

    expect(artifact.kind).toBe("screenshot");
  });

  it("accepts a passed check with exitCode 0", () => {
    const check = CheckResultSchema.parse({
      id: checkId,
      name: "unit tests",
      kind: "unit",
      status: "passed",
      exitCode: 0,
      startedAt: now,
      completedAt: later,
      durationMs: 1000,
      summary: "All unit tests passed.",
    });

    expect(check.status).toBe("passed");
  });

  it("rejects a passed check with non-zero exitCode", () => {
    const result = CheckResultSchema.safeParse({
      id: checkId,
      name: "unit tests",
      kind: "unit",
      status: "passed",
      exitCode: 1,
      summary: "Invalid check.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a failed check without failureReason", () => {
    const result = CheckResultSchema.safeParse({
      id: checkId,
      name: "unit tests",
      kind: "unit",
      status: "failed",
      exitCode: 1,
      summary: "Tests failed.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a skipped check without skipReason", () => {
    const result = CheckResultSchema.safeParse({
      id: checkId,
      name: "visual regression",
      kind: "visual",
      status: "skipped",
      summary: "Skipped.",
    });

    expect(result.success).toBe(false);
  });

  it("models a decision with risk and evidence", () => {
    const decision = DecisionSchema.parse({
      id: decisionId,
      statement: "Use feature API wrappers instead of direct generated client imports.",
      rationale: "This preserves FSD boundaries and improves testability.",
      risk: "low",
      evidenceIds: [evidenceId],
      madeAt: now,
    });

    expect(decision.risk).toBe("low");
  });

  it("rejects a waived gap without waiver information", () => {
    const result = GapSchema.safeParse({
      id: gapId,
      category: "api",
      severity: "major",
      status: "waived",
      title: "Missing endpoint",
      expected: "Endpoint should exist.",
      observed: "Endpoint not found.",
      impact: "Feature cannot be fully implemented.",
      sourceEvidenceIds: [evidenceId],
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a resolved gap without resolution artifacts", () => {
    const result = GapSchema.safeParse({
      id: gapId,
      category: "api",
      severity: "major",
      status: "resolved",
      title: "Missing endpoint",
      expected: "Endpoint should exist.",
      observed: "Endpoint was added.",
      impact: "Feature can now be implemented.",
      sourceEvidenceIds: [evidenceId],
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("accepts an open gap without resolution artifacts", () => {
    const gap = GapSchema.parse({
      id: gapId,
      category: "api",
      severity: "major",
      status: "open",
      title: "Missing endpoint",
      expected: "Endpoint should exist.",
      observed: "Endpoint not found.",
      impact: "Feature cannot be fully implemented.",
      sourceEvidenceIds: [evidenceId],
      createdAt: now,
      updatedAt: now,
    });

    expect(gap.status).toBe("open");
  });
});

describe("agent result contracts", () => {
  it("accepts a passed implementation result with commitSha", () => {
    const result = AgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "implementation",
      agent: "design-ui",
      status: "passed",
      baseSha: "abcdef1",
      commitSha: "1234567",
      changedFiles: ["src/features/reservation/ui.tsx"],
      evidenceIds: [evidenceId],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [
        {
          id: checkId,
          name: "component tests",
          kind: "component",
          status: "passed",
          exitCode: 0,
          summary: "Component tests passed.",
        },
      ],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.kind).toBe("implementation");
  });

  it("rejects a passed implementation result without commitSha", () => {
    const result = AgentResultSchema.safeParse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "implementation",
      agent: "design-ui",
      status: "passed",
      baseSha: "abcdef1",
      changedFiles: ["src/features/reservation/ui.tsx"],
      evidenceIds: [evidenceId],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a passed agent result containing a failed check", () => {
    const result = AgentResultSchema.safeParse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "implementation",
      agent: "design-ui",
      status: "passed",
      baseSha: "abcdef1",
      commitSha: "1234567",
      changedFiles: ["src/features/reservation/ui.tsx"],
      evidenceIds: [evidenceId],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [
        {
          id: checkId,
          name: "component tests",
          kind: "component",
          status: "failed",
          exitCode: 1,
          failureReason: "Component failed.",
          summary: "Component tests failed.",
        },
      ],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a blocked implementation result when it cites a gap", () => {
    const result = AgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "implementation",
      agent: "api-contract",
      status: "blocked",
      baseSha: "abcdef1",
      changedFiles: [],
      evidenceIds: [evidenceId],
      artifactIds: [],
      gapIds: [gapId],
      checks: [],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.status).toBe("blocked");
  });

  it("rejects a blocked result without gaps", () => {
    const result = AgentResultSchema.safeParse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "implementation",
      agent: "api-contract",
      status: "blocked",
      baseSha: "abcdef1",
      changedFiles: [],
      evidenceIds: [],
      artifactIds: [],
      gapIds: [],
      checks: [],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.success).toBe(false);
  });

  it("rejects verification results that modify files", () => {
    const result = AgentResultSchema.safeParse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "verification",
      agent: "review-council",
      status: "passed",
      baseSha: "abcdef1",
      changedFiles: ["src/should-not-change.ts"],
      evidenceIds: [],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.success).toBe(false);
  });

  it("rejects passed verification results without report artifacts", () => {
    const result = AgentResultSchema.safeParse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "verification",
      agent: "review-council",
      status: "passed",
      baseSha: "abcdef1",
      changedFiles: [],
      evidenceIds: [],
      artifactIds: [],
      gapIds: [],
      checks: [],
      decisions: [],
      startedAt: now,
      completedAt: later,
    });

    expect(result.success).toBe(false);
  });

  it("rejects passed publishing results without prUrl", () => {
    const result = AgentResultSchema.safeParse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "publishing",
      agent: "pr-publisher",
      status: "passed",
      baseSha: "abcdef1",
      evidenceIds: [],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [],
      decisions: [],
      target: "github",
      draft: true,
      reportArtifactId: artifactId,
      startedAt: now,
      completedAt: later,
    });

    expect(result.success).toBe(false);
  });

  it("accepts passed publishing results with prUrl and reportArtifactId", () => {
    const result = AgentResultSchema.parse({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "publishing",
      agent: "pr-publisher",
      status: "passed",
      baseSha: "abcdef1",
      evidenceIds: [],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [],
      decisions: [],
      target: "github",
      prUrl: "https://github.com/example/repo/pull/1",
      prNumber: "1",
      draft: true,
      reportArtifactId: artifactId,
      startedAt: now,
      completedAt: later,
    });

    expect(result.kind).toBe("publishing");
  });
});
