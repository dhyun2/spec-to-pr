import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildLegacyEvidenceReport,
  type LegacyVisualManifest,
} from "../../scripts/lite/legacy-visual-evidence.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy visual evidence", () => {
  it("requires every discovered user-visible route/state to be compared or made an explicit Gap", async () => {
    const projectRoot = await createProject();
    const manifest = createManifest();
    manifest.routeInventory.push({
      id: "map-region",
      route: "/map/:rgnNo",
      state: "region-selected",
      sourceFiles: ["src/views/Mapfinder.vue"],
      targetFiles: ["apps/gzApp/src/pages/mapfinder/MapfinderPage.vue"],
    });

    const report = await buildLegacyEvidenceReport(manifest, { projectRoot, requireStaged: false });

    expect(report.status).toBe("not-verified");
    expect(report.coverage).toMatchObject({ required: 2, compared: 1, passed: 1 });
    expect(report.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: expect.stringContaining("/map/:rgnNo · region-selected") }),
      ]),
    );
    expect(report.markdown).toContain("NOT VERIFIED");
  });

  it("writes raw image URLs and rejects a design-system substitution in a preserve migration", async () => {
    const projectRoot = await createProject("import { Chip } from '@frontend/ui';\nvoid Chip;\n");
    const report = await buildLegacyEvidenceReport(createManifest(), {
      projectRoot,
      requireStaged: false,
      repositoryWebUrl: "https://gitlab.example.com/group/app",
      sourceRef: "codex/mapfinder",
    });

    expect(report.status).toBe("not-verified");
    expect(report.designPreservation.status).toBe("gap");
    expect(report.markdown).toContain(
      "https://gitlab.example.com/group/app/-/raw/codex%2Fmapfinder/",
    );
    expect(report.markdown).toContain("@frontend/ui");
  });

  it("runs as the bundled plugin script and emits a reviewable report", async () => {
    const projectRoot = await createProject();
    const manifestPath = path.join(
      projectRoot,
      "spec-to-pr-evidence/mapfinder/legacy-visual-manifest.json",
    );
    await writeFile(manifestPath, JSON.stringify(createManifest()), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "skills/spec-to-pr/scripts/legacy-visual-evidence.cjs"),
      "--manifest",
      manifestPath,
      "--project-root",
      projectRoot,
      "--allow-unstaged",
      "true",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      status: "verified",
      coverage: { required: 1, passed: 1 },
    });
  });
});

async function createProject(source = "export default {};\n"): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-"));
  temporaryDirectories.push(projectRoot);
  const evidence = path.join(projectRoot, "spec-to-pr-evidence/mapfinder");
  await Promise.all([
    mkdir(path.join(projectRoot, "apps/gzApp/src/pages/mapfinder"), { recursive: true }),
    mkdir(evidence, { recursive: true }),
  ]);
  await writeFile(
    path.join(projectRoot, "apps/gzApp/src/pages/mapfinder/MapfinderPage.vue"),
    source,
  );
  const image = createPng(10, 10, [18, 52, 86, 255]);
  await Promise.all([
    writeFile(path.join(evidence, "baseline-map-default.png"), image),
    writeFile(path.join(evidence, "actual-map-default.png"), image),
  ]);
  return projectRoot;
}

function createManifest(): LegacyVisualManifest {
  return {
    schemaVersion: 1,
    case: "legacy",
    change: "mapfinder",
    legacyProjectRoot: "/legacy/mapfinder",
    targetPaths: ["apps/gzApp/src/pages/mapfinder"],
    migration: {
      strategy: "preserve-legacy",
      preservation: {
        template: "preserved",
        styles: "preserved",
        assets: "preserved",
        controls: "preserved",
      },
      forbiddenImports: ["@frontend/ui"],
    },
    routeInventory: [
      {
        id: "map-default",
        route: "/map",
        state: "default-map",
        sourceFiles: ["src/views/Mapfinder.vue"],
        targetFiles: ["apps/gzApp/src/pages/mapfinder/MapfinderPage.vue"],
      },
    ],
    visualTargets: [
      {
        id: "map-default",
        inventoryId: "map-default",
        fixture: "qa:authenticated",
        viewport: { width: 10, height: 10, dpr: 1 },
        baselinePath: "baseline-map-default.png",
        attempts: [{ actualPath: "actual-map-default.png", diffPath: "diff-map-default.png" }],
        criticalRegions: [{ id: "bottom-controls", x: 0, y: 0, width: 2, height: 2 }],
      },
    ],
  };
}

function createPng(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0];
    image.data[offset + 1] = rgba[1];
    image.data[offset + 2] = rgba[2];
    image.data[offset + 3] = rgba[3];
  }
  return PNG.sync.write(image);
}
