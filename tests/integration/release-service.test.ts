import { mkdtemp, rm } from "node:fs/promises";
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
  it("runs gates, builds package, verifies manifest, and generates notes", async () => {
    const outputDirectory = path.join(directory, "release");
    const suites = service.listEvalSuites();
    const evalResult = await service.runEvalSuite({
      outputDirectory,
    });
    const hardeningResult = await service.runSecurityHardeningSuite({
      outputDirectory,
    });
    const build = await service.buildReleasePackage({
      version: "0.1.0",
      outputDirectory,
    });
    const verification = await service.verifyReleasePackage({
      manifestPath: build.manifestPath,
    });
    const notes = await service.generateReleaseNotes({
      manifestPath: build.manifestPath,
      outputDirectory,
    });

    expect(suites.suites[0]?.id).toBe("default-release-readiness");
    expect(evalResult.report.status).toBe("passed");
    expect(hardeningResult.report.status).toBe("passed");
    expect(build.verification.status).toBe("passed");
    expect(build.manifest.evalStatus).toBe("passed");
    expect(build.manifest.securityStatus).toBe("passed");
    expect(build.build.includedFiles).toContain("dist/mcp/server.js");
    expect(verification.verification.status).toBe("passed");
    expect(notes.content).toContain("# spec-to-pr 0.1.0");
  });
});
