import { describe, expect, it } from "vitest";

import { assertFigmaCaptureGeometry } from "../../src/figma/figma-capture-contract.js";

describe("Figma capture geometry", () => {
  it("rejects a downscaled host thumbnail declared as the browser viewport", () => {
    expect(() =>
      assertFigmaCaptureGeometry({
        geometry: {
          nodeId: "2558:4382",
          captureKind: "full-frame",
          logicalSize: { width: 360, height: 1824 },
          exportScale: 1024 / 1824,
          bitmapSize: { width: 202, height: 1024 },
          colorSpace: "srgb",
        },
        viewport: { width: 202, height: 1024 },
        decodedSize: { width: 202, height: 1024 },
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*logical 360x1824/);
  });

  it("accepts an explicitly scaled export when browser geometry stays logical", () => {
    expect(() =>
      assertFigmaCaptureGeometry({
        geometry: {
          nodeId: "2558:4382",
          captureKind: "full-frame",
          logicalSize: { width: 360, height: 1824 },
          exportScale: 1024 / 1824,
          bitmapSize: { width: 202, height: 1024 },
          colorSpace: "srgb",
        },
        viewport: { width: 360, height: 1824 },
        decodedSize: { width: 202, height: 1024 },
      }),
    ).not.toThrow();
  });

  it("rejects decoded PNG dimensions that disagree with the manifest", () => {
    expect(() =>
      assertFigmaCaptureGeometry({
        geometry: {
          nodeId: "2558:4382",
          captureKind: "full-frame",
          logicalSize: { width: 360, height: 1824 },
          exportScale: 1,
          bitmapSize: { width: 360, height: 1824 },
          colorSpace: "srgb",
        },
        viewport: { width: 360, height: 1824 },
        decodedSize: { width: 202, height: 1024 },
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*decoded PNG/);
  });

  it("rejects a bitmap that cannot be produced by the declared export scale", () => {
    expect(() =>
      assertFigmaCaptureGeometry({
        geometry: {
          nodeId: "2558:4382",
          captureKind: "full-frame",
          logicalSize: { width: 360, height: 1824 },
          exportScale: 1,
          bitmapSize: { width: 202, height: 1024 },
          colorSpace: "srgb",
        },
        viewport: { width: 360, height: 1824 },
        decodedSize: { width: 202, height: 1024 },
      }),
    ).toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*export scale/);
  });
});
