import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LegacySourceCache,
  LegacySourceManifestSchema,
  currentLegacySourceManifest,
} from "../../src/legacy/legacy-source-cache.js";
import { buildLegacyInventory } from "../../src/legacy/legacy-inventory.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("legacy source cache", () => {
  it("persists an immutable path-hashed manifest without raw paths or secret values", async () => {
    const root = await legacyFixture(2);
    await writeFile(
      path.join(root, ".env.qa"),
      ["API_URL=https://api.example.test/v2/", "UNRELATED_SECRET=must-not-appear"].join("\n"),
      "utf8",
    );

    const inventory = await buildLegacyInventory(root);
    const manifest = LegacySourceManifestSchema.parse(inventory.sourceManifest);
    const serialized = JSON.stringify(manifest);

    expect(Object.isFrozen(inventory.sourceManifest)).toBe(true);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.every((file) => /^sha256:[a-f0-9]{64}$/u.test(file.realPathKey))).toBe(
      true,
    );
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("must-not-appear");
    expect(serialized).not.toContain("https://api.example.test");
  });

  it("keys bytes and lazy ASTs by real path plus digest", async () => {
    const root = await legacyFixture(1);
    const sourcePath = path.join(root, "src", "file-000.ts");
    const cache = new LegacySourceCache();

    const first = await cache.read(sourcePath);
    const second = await cache.read(sourcePath);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(cache.snapshotStats()).toMatchObject({ fileReads: 1, astParses: 0 });

    expect(first!.parsed()).toBe(first!.parsed());
    expect(cache.snapshotStats()).toMatchObject({ fileReads: 1, astParses: 1 });
  });

  it("preserves symlink rejection and hard-link path identity", async () => {
    const root = await legacyFixture(1);
    const sourcePath = path.join(root, "src", "file-000.ts");
    await link(sourcePath, path.join(root, "src", "hard-link.ts"));
    await symlink(sourcePath, path.join(root, "src", "symbolic-link.ts"));

    const inventory = await buildLegacyInventory(root);
    const manifest = LegacySourceManifestSchema.parse(inventory.sourceManifest);

    expect(manifest.files.map((file) => file.applicationRelativePath)).toEqual([
      "src/file-000.ts",
      "src/hard-link.ts",
    ]);
    expect(new Set(manifest.files.map((file) => file.realPathKey))).toHaveLength(2);
    expect(new Set(manifest.files.map((file) => file.digest))).toHaveLength(1);
  });

  it("bounds byte hashing while recomputing a current manifest", async () => {
    const root = await legacyFixture(1);
    const inventory = await buildLegacyInventory(root);
    const cache = new LegacySourceCache();

    const current = await currentLegacySourceManifest(root, inventory.sourceManifest!, cache, {
      maxFiles: 250,
      maxBytes: 1,
      maxDepth: 32,
      maxElapsedMs: 5_000,
    });

    expect(current.truncated).toBe(true);
  });

  it("does not read oversized resolution config or environment inputs", async () => {
    const root = await legacyFixture(1);
    await writeFile(path.join(root, "package.json"), '{"name":"bounded-inputs"}\n', "utf8");
    const oversized = "x".repeat(2 * 1024 * 1024 + 1);
    await writeFile(path.join(root, "tsconfig.json"), oversized, "utf8");
    await writeFile(
      path.join(root, ".env.qa"),
      `API_URL=https://example.test/${oversized}`,
      "utf8",
    );
    const cache = new LegacySourceCache();

    await buildLegacyInventory(path.join(root, "src"), {}, { sourceCache: cache });

    expect(cache.snapshotStats().fileReads).toBe(1);
  });
});

async function legacyFixture(fileCount: number): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-cache-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await Promise.all(
    Array.from({ length: fileCount }, (_, index) =>
      writeFile(
        path.join(root, "src", `file-${String(index).padStart(3, "0")}.ts`),
        `export const value${index} = ${index};\n`,
        "utf8",
      ),
    ),
  );
  return root;
}
