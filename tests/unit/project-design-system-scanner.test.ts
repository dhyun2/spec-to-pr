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
});
