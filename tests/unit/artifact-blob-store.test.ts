import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import {
  type RuntimeMetricName,
  type RuntimeMetricsSink,
} from "../../src/runtime/performance-instrumentation.js";
import { digestPathSegments, sha256Digest } from "../../src/source-registry/content-hash.js";

let directory: string;
let store: ArtifactBlobStore;

const storedAt = "2026-07-20T00:00:00.000Z";

class CountingMetrics implements RuntimeMetricsSink {
  private readonly values = new Map<RuntimeMetricName, number>();

  public increment(name: RuntimeMetricName, value = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + value);
  }

  public gauge(_name: RuntimeMetricName, _value: number): void {}

  public async time<T>(
    _name: RuntimeMetricName,
    _tags: Record<string, never>,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  public value(name: RuntimeMetricName): number {
    return this.values.get(name) ?? 0;
  }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-artifact-unit-"));
  store = new ArtifactBlobStore(directory);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("ArtifactBlobStore integrity", () => {
  it("does not reread or rehash a freshly written blob", async () => {
    const metrics = new CountingMetrics();
    const metricsStore = new ArtifactBlobStore(directory, metrics);

    const stored = await metricsStore.writeBlob({
      content: Buffer.alloc(1_048_576, 7),
      mediaType: "application/octet-stream",
      storedAt,
    });

    expect(stored.metadata.byteLength).toBe(1_048_576);
    expect(metrics.value("artifact.read_bytes")).toBe(0);
    expect(metrics.value("artifact.hash_count")).toBe(1);
  });

  it("rejects content changed after storage", async () => {
    const stored = await store.writeBlob({
      content: Buffer.from("trusted"),
      mediaType: "text/plain",
      storedAt,
    });

    await writeFile(stored.contentPath, "tampered");

    await expect(store.readContent(stored.digest)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
  });

  it("rejects symlinked content", async () => {
    const stored = await store.writeBlob({
      content: Buffer.from("trusted"),
      mediaType: "text/plain",
      storedAt,
    });
    const realPath = `${stored.contentPath}.real`;
    await rename(stored.contentPath, realPath);
    await symlink(realPath, stored.contentPath);

    await expect(store.readContent(stored.digest)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
  });

  it("rejects symlinked metadata", async () => {
    const stored = await store.writeBlob({
      content: Buffer.from("trusted"),
      mediaType: "text/plain",
      storedAt,
    });
    const realPath = `${stored.metadataPath}.real`;
    await rename(stored.metadataPath, realPath);
    await symlink(realPath, stored.metadataPath);

    await expect(store.readMetadata(stored.digest)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
  });

  it("rejects metadata that does not match the requested digest and length", async () => {
    const stored = await store.writeBlob({
      content: Buffer.from("trusted"),
      mediaType: "text/plain",
      storedAt,
    });
    await writeFile(
      stored.metadataPath,
      `${JSON.stringify({ ...stored.metadata, byteLength: 999, unexpected: true })}\n`,
    );

    await expect(store.readMetadata(stored.digest)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
  });

  it("rejects a truncated pre-existing destination instead of trusting EEXIST", async () => {
    const content = Buffer.from("trusted");
    const digest = sha256Digest(content);
    const { prefix, hex } = digestPathSegments(digest);
    const blobDirectory = path.join(directory, "sha256", prefix, hex);
    await mkdir(blobDirectory, { recursive: true });
    await writeFile(path.join(blobDirectory, "content"), "partial");

    await expect(store.writeBlob({ content, mediaType: "text/plain", storedAt })).rejects.toThrow(
      "ARTIFACT_INTEGRITY_FAILED",
    );
  });

  it("publishes one complete blob for concurrent identical writes", async () => {
    const content = Buffer.from("same-content");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.writeBlob({ content, mediaType: "text/plain", storedAt, label: "same" }),
      ),
    );

    expect(new Set(results.map((result) => result.digest))).toHaveLength(1);
    expect(await readFile(results[0]!.contentPath)).toEqual(content);
    expect(await store.readMetadata(results[0]!.digest)).toEqual(results[0]!.metadata);
  });

  it("reuses content metadata safely when identical bytes have different artifact labels", async () => {
    const first = await store.writeBlob({
      content: Buffer.from("{}\n"),
      mediaType: "application/json",
      storedAt,
      label: "observability.json",
    });

    const second = await store.writeBlob({
      content: Buffer.from("{}\n"),
      mediaType: "application/json",
      storedAt: "2026-07-20T00:00:01.000Z",
      label: "scorecard.json",
    });

    expect(second.digest).toBe(first.digest);
    expect(second.metadata).toEqual(first.metadata);
    expect(await store.readContent(second.digest)).toEqual(Buffer.from("{}\n"));
  });
});
