import { describe, expect, it } from "vitest";

import { normalizeFigmaNodeId, parseFigmaUrl } from "../../src/figma/figma-url.js";

describe("Figma URL parser", () => {
  it("parses design URLs with node-id", () => {
    const parsed = parseFigmaUrl("https://www.figma.com/design/abc123/Product?node-id=238-941");

    expect(parsed.kind).toBe("design");
    expect(parsed.fileKey).toBe("abc123");
    expect(parsed.nodeId).toBe("238:941");
  });

  it("normalizes colon node ids", () => {
    expect(normalizeFigmaNodeId("238:941")).toBe("238:941");
  });

  it("rejects URLs without node-id", () => {
    expect(() => parseFigmaUrl("https://www.figma.com/design/abc123/Product")).toThrow(/node-id/);
  });
});
