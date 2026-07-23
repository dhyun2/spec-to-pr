import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReleaseService } from "../../src/application/release-service.js";

let directory: string;
let projectRoot: string;
let projectVersion: string;
let service: ReleaseService;
let validatePlugin: ReturnType<typeof vi.fn>;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-service-"));
  projectRoot = path.join(directory, "project");
  await createWorktreeSnapshot(process.cwd(), projectRoot);
  projectVersion = (
    JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  validatePlugin = vi.fn(async () => undefined);
  service = new ReleaseService(projectRoot, () => "2026-06-28T00:00:00.000Z", validatePlugin);
});

async function createWorktreeSnapshot(sourceRoot: string, targetRoot: string): Promise<void> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: sourceRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const files = stdout.split("\0").filter((file) => file.length > 0);
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    let details;
    try {
      details = await lstat(source);
    } catch {
      continue;
    }
    if (!details.isFile() || details.isSymbolicLink()) continue;
    const target = path.join(targetRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  await execFileAsync("git", ["init", "--quiet"], { cwd: targetRoot });
  await execFileAsync("git", ["config", "user.name", "SpecToPR Test"], { cwd: targetRoot });
  await execFileAsync("git", ["config", "user.email", "test@spec-to-pr.invalid"], {
    cwd: targetRoot,
  });
  await execFileAsync("git", ["add", "--all"], { cwd: targetRoot });
  await execFileAsync("git", ["commit", "--quiet", "-m", "test: snapshot current worktree"], {
    cwd: targetRoot,
  });
}

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("ReleaseService", () => {
  it("builds, verifies the actual archive, and generates notes", async () => {
    const outputDirectory = path.join(directory, "release");
    const build = await service.buildReleasePackage({
      version: projectVersion,
      outputDirectory,
      allowDirty: false,
    });
    const verification = await service.verifyReleasePackage({
      manifestPath: build.manifestPath,
    });
    const notes = await service.generateReleaseNotes({
      manifestPath: build.manifestPath,
      outputDirectory,
    });

    expect(build.verification.failures).toEqual([]);
    expect(build.verification.status).toBe("passed");
    expect(build.manifest.pluginValidationStatus).toBe("passed");
    expect(validatePlugin).toHaveBeenCalledOnce();
    expect(validatePlugin).toHaveBeenCalledWith({
      projectRoot,
      gitCommit: build.build.gitCommit,
    });
    expect(build.build.includedFiles).toContain("dist/mcp/server.js");
    expect(verification.verification.status).toBe("passed");
    expect(notes.content).toContain(`# spec-to-pr ${projectVersion}`);
    expect(notes.content).toContain("- Plugin validation: passed");

    await writeFile(build.checksumPath, "sha256:bad  tampered.zip\n", "utf8");
    const tamperedChecksum = await service.verifyReleasePackage({
      manifestPath: build.manifestPath,
    });
    expect(tamperedChecksum.verification.status).toBe("failed");
    expect(tamperedChecksum.verification.failures).toContain(
      "Release checksum sidecar does not match the manifest and package name.",
    );
  });

  it("rejects caller-asserted plugin validation status", async () => {
    await expect(
      service.buildReleasePackage({
        version: projectVersion,
        outputDirectory: path.join(directory, "release"),
        allowDirty: true,
        pluginValidationStatus: "passed",
      }),
    ).rejects.toThrow();
    expect(validatePlugin).not.toHaveBeenCalled();
  });

  it("does not attest plugin validation for a dirty-tolerant dry run", async () => {
    const build = await service.buildReleasePackage({
      version: projectVersion,
      outputDirectory: path.join(directory, "dry-run-release"),
      allowDirty: true,
    });

    expect(build.manifest.pluginValidationStatus).toBe("skipped");
    expect(validatePlugin).not.toHaveBeenCalled();
  });
});
