import { describe, expect, it } from "vitest";

import {
  ImplementationSnapshotSchema,
  implementationRepositoryKey,
  reusableImplementationSnapshot,
} from "../../src/workflow/implementation-snapshot.js";

const digest = (value: string) => `sha256:${value.repeat(64)}` as const;

describe("ImplementationSnapshot", () => {
  const snapshot = ImplementationSnapshotSchema.parse({
    schemaVersion: "implementation-snapshot-v1",
    repositoryKey: digest("1"),
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    sourceBranch: "codex/reuse-packet-evidence",
    clean: true,
    changedFiles: ["src/parser.ts"],
    diffDigest: digest("2"),
    binaryDiffBytes: 512,
    capturedAt: "2026-07-29T00:00:00.000Z",
  });

  it("reuses only an exact clean head and source branch fence", () => {
    expect(
      reusableImplementationSnapshot(snapshot, {
        headSha: snapshot.headSha,
        sourceBranch: snapshot.sourceBranch,
        clean: true,
      }),
    ).toBe(true);

    for (const current of [
      { headSha: "c".repeat(40), sourceBranch: snapshot.sourceBranch, clean: true },
      { headSha: snapshot.headSha, sourceBranch: "codex/other", clean: true },
      { headSha: snapshot.headSha, sourceBranch: snapshot.sourceBranch, clean: false },
    ]) {
      expect(reusableImplementationSnapshot(snapshot, current)).toBe(false);
    }
  });

  it("stores only a repository digest and safe project-relative changed files", () => {
    const root = "/Users/private/work/acme";
    const key = implementationRepositoryKey(root);

    expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain(root);
    expect(
      ImplementationSnapshotSchema.safeParse({
        ...snapshot,
        changedFiles: ["/Users/private/work/acme/src/parser.ts"],
      }).success,
    ).toBe(false);
    expect(
      ImplementationSnapshotSchema.safeParse({
        ...snapshot,
        changedFiles: ["../private/key"],
      }).success,
    ).toBe(false);
  });
});
