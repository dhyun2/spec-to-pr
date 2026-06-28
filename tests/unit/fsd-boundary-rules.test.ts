import { describe, expect, it } from "vitest";

import { evaluateFsdImport } from "../../src/architecture/fsd-boundary-rules.js";

describe("FSD boundary rules", () => {
  it("rejects upward imports", () => {
    const violations = evaluateFsdImport({
      index: 0,
      source: {
        absolutePath: "/repo/src/entities/reservation/model.ts",
        relativePath: "src/entities/reservation/model.ts",
        layer: "entities",
        slice: "reservation",
        segment: "model",
        publicApi: false,
      },
      target: {
        absolutePath: "/repo/src/features/create-reservation/index.ts",
        relativePath: "src/features/create-reservation/index.ts",
        layer: "features",
        slice: "create-reservation",
        publicApi: true,
      },
      sourceImport: {
        kind: "import",
        specifier: "@/features/create-reservation",
        line: 1,
        column: 1,
      },
    });

    expect(violations.some((item) => item.kind === "fsd-upward-import")).toBe(true);
  });

  it("rejects cross-slice deep imports", () => {
    const violations = evaluateFsdImport({
      index: 0,
      source: {
        absolutePath: "/repo/src/features/a/ui/a.tsx",
        relativePath: "src/features/a/ui/a.tsx",
        layer: "features",
        slice: "a",
        segment: "ui",
        publicApi: false,
      },
      target: {
        absolutePath: "/repo/src/features/b/ui/b.tsx",
        relativePath: "src/features/b/ui/b.tsx",
        layer: "features",
        slice: "b",
        segment: "ui",
        publicApi: false,
      },
      sourceImport: {
        kind: "import",
        specifier: "@/features/b/ui/b",
        line: 1,
        column: 1,
      },
    });

    expect(violations.some((item) => item.kind === "cross-slice-deep-import")).toBe(true);
  });
});
