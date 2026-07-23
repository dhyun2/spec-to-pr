import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { normalizeVisualPng } from "../../src/visual/visual-normalizer.js";

describe("visual normalizer", () => {
  it("deterministically resizes and composites alpha onto white", async () => {
    const source = solidPng(2, 2, [255, 0, 0, 128]);

    const first = await normalizeVisualPng({
      content: source,
      sourceSize: { width: 2, height: 2 },
      logicalSize: { width: 4, height: 4 },
      colorSpace: "srgb",
      role: "Figma baseline",
    });
    const second = await normalizeVisualPng({
      content: source,
      sourceSize: { width: 2, height: 2 },
      logicalSize: { width: 4, height: 4 },
      colorSpace: "srgb",
      role: "Figma baseline",
    });

    expect(first).toMatchObject({
      width: 4,
      height: 4,
      version: "visual-normalizer-v1",
    });
    expect(first.content.equals(second.content)).toBe(true);
    const decoded = PNG.sync.read(first.content);
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 127, 127, 255]);
  });

  it("rejects source dimensions that disagree with decoded pixels", async () => {
    await expect(
      normalizeVisualPng({
        content: solidPng(2, 2, [0, 0, 0, 255]),
        sourceSize: { width: 3, height: 2 },
        logicalSize: { width: 4, height: 4 },
        colorSpace: "srgb",
        role: "Figma baseline",
      }),
    ).rejects.toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*decoded/);
  });
});

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0];
    image.data[offset + 1] = rgba[1];
    image.data[offset + 2] = rgba[2];
    image.data[offset + 3] = rgba[3];
  }
  return PNG.sync.write(image);
}
