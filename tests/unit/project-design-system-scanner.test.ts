import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanProjectDesignSystem } from "../../src/design-contract/project-design-system-scanner.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-ds-scan-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("project design-system scanner", () => {
  it("discovers shared UI components and CSS variables", async () => {
    await mkdir(path.join(directory, "src", "shared", "ui", "button"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "shared", "ui", "button", "index.tsx"),
      "export function Button() { return null; }",
    );

    await mkdir(path.join(directory, "src", "styles"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "styles", "variables.css"),
      ":root { --color-primary: #2563eb; }",
    );

    const inventory = await scanProjectDesignSystem(directory);

    expect(inventory.components.some((component) => component.name === "Button")).toBe(true);
    expect(inventory.tokens.some((token) => token.name === "--color-primary")).toBe(true);
  });

  it("discovers @frontend/ui root and Vue icon package exports", async () => {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          "@frontend/ui": "1.2.3",
        },
      }),
    );
    await mkdir(path.join(directory, "node_modules", "@frontend", "ui", "dist", "icons"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "node_modules", "@frontend", "ui", "package.json"),
      JSON.stringify({
        name: "@frontend/ui",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
          },
          "./icons/vue": {
            types: "./dist/icons/vue.d.ts",
          },
        },
      }),
    );
    await writeFile(
      path.join(directory, "node_modules", "@frontend", "ui", "dist", "index.d.ts"),
      `
export declare const Button: unknown;
export declare function TextField(): unknown;
`,
    );
    await writeFile(
      path.join(directory, "node_modules", "@frontend", "ui", "dist", "icons", "vue.d.ts"),
      `
export declare const Chevron_down_m: unknown;
`,
    );

    const inventory = await scanProjectDesignSystem(directory);

    expect(inventory.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Button",
          importPath: "@frontend/ui",
          source: "package-ui",
        }),
        expect.objectContaining({
          name: "TextField",
          importPath: "@frontend/ui",
          source: "package-ui",
        }),
        expect.objectContaining({
          name: "Chevron_down_m",
          importPath: "@frontend/ui/icons/vue",
          source: "package-ui",
        }),
      ]),
    );
    expect(inventory.scannedPaths).toEqual(expect.arrayContaining(["node_modules/@frontend/ui"]));
  });
});
