import { describe, expect, it } from "vitest";

import { createInitialRun } from "../../src/run/index.js";
import {
  buildTraceLinks,
  buildTraceNodes,
  detectTraceabilityGaps,
} from "../../src/traceability/index.js";

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const briefSourceId = "src_11111111111111111111111111111111";
const apiSourceId = "src_22222222222222222222222222222222";
const figmaSourceId = "src_33333333333333333333333333333333";
const instructionSourceId = "src_44444444444444444444444444444444";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function createRunWithEvidence() {
  const run = createInitialRun(
    {
      sources: [
        {
          id: briefSourceId,
          kind: "brief",
          locator: {
            type: "file",
            path: "docs/brief.md",
          },
          digest,
          capturedAt: now,
          metadata: {},
        },
        {
          id: apiSourceId,
          kind: "openapi",
          locator: {
            type: "file",
            path: "docs/openapi.yaml",
          },
          digest,
          capturedAt: now,
          metadata: {},
        },
        {
          id: figmaSourceId,
          kind: "figma",
          locator: {
            type: "figma",
            url: "https://www.figma.com/design/abc/Product?node-id=238-941",
            fileKey: "abc",
            nodeId: "238:941",
          },
          digest,
          capturedAt: now,
          metadata: {},
        },
      ],
    },
    {
      id: runId,
      pluginVersion: "0.1.0",
      projectRoot: "/tmp/project",
      now,
    },
  );

  run.evidence.push(
    {
      id: "ev_11111111111111111111111111111111",
      sourceId: briefSourceId,
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 10,
        endLine: 10,
      },
      summary: "Reservations list should be shown",
      excerpt: "Reservations list should be shown.",
      digest,
      capturedAt: now,
      metadata: {
        adapter: "brief-adapter-v1",
        sourceDigest: digest,
        itemType: "requirement",
        headingPath: ["Reservations"],
      },
    },
    {
      id: "ev_22222222222222222222222222222222",
      sourceId: apiSourceId,
      location: {
        type: "json-pointer",
        document: "docs/openapi.yaml",
        pointer: "/paths/~1reservations/get",
      },
      summary: "GET /reservations (fetchReservations)",
      digest,
      capturedAt: now,
      metadata: {
        adapter: "openapi-intake-v1",
        sourceDigest: digest,
        evidenceType: "openapi-operation",
      },
    },
    {
      id: "ev_33333333333333333333333333333333",
      sourceId: figmaSourceId,
      location: {
        type: "figma-node",
        fileKey: "abc",
        nodeId: "238:941",
      },
      summary: "Reservations list screen",
      digest,
      capturedAt: now,
      metadata: {
        adapter: "figma-intake-v1",
        sourceDigest: digest,
      },
    },
  );

  return run;
}

describe("traceability", () => {
  it("builds nodes from brief openapi and figma evidence", () => {
    const nodes = buildTraceNodes(createRunWithEvidence());

    expect(nodes.requirementNodes).toHaveLength(1);
    expect(nodes.apiNodes).toHaveLength(1);
    expect(nodes.figmaNodes).toHaveLength(1);
  });

  it("builds requirement and API nodes from structured instruction evidence", () => {
    const run = createRunWithEvidence();
    run.sources.push({
      id: instructionSourceId,
      kind: "instruction",
      locator: {
        type: "inline",
        label: "user-request",
        mediaType: "text/plain; charset=utf-8",
      },
      digest,
      capturedAt: now,
      metadata: {},
    });
    run.evidence.push(
      {
        id: "ev_44444444444444444444444444444444",
        sourceId: instructionSourceId,
        location: {
          type: "inline-text",
          label: "user-request",
          startLine: 1,
          endLine: 2,
        },
        summary: "Original user request captured for deterministic intake.",
        excerpt:
          "레슨권 등록 화면에서 GET /members로 회원 검색 후 POST /members/{userNo}로 등록한다.",
        digest,
        capturedAt: now,
        metadata: {
          parserVersion: "intake-request-parser-v1",
          itemType: "instruction",
        },
      },
      {
        id: "ev_55555555555555555555555555555555",
        sourceId: instructionSourceId,
        location: {
          type: "inline-text",
          label: "user-request",
          startLine: 1,
          endLine: 1,
        },
        summary: "레슨권 등록 화면에서 회원 검색 후 등록한다.",
        excerpt: "레슨권 등록 화면에서 회원 검색 후 등록한다.",
        digest,
        capturedAt: now,
        metadata: {
          parserVersion: "intake-request-parser-v1",
          itemType: "requirement",
          sourceKind: "instruction",
        },
      },
      {
        id: "ev_66666666666666666666666666666666",
        sourceId: instructionSourceId,
        location: {
          type: "inline-text",
          label: "user-request",
          startLine: 1,
          endLine: 1,
        },
        summary: "GET /members",
        excerpt: "GET /members",
        digest,
        capturedAt: now,
        metadata: {
          parserVersion: "intake-request-parser-v1",
          itemType: "api",
          evidenceType: "openapi-operation",
          openapiEvidenceKind: "operation",
          method: "get",
          path: "/members",
        },
      },
    );

    const nodes = buildTraceNodes(run);
    const instructionRequirement = nodes.requirementNodes.find((node) =>
      node.evidenceIds.includes("ev_55555555555555555555555555555555"),
    );
    const wholePromptRequirement = nodes.requirementNodes.find((node) =>
      node.evidenceIds.includes("ev_44444444444444444444444444444444"),
    );
    const inlineApiNode = nodes.apiNodes.find((node) =>
      node.evidenceIds.includes("ev_66666666666666666666666666666666"),
    );

    expect(instructionRequirement).toMatchObject({
      kind: "requirement",
      summary: "레슨권 등록 화면에서 회원 검색 후 등록한다.",
      metadata: expect.objectContaining({
        itemType: "requirement",
        sourceKind: "instruction",
      }),
    });
    expect(wholePromptRequirement).toBeUndefined();
    expect(inlineApiNode).toMatchObject({
      kind: "api-operation",
      label: "GET /members",
      metadata: expect.objectContaining({
        method: "get",
        path: "/members",
      }),
    });
  });

  it("links requirement to API and Figma candidates", () => {
    const nodes = buildTraceNodes(createRunWithEvidence());
    const links = buildTraceLinks(nodes);

    expect(links.edges.some((edge) => edge.kind === "matches-api")).toBe(true);
    expect(links.edges.some((edge) => edge.kind === "matches-figma")).toBe(true);
  });

  it("creates traceability gaps for missing links", () => {
    const run = createRunWithEvidence();
    run.evidence = run.evidence.filter(
      (evidence) => evidence.metadata["evidenceType"] !== "openapi-operation",
    );

    const nodes = buildTraceNodes(run);
    const links = buildTraceLinks(nodes);
    const gaps = detectTraceabilityGaps({
      requirementNodes: nodes.requirementNodes,
      apiNodes: nodes.apiNodes,
      figmaNodes: nodes.figmaNodes,
      edges: links.edges,
      now,
    });

    expect(gaps.gaps.some((gap) => gap.category === "api")).toBe(true);
    expect(gaps.matrix[0]?.status).toMatch(/missing-api/);
  });

  it("keeps generated gap titles within runtime limits for long requirements", () => {
    const run = createRunWithEvidence();
    run.evidence = run.evidence.filter(
      (evidence) => evidence.metadata["evidenceType"] !== "openapi-operation",
    );
    const requirement = run.evidence.find(
      (evidence) => evidence.metadata["itemType"] === "requirement",
    );

    expect(requirement).toBeDefined();
    requirement!.summary = [
      "Users can filter shops by region, brand, benefit, map position, delivery support,",
      "reservation availability, operating hours, partner grade, and campaign exposure",
      "while preserving the selected state across navigation and refresh",
    ].join(" ");
    requirement!.excerpt = requirement!.summary;

    const nodes = buildTraceNodes(run);
    const links = buildTraceLinks(nodes);
    const gaps = detectTraceabilityGaps({
      requirementNodes: nodes.requirementNodes,
      apiNodes: nodes.apiNodes,
      figmaNodes: nodes.figmaNodes,
      edges: links.edges,
      now,
    });

    expect(gaps.gaps.length).toBeGreaterThan(0);
    expect(gaps.gaps.every((gap) => gap.title.length <= 200)).toBe(true);
  });
});
