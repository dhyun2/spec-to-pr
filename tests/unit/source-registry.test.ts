import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalizeFileContent } from "../../src/source-registry/canonical-content.js";
import { sha256Digest } from "../../src/source-registry/content-hash.js";
import { resolveFileInsideRoot } from "../../src/source-registry/path-scope.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-source-unit-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("source registry utilities", () => {
  it("computes canonical sha256 digests", () => {
    const digest = sha256Digest(Buffer.from("hello", "utf8"));

    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("normalizes CRLF line endings for text files", () => {
    const left = canonicalizeFileContent({
      path: "docs/brief.md",
      rawContent: Buffer.from("hello\r\nworld\r\n", "utf8"),
    });

    const right = canonicalizeFileContent({
      path: "docs/brief.md",
      rawContent: Buffer.from("hello\nworld\n", "utf8"),
    });

    expect(left.canonicalDigest).toBe(right.canonicalDigest);
    expect(left.rawDigest).not.toBe(right.rawDigest);
  });

  it("keeps binary content raw", () => {
    const raw = Buffer.from([0, 1, 2, 3]);

    const content = canonicalizeFileContent({
      path: "image.png",
      rawContent: raw,
    });

    expect(content.mode).toBe("binary");
    expect(content.rawDigest).toBe(content.canonicalDigest);
  });

  it("resolves files inside project root", async () => {
    await mkdir(path.join(directory, "docs"));
    await writeFile(path.join(directory, "docs", "brief.md"), "hello");

    const scoped = await resolveFileInsideRoot({
      projectRoot: directory,
      filePath: "docs/brief.md",
    });

    expect(scoped.relativePath).toBe("docs/brief.md");
  });

  it("rejects files outside project root", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const outsideFile = path.join(outside, "secret.md");

    await writeFile(outsideFile, "secret");

    await expect(
      resolveFileInsideRoot({
        projectRoot: directory,
        filePath: path.relative(directory, outsideFile),
      }),
    ).rejects.toThrow(/outside project root/);

    await rm(outside, {
      recursive: true,
      force: true,
    });
  });

  it("stores source snapshots by digest", async () => {
    const store = new SourceSnapshotStore(path.join(directory, "snapshots"));

    const snapshot = await store.writeSnapshot({
      source: {
        id: "src_11111111111111111111111111111111",
        kind: "brief",
        locator: {
          type: "file",
          path: "docs/brief.md",
        },
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        capturedAt: "2026-06-23T00:00:00.000Z",
      },
      canonical: canonicalizeFileContent({
        path: "docs/brief.md",
        rawContent: Buffer.from("hello\n", "utf8"),
      }),
      storedAt: "2026-06-23T00:00:00.000Z",
    });

    const storedContent = await readFile(snapshot.contentPath, "utf8");

    expect(storedContent).toBe("hello\n");
    expect(snapshot.metadata.source.kind).toBe("brief");
  });
});
