import { describe, expect, it } from "vitest";

import { isMaskedPixel } from "../../src/visual/image-mask.js";

describe("isMaskedPixel", () => {
  it("matches pixels inside explicit mask regions", () => {
    const masks = [
      {
        name: "current-time-anchor",
        x: 0,
        y: 10,
        width: 20,
        height: 4,
        reason: "Dynamic current-time marker",
      },
    ];

    expect(isMaskedPixel({ x: 5, y: 12, masks })).toBe(true);
    expect(isMaskedPixel({ x: 25, y: 12, masks })).toBe(false);
  });
});
