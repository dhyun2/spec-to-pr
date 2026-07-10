import { describe, expect, it } from "vitest";

import { classifyModulePath } from "../../src/architecture/project-boundary.js";

describe("classifyModulePath", () => {
  it("classifies FSD feature UI module", () => {
    const result = classifyModulePath({
      projectRoot: "/repo",
      absolutePath: "/repo/src/features/reservation-list/ui/list.tsx",
    });

    expect(result).toMatchObject({
      layer: "features",
      slice: "reservation-list",
      segment: "ui",
    });
  });

  it("classifies shared api module", () => {
    const result = classifyModulePath({
      projectRoot: "/repo",
      absolutePath: "/repo/src/shared/api/generated/staff/index.ts",
    });

    expect(result).toMatchObject({
      layer: "shared",
      segment: "api",
    });
  });
});
