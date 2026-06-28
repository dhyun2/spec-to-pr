import { describe, expect, it } from "vitest";

import {
  parseAssetsFromText,
  parseCodeConnectMap,
  parseComponentsFromText,
  parseTokensFromText,
} from "../../src/figma/figma-raw-parser.js";

describe("Figma raw parser", () => {
  it("extracts component-like nodes", () => {
    const components = parseComponentsFromText(
      '<node id="1:2" name="Button / Primary" type="INSTANCE" />',
    );

    expect(components).toHaveLength(1);
    expect(components[0]?.name).toContain("Button");
  });

  it("extracts variable-like tokens", () => {
    const tokens = parseTokensFromText("variable color/primary variable spacing/4");

    expect(tokens.map((token) => token.kind)).toContain("color");
    expect(tokens.map((token) => token.kind)).toContain("spacing");
  });

  it("extracts asset-like nodes", () => {
    const assets = parseAssetsFromText('<node id="2:3" name="Search Icon" />');

    expect(assets[0]?.kind).toBe("icon");
  });

  it("parses code connect json mapping", () => {
    const map = parseCodeConnectMap(
      JSON.stringify({
        nodeId: "1:2",
        componentName: "Button",
        source: "@/shared/ui/button",
      }),
    );

    expect(map.get("1:2")?.componentName).toBe("Button");
  });
});
