import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import * as figmaContract from "../../src/figma/figma-capture-contract.js";

function geometry(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "figma-capture-geometry-v2",
    provider: "host-connected-figma-native-export",
    nodeId: "2558:4382",
    state: "available",
    captureKind: "full-frame",
    logicalSize: { width: 360, height: 1831 },
    exportScale: 1,
    bitmapSize: { width: 360, height: 1831 },
    colorSpace: "srgb",
    ...overrides,
  };
}

function validateGeometry(overrides: Record<string, unknown> = {}) {
  return figmaContract.assertFigmaCaptureGeometry({
    geometry: geometry(overrides) as never,
    target: { nodeId: "2558:4382", state: "available" },
    viewport: { width: 360, height: 1831 },
    decodedSize: (overrides.bitmapSize as { width: number; height: number } | undefined) ?? {
      width: 360,
      height: 1831,
    },
  } as never);
}

describe("Figma capture geometry", () => {
  it("keeps historical v1 geometry readable but requires reacquisition for comparison", () => {
    const historical = {
      nodeId: "2558:4382",
      captureKind: "full-frame",
      logicalSize: { width: 360, height: 1831 },
      exportScale: 1,
      bitmapSize: { width: 360, height: 1831 },
      colorSpace: "srgb",
    };

    expect(figmaContract.FigmaCaptureGeometrySchema.safeParse(historical).success).toBe(true);
    expect(() =>
      figmaContract.assertFigmaCaptureGeometry({
        geometry: historical,
        target: { nodeId: "2558:4382", state: "available" },
        viewport: { width: 360, height: 1831 },
        decodedSize: { width: 360, height: 1831 },
      } as never),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_REACQUISITION_REQUIRED/);
  });

  it("rejects a 202x1024 thumbnail declared for a logical 360x1831 frame", () => {
    expect(() =>
      validateGeometry({
        logicalSize: { width: 360, height: 1831 },
        bitmapSize: { width: 202, height: 1024 },
        exportScale: 202 / 360,
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*native/i);
  });

  it("rejects uniform downscaling even when the bitmap otherwise matches scale", () => {
    expect(() =>
      validateGeometry({
        logicalSize: { width: 100, height: 100 },
        bitmapSize: { width: 56, height: 56 },
        exportScale: 0.56,
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*native/i);
  });

  it("rejects unequal X and Y scale", () => {
    expect(() =>
      validateGeometry({
        bitmapSize: { width: 720, height: 1831 },
        exportScale: 2,
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*uniform/i);
  });

  it("rejects aspect-ratio drift", () => {
    expect(() =>
      validateGeometry({
        bitmapSize: { width: 720, height: 3663 },
        exportScale: 2,
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*aspect ratio/i);
  });

  it("rejects decoded PNG dimensions that disagree with the manifest", () => {
    expect(() =>
      figmaContract.assertFigmaCaptureGeometry({
        geometry: geometry() as never,
        target: { nodeId: "2558:4382", state: "available" },
        viewport: { width: 360, height: 1831 },
        decodedSize: { width: 202, height: 1024 },
      } as never),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*decoded PNG/i);
  });

  it("rejects the wrong target node ID", () => {
    expect(() =>
      figmaContract.assertFigmaCaptureGeometry({
        geometry: geometry() as never,
        target: { nodeId: "2558:9999", state: "available" },
        viewport: { width: 360, height: 1831 },
        decodedSize: { width: 360, height: 1831 },
      } as never),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*node/i);
  });

  it("rejects the wrong target state", () => {
    expect(() =>
      figmaContract.assertFigmaCaptureGeometry({
        geometry: geometry() as never,
        target: { nodeId: "2558:4382", state: "unavailable" },
        viewport: { width: 360, height: 1831 },
        decodedSize: { width: 360, height: 1831 },
      } as never),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*state/i);
  });

  it.each([
    [1, { width: 360, height: 1831 }],
    [2, { width: 720, height: 3662 }],
  ])("accepts a native %sx export", (exportScale, bitmapSize) => {
    expect(
      validateGeometry({
        exportScale,
        bitmapSize,
      }),
    ).toEqual({
      scaleX: exportScale,
      scaleY: exportScale,
      aspectRatioDelta: 0,
    });
  });
});

describe("Figma state facts", () => {
  it("computes a canonical digest over state authority fields and validates tampering", () => {
    const digestFunction = Reflect.get(figmaContract, "figmaStateFactsDigest");
    const schema = Reflect.get(figmaContract, "FigmaStateContractSchema");
    expect(typeof digestFunction).toBe("function");
    expect(schema).toBeDefined();
    if (typeof digestFunction !== "function" || schema === undefined) return;

    const facts = [
      { id: "parking", kind: "text" as const, subject: "주차", value: "가능" },
      { id: "money", kind: "visibility" as const, subject: "G패스 머니", value: true },
      {
        id: "cinema",
        kind: "variant" as const,
        subject: "CINEMA 4K",
        value: "available",
      },
    ];
    const canonical = {
      targetId: "shop-available",
      nodeId: "2558:4382",
      state: "available",
      fixtureId: "fixture:shop-available",
      facts: [...facts].sort((left, right) => left.id.localeCompare(right.id)),
      requiredAssertions: [
        {
          id: "assert-state-facts",
          kind: "interaction" as const,
          selector: "[data-state-facts]",
          subject: "state facts",
          action: "click" as const,
          expected: true,
        },
      ],
      designBindingIds: [],
    };
    const expected = `sha256:${createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex")}`;
    const digest = digestFunction({
      ...canonical,
      facts: [...facts].reverse(),
    });
    expect(digest).toBe(expected);
    expect(schema.safeParse({ ...canonical, digest }).success).toBe(true);
    expect(
      schema.safeParse({
        ...canonical,
        facts: canonical.facts.map((fact) =>
          fact.id === "parking" ? { ...fact, value: "불가" } : fact,
        ),
        digest,
      }).success,
    ).toBe(false);
  });
});
