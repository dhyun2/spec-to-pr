import { describe, expect, it } from "vitest";

import {
  buildAgentContextPack,
  renderAgentContextMarkdown,
} from "../../src/agent-runtime/context-pack.js";
import { getAgentDescriptor } from "../../src/agent-runtime/agent-descriptor.js";
import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { GapSchema } from "../../src/runtime/gap.js";
import { EvidenceRefSchema, SourceRefSchema } from "../../src/runtime/source.js";

const now = "2026-06-28T00:00:00.000Z";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";

describe("agent context pack", () => {
  it("scopes API agents to API artifacts, evidence, and gaps", () => {
    const run = buildRunFixture();
    const pack = buildAgentContextPack({
      run,
      descriptor: getAgentDescriptor("api-contract"),
      generatedAt: now,
      baseCommit: "abcdef1",
    });

    expect(pack.agent.agent).toBe("api-contract");
    expect(pack.baseCommit).toBe("abcdef1");
    expect(pack.artifacts.map((artifact) => artifact.kind)).toEqual([
      "openapi-intake-report",
      "api-contract-report",
      "test-matrix",
    ]);
    expect(pack.evidence.map((evidence) => evidence.id)).toEqual([evidenceId]);
    expect(pack.gaps.map((gap) => gap.category)).toEqual(["api"]);
  });

  it("renders context packs as agent-readable Markdown", () => {
    const run = buildRunFixture();
    const pack = buildAgentContextPack({
      run,
      descriptor: getAgentDescriptor("design-ui"),
      generatedAt: now,
    });

    const markdown = renderAgentContextMarkdown(pack);

    expect(markdown).toContain("# Design/UI Agent Context Pack");
    expect(markdown).toContain("## Write Policy");
    expect(markdown).toContain("Use project design-system components");
  });
});

function buildRunFixture() {
  const source = SourceRefSchema.parse({
    id: sourceId,
    kind: "brief",
    locator: {
      type: "file",
      path: "docs/brief.md",
    },
    digest,
    capturedAt: now,
  });
  const evidence = EvidenceRefSchema.parse({
    id: evidenceId,
    sourceId,
    location: {
      type: "file-lines",
      path: "docs/brief.md",
      startLine: 1,
      endLine: 2,
    },
    summary: "Reservation list must be visible.",
    digest,
    capturedAt: now,
  });
  const artifacts = [
    "openapi-intake-report",
    "api-contract-report",
    "test-matrix",
    "figma-design-contract",
  ].map((kind, index) =>
    ArtifactRefSchema.parse({
      id: `art_${String(index + 1).repeat(32)}`,
      kind,
      uri: `repo://artifact-${index}.json`,
      mediaType: "application/json",
      digest,
      producedBy: "orchestrator",
      evidenceIds: [evidenceId],
      createdAt: now,
    }),
  );
  const gap = GapSchema.parse({
    id: "gap_11111111111111111111111111111111",
    category: "api",
    severity: "major",
    status: "open",
    title: "Missing error schema",
    expected: "The API should describe error responses.",
    observed: "The OpenAPI source omits response schemas.",
    impact: "Contract tests need review.",
    sourceEvidenceIds: [evidenceId],
    createdAt: now,
    updatedAt: now,
  });

  return RunManifestSchema.parse({
    ...createInitialRun(
      {
        sources: [source],
        baseCommit: "abcdef1",
      },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot: "/tmp/project",
        now,
      },
    ),
    evidence: [evidence],
    artifacts,
    gaps: [gap],
  });
}
