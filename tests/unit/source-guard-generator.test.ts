import { describe, expect, it } from "vitest";

import { generateSourceGuardTest } from "../../src/api-pipeline/source-guard-generator.js";

describe("generateSourceGuardTest", () => {
  it("generates source guard test content", () => {
    const file = generateSourceGuardTest({
      generatedImportPattern: "shared/api/generated/staff",
      uiGlobs: ["src/features/**/*.tsx"],
      outputPath: "src/shared/api/__tests__/source-guards.generated.test.ts",
    });

    expect(file.content).toContain("direct fetch");
    expect(file.content).toContain("direct generated client import");
    expect(file.content).toContain("walkFiles");
  });
});
