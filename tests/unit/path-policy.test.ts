import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateWorkspacePath } from "../../src/security/path-policy.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "policy-root-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "policy-outside-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("validateWorkspacePath", () => {
  it("allows existing paths inside workspace", async () => {
    await writeFile(path.join(root, "file.txt"), "hello");

    const result = await validateWorkspacePath({
      workspaceRoot: root,
      candidatePath: "file.txt",
      mode: "read",
    });

    expect(result.decision.verdict).toBe("allow");
  });

  it("denies traversal outside workspace", async () => {
    const result = await validateWorkspacePath({
      workspaceRoot: root,
      candidatePath: "../secret.txt",
      mode: "read",
    });

    expect(result.decision.verdict).toBe("deny");
  });

  it("denies symlink escape", async () => {
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "link"));

    const result = await validateWorkspacePath({
      workspaceRoot: root,
      candidatePath: "link/secret.txt",
      mode: "read",
    });

    expect(result.decision.verdict).toBe("deny");
    expect(result.decision.reasons[0]!.code).toBe("SYMLINK_ESCAPE");
  });

  it("allows create paths when parent is inside workspace", async () => {
    await mkdir(path.join(root, "docs"));

    const result = await validateWorkspacePath({
      workspaceRoot: root,
      candidatePath: "docs/new.md",
      mode: "create",
    });

    expect(result.decision.verdict).toBe("allow");
  });
});
