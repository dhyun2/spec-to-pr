import { describe, expect, it } from "vitest";

import { evaluateSourceGuards } from "../../src/architecture/source-guard-rules.js";

describe("source guard rules", () => {
  it("rejects UI generated client imports", () => {
    const violations = evaluateSourceGuards({
      index: 0,
      source: {
        absolutePath: "/repo/src/features/reservation-list/ui/list.tsx",
        relativePath: "src/features/reservation-list/ui/list.tsx",
        layer: "features",
        slice: "reservation-list",
        segment: "ui",
        publicApi: false,
      },
      sourceImport: {
        kind: "import",
        specifier: "@/shared/api/generated/staff",
        line: 1,
        column: 1,
      },
      sourceContent: "",
    });

    expect(violations.some((item) => item.kind === "ui-direct-generated-client")).toBe(true);
  });

  it("rejects direct fetch in UI modules", () => {
    const violations = evaluateSourceGuards({
      index: 0,
      source: {
        absolutePath: "/repo/src/features/reservation-list/ui/list.tsx",
        relativePath: "src/features/reservation-list/ui/list.tsx",
        layer: "features",
        slice: "reservation-list",
        segment: "ui",
        publicApi: false,
      },
      sourceImport: {
        kind: "import",
        specifier: "react",
        line: 1,
        column: 1,
      },
      sourceContent: "fetch('/reservations')",
    });

    expect(violations.some((item) => item.kind === "ui-direct-fetch")).toBe(true);
  });
});
