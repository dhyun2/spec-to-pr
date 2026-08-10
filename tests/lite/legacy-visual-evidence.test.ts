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
import { collectLegacySourceInventory } from "../../scripts/lite/legacy-source-inventory.js";

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

  it("requires source asset and CSS mappings and exposes plugin publishing failures in the PR report", async () => {
    const projectRoot = await createProject();
    const inventoryPath = path.join(
      projectRoot,
      "spec-to-pr-evidence/mapfinder/legacy-source-inventory.json",
    );
    await writeFile(
      inventoryPath,
      JSON.stringify({
        schemaVersion: 1,
        legacyProjectRoot: "/legacy/mapfinder",
        sourcePaths: ["src/modules/mapfinder"],
        routes: [{ id: "route-001", sourceFile: "src/router.ts", route: "/map" }],
        assets: [
          {
            id: "asset-001",
            sourceFile: "src/map.scss",
            reference: "../assets/logo.png",
            kind: "css-url",
          },
        ],
        selectors: [{ id: "selector-001", sourceFile: "src/map.scss", selector: ".shop-logo" }],
        breakpoints: [],
        runtimeDependencies: [],
      }),
      "utf8",
    );
    const manifest = createManifest();
    manifest.publishing = {
      plugin: { status: "failed", summary: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
      draft: {
        status: "published",
        method: "glab",
        url: "https://gitlab.example.com/group/app/-/merge_requests/1",
        summary: "fallback Draft MR created",
      },
    };

    const report = await buildLegacyEvidenceReport(manifest, { projectRoot, requireStaged: false });

    expect(report.status).toBe("not-verified");
    expect(report.sourcePreservation.coverage.assets).toEqual({ mapped: 0, total: 1 });
    expect(report.markdown).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(report.markdown).toContain("fallback Draft MR created");
    expect(report.markdown).toContain("발행 상태");
  });

  it("collects routes, assets, CSS selectors, breakpoints, and map SDK markers from the legacy source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-source-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src/modules/mapfinder"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(root, "src/modules/mapfinder/router.ts"),
        "export const routes = [{ path: '/map' }, { path: '/map/:rgnNo' }];\n",
      ),
      writeFile(
        path.join(root, "src/modules/mapfinder/Map.vue"),
        'window.kakao.maps.Map;\n<img src="./logo.svg">\n',
      ),
      writeFile(
        path.join(root, "src/modules/mapfinder/map.scss"),
        ".shop-logo { background: url('./logo.png'); }\n@media (max-width: 640px) { .shop-logo { display: none; } }\n",
      ),
    ]);

    const inventory = await collectLegacySourceInventory({
      legacyProjectRoot: root,
      sourcePaths: ["src/modules/mapfinder"],
    });

    expect(inventory.routes.map((route) => route.route)).toEqual(["/map", "/map/:rgnNo"]);
    expect(inventory.assets.map((asset) => asset.reference)).toEqual(
      expect.arrayContaining(["./logo.png", "./logo.svg"]),
    );
    expect(inventory.selectors.map((selector) => selector.selector)).toContain(".shop-logo");
    expect(inventory.breakpoints.map((breakpoint) => breakpoint.query)).toContain(
      "(max-width: 640px)",
    );
    expect(inventory.runtimeDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marker: "kakao.maps.Map", kind: "map-sdk" }),
      ]),
    );

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "skills/spec-to-pr/scripts/legacy-source-inventory.cjs"),
      "--legacy-root",
      root,
      "--source-paths",
      "src/modules/mapfinder",
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      routes: expect.arrayContaining([expect.objectContaining({ route: "/map" })]),
      assets: expect.arrayContaining([expect.objectContaining({ reference: "./logo.png" })]),
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
    writeFile(
      path.join(evidence, "legacy-source-inventory.json"),
      JSON.stringify({
        schemaVersion: 1,
        legacyProjectRoot: "/legacy/mapfinder",
        sourcePaths: ["src/modules/mapfinder"],
        routes: [{ id: "route-001", sourceFile: "src/router.ts", route: "/map" }],
        assets: [],
        selectors: [],
        breakpoints: [],
        runtimeDependencies: [],
      }),
      "utf8",
    ),
  ]);
  return projectRoot;
}

function createManifest(): LegacyVisualManifest {
  return {
    schemaVersion: 2,
    case: "legacy",
    change: "mapfinder",
    legacyProjectRoot: "/legacy/mapfinder",
    sourceInventoryPath: "legacy-source-inventory.json",
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
    assetMappings: [],
    selectorMappings: [],
    breakpointMappings: [],
    runtimeMappings: [],
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
