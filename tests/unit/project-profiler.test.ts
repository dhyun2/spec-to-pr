import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { profileProject } from "../../src/profile/project-profiler.js";

const runId = "run_11111111111111111111111111111111";

describe("project profiler", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-profile-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("detects pnpm react vite vitest fsd project structure", async () => {
    await mkdir(path.join(directory, "src", "features"), { recursive: true });
    await mkdir(path.join(directory, "src", "entities"), { recursive: true });
    await mkdir(path.join(directory, "src", "shared", "ui"), { recursive: true });
    await mkdir(path.join(directory, "src", "pages"), { recursive: true });

    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          packageManager: "pnpm@10.0.0",
          dependencies: {
            react: "^19.0.0",
          },
          devDependencies: {
            vite: "^7.0.0",
            vitest: "^3.0.0",
            typescript: "^5.0.0",
          },
          scripts: {
            test: "vitest run",
            build: "vite build",
            "api:generate": "openapi-generator",
          },
        },
        null,
        2,
      ),
    );

    await writeFile(path.join(directory, "pnpm-lock.yaml"), "");
    await writeFile(path.join(directory, "vite.config.ts"), "export default {}");
    await writeFile(path.join(directory, "vitest.config.ts"), "export default {}");
    await writeFile(path.join(directory, "tsconfig.json"), "{}");

    const profile = await profileProject({
      runId,
      projectRoot: directory,
      now: "2026-06-23T00:00:00.000Z",
    });

    expect(profile.packageManager.name).toBe("pnpm");
    expect(profile.framework.primary).toBe("react");
    expect(profile.framework.buildTool).toBe("vite");
    expect(profile.framework.testRunner).toBe("vitest");
    expect(profile.fsd.detected).toBe(true);
    expect(profile.designSystem.detected).toBe(true);
    expect(profile.apiGeneration.detected).toBe(true);
  });
});
