import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleaseService } from "../../src/application/release-service.js";

let directory: string;
let service: ReleaseService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-service-"));
  service = new ReleaseService(process.cwd(), () => "2026-06-28T00:00:00.000Z");
});

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
      version: "0.1.0",
      outputDirectory,
      allowDirty: true,
    });
    const verification = await service.verifyReleasePackage({
      manifestPath: build.manifestPath,
    });
    const notes = await service.generateReleaseNotes({
      manifestPath: build.manifestPath,
      outputDirectory,
    });

    expect(build.verification.status).toBe("passed");
    expect(build.build.includedFiles).toContain("dist/mcp/server.js");
    expect(verification.verification.status).toBe("passed");
    expect(notes.content).toContain("# spec-to-pr 0.1.0");

    await writeFile(build.checksumPath, "sha256:bad  tampered.zip\n", "utf8");
    const tamperedChecksum = await service.verifyReleasePackage({
      manifestPath: build.manifestPath,
    });
    expect(tamperedChecksum.verification.status).toBe("failed");
    expect(tamperedChecksum.verification.failures).toContain(
      "Release checksum sidecar does not match the manifest and package name.",
    );
  });
});
