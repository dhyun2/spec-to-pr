import { describe, expect, it } from "vitest";

import { parseSourceImports } from "../../src/architecture/import-parser.js";

describe("parseSourceImports", () => {
  it("extracts static dynamic and export imports", () => {
    const imports = parseSourceImports({
      filePath: "src/features/foo/ui/foo.tsx",
      content: `
import { Button } from "@/shared/ui";
export { X } from "@/entities/x";
const mod = await import("@/features/bar");
`,
    });

    expect(imports.map((item) => item.specifier)).toEqual([
      "@/shared/ui",
      "@/entities/x",
      "@/features/bar",
    ]);
  });
});
