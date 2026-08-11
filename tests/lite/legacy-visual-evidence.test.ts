import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("accepts a disclosed Browser fallback without creating a Gap and renders only side-by-side images", async () => {
    const manifest = createManifest();
    manifest.visualTargets[0]!.baselineCapture = {
      provider: "browser",
      authState: "authenticated",
      capturedAt: "2026-08-10T00:00:00.000Z",
      fallbackReason: "Computer Use capability was not available in this host.",
    };
    manifest.visualTargets[0]!.attempts[0]!.capture = {
      provider: "browser",
      authState: "authenticated",
      capturedAt: "2026-08-10T00:00:01.000Z",
      fallbackReason: "Computer Use capability was not available in this host.",
    };

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("verified");
    expect(report.captureEvidence).toMatchObject({ status: "passed", messages: [] });
    expect(report.captureEvidence.disclosures).toHaveLength(1);
    expect(report.gaps).toEqual([]);
    expect(report.markdown).toContain("## 좌우 이미지 비교");
    expect(report.markdown).not.toContain("## 화면 비교");
    expect(report.markdown).toContain("| 레거시 | Vue 3 |");
    expect(report.markdown).toContain("[Diff 이미지]");
    expect(report.markdown).toContain("Computer Use capability was not available");
    expect(report.markdown).toContain("Browser fallback");
  });

  it("keeps SpecToPR 1.0.3 fallback policy manifests readable without a Gap", async () => {
    const manifest = createManifest();
    manifest.capturePolicy!.fallback = "browser-or-playwright-with-gap";

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("verified");
    expect(report.captureEvidence.status).toBe("passed");
  });

  it("rejects credential-shaped fallback text", async () => {
    const manifest = createManifest();
    manifest.visualTargets[0]!.baselineCapture = {
      provider: "browser",
      authState: "authenticated",
      capturedAt: "2026-08-10T00:00:00.000Z",
      fallbackReason: ["token", "synthetic-secret"].join("="),
    };

    await expect(
      buildLegacyEvidenceReport(manifest, {
        projectRoot: await createProject(),
        requireStaged: false,
      }),
    ).rejects.toThrow("fallbackReason must not contain cookie, token, or authorization values");
  });

  it("keeps schema v3 readable but does not call pixel-only evidence verified", async () => {
    const manifest = createManifest();
    manifest.schemaVersion = 3;
    delete manifest.routeChecks;
    delete manifest.targetCodeProfile;

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.targets[0]?.status).toBe("failed");
    expect(report.markdown).toContain("실제 fixture");
    expect(report.markdown).toContain("대상 저장소 코드 규격 증빙이 없어 Gap");
  });

  it("rejects blank runtime state, placeholder route values, API failures, and full-viewport critical regions", async () => {
    const manifest = createManifest();
    manifest.routeInventory[0]!.route = "/booking/take/new/:shopNo";
    const check = manifest.routeChecks![0]!;
    check.expectedUrlPattern = "/booking/take/new/:shopNo";
    check.apiExpectation = { requirement: "required" };
    check.fixture.parameters = [
      {
        name: "shopNo",
        value: "test",
        provenance: "legacy-runtime",
        evidence: "레거시 화면의 임시 링크",
      },
    ];
    check.baseline.finalUrl = "/booking/take/new/test";
    check.target.finalUrl = "/booking/take/new/test";
    check.target.screenState = "blank";
    check.target.apiChecks = [
      {
        request: "GET /user/status/info",
        purpose: "auth",
        status: 404,
        result: "failed",
      },
    ];
    check.target.relevantNetworkErrors = ["CORS preflight 404"];
    manifest.visualTargets[0]!.criticalRegions = [
      { id: "whole-viewport", x: 0, y: 0, width: 10, height: 10 },
    ];

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.targets[0]?.status).toBe("failed");
    expect(report.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nextAction: expect.stringContaining("임의 값 test") }),
        expect.objectContaining({ nextAction: expect.stringContaining("전체 viewport") }),
      ]),
    );
    expect(report.markdown).toContain("CORS preflight 404");
    expect(report.markdown).toContain("GET /user/status/info (404 · failed)");
  });

  it("keeps Draft evidence generation running when a critical UI region is missing", async () => {
    const manifest = createManifest();
    manifest.visualTargets[0]!.criticalRegions = [];

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.targets[0]?.status).toBe("failed");
    expect(report.markdown).toContain("핵심 UI 영역이 유효하지 않음");
  });

  it("turns incomplete semantic proof into Gaps instead of blocking PR Markdown", async () => {
    const manifest = createManifest();
    const check = manifest.routeChecks![0]!;
    check.entry.action = "";
    check.target.assertions = [];
    check.target.auth.evidence = "";
    manifest.targetCodeProfile!.evidenceSources = ["missing-rules.md"];

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.markdown).toContain("## 핵심 Gap");
    expect(report.markdown).toContain("핵심 selector/text 확인이 없습니다");
    expect(report.markdown).toContain("대상 코드 규격 근거 파일을 찾을 수 없습니다");
  });

  it("requires explicit API applicability, concrete UI assertions, and completed diagnostics", async () => {
    const manifest = createManifest();
    const check = manifest.routeChecks![0]!;
    delete check.apiExpectation;
    check.target.assertions[0]!.expected = "";
    check.target.diagnosticsChecked = false;

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.routeValidation.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("API가 필요한지 여부"),
        expect.stringContaining("selector/text 기대값"),
        expect.stringContaining("콘솔·네트워크 진단"),
      ]),
    );
  });

  it("does not trust authenticated text without a 2xx auth request or matching user UI assertion", async () => {
    const manifest = createManifest();
    manifest.routeChecks![0]!.target.auth = {
      status: "passed",
      kind: "ui-assertion",
      evidence: "존재하지 않는 사용자 UI",
    };

    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot: await createProject(),
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.routeValidation.messages).toEqual(
      expect.arrayContaining([expect.stringContaining("인증 상태를 확인할 증거")]),
    );
  });

  it("requires a discovered legacy click navigation to be proven as an interaction", async () => {
    const projectRoot = await createProject();
    const inventoryPath = path.join(
      projectRoot,
      "spec-to-pr-evidence/mapfinder/legacy-source-inventory.json",
    );
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as {
      routes: Array<Record<string, unknown>>;
    };
    inventory.routes[0]!.scope = "migration";
    inventory.routes[0]!.kind = "navigation";
    await writeFile(inventoryPath, JSON.stringify(inventory), "utf8");

    const report = await buildLegacyEvidenceReport(createManifest(), {
      projectRoot,
      requireStaged: false,
    });

    expect(report.status).toBe("not-verified");
    expect(report.sourcePreservation.messages).toEqual(
      expect.arrayContaining([expect.stringContaining("직접 URL로만 검증")]),
    );
  });

  it("accepts a real dynamic fixture and renders compact route and code proof without empty sections", async () => {
    const manifest = createManifest();
    manifest.routeInventory[0]!.route = "/booking/take/new/:shopNo";
    const check = manifest.routeChecks![0]!;
    check.expectedUrlPattern = "/booking/take/new/:shopNo";
    check.apiExpectation = { requirement: "required" };
    check.fixture.parameters = [
      {
        name: "shopNo",
        value: "9327",
        provenance: "legacy-runtime",
        evidence: "홈 매장 카드 클릭 후 최종 URL",
      },
    ];
    check.baseline.finalUrl = "/booking/take/new/9327";
    check.target.finalUrl = "/booking/take/new/9327";
    check.baseline.apiChecks = [
      {
        request: "GET /user/status/info",
        purpose: "auth",
        status: 200,
        result: "passed",
      },
      {
        request: "GET /shops/9327",
        purpose: "data",
        status: 200,
        result: "passed",
      },
    ];
    check.target.apiChecks = [
      {
        request: "GET /user/status/info",
        purpose: "auth",
        status: 200,
        result: "passed",
      },
      {
        request: "GET /shops/9327",
        purpose: "data",
        status: 200,
        result: "passed",
      },
    ];

    const projectRoot = await createProject();
    const inventoryPath = path.join(
      projectRoot,
      "spec-to-pr-evidence/mapfinder/legacy-source-inventory.json",
    );
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as {
      routes: Array<{ route: string }>;
    };
    inventory.routes[0]!.route = "/booking/take/new/:shopNo";
    await writeFile(inventoryPath, JSON.stringify(inventory), "utf8");
    const report = await buildLegacyEvidenceReport(manifest, {
      projectRoot,
      requireStaged: false,
    });

    expect(report.status).toBe("verified");
    expect(report.markdown).toContain("## 라우트 동작 확인");
    expect(report.markdown).toContain("shopNo=9327 (legacy-runtime)");
    expect(report.markdown).toContain("## Vue 3 규격 이관");
    expect(report.markdown).not.toContain("## 핵심 Gap");
    expect(report.markdown).not.toContain("## 비교 제외");
  });

  it("marks preserved UI with Vue 2 compatibility code as a target-code Gap", async () => {
    const projectRoot = await createProject(`<script lang="js">
import { mapGetters } from './stores';
export default { mixins: [], computed: { ...mapGetters(['user']) } };
</script>
<template><main>Shop</main></template>
`);
    const manifest = createManifest();
    manifest.targetCodeProfile = {
      framework: "vue3",
      evidenceSources: ["AGENTS.md"],
      componentStyle: "script-setup",
      language: "typescript",
      stateManagement: "pinia",
      router: "not-applicable",
      legacyCompatibility: "forbidden",
    };

    const report = await buildLegacyEvidenceReport(manifest, { projectRoot, requireStaged: false });

    expect(report.status).toBe("not-verified");
    expect(report.codeConformance.status).toBe("gap");
    expect(report.markdown).toContain("0/1 script setup");
    expect(report.markdown).toContain("Vuex 호환 계층");
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
  await writeFile(path.join(projectRoot, "AGENTS.md"), "Use Vue 3 and TypeScript.\n");
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
    schemaVersion: 4,
    case: "legacy",
    change: "mapfinder",
    legacyProjectRoot: "/legacy/mapfinder",
    sourceInventoryPath: "legacy-source-inventory.json",
    targetPaths: ["apps/gzApp/src/pages/mapfinder"],
    capturePolicy: {
      preferredProvider: "computer-use",
      fallback: "browser-or-playwright-when-unavailable",
    },
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
        baselineCapture: {
          provider: "computer-use",
          authState: "authenticated",
          capturedAt: "2026-08-10T00:00:00.000Z",
        },
        attempts: [
          {
            actualPath: "actual-map-default.png",
            diffPath: "diff-map-default.png",
            capture: {
              provider: "computer-use",
              authState: "authenticated",
              capturedAt: "2026-08-10T00:00:01.000Z",
            },
          },
        ],
        criticalRegions: [{ id: "bottom-controls", x: 0, y: 0, width: 2, height: 2 }],
      },
    ],
    assetMappings: [],
    selectorMappings: [],
    breakpointMappings: [],
    runtimeMappings: [],
    routeChecks: [
      {
        id: "map-default",
        inventoryId: "map-default",
        entry: { type: "direct", action: "기본 지도 진입" },
        expectedUrlPattern: "/map",
        expectedScreen: "content",
        apiExpectation: { requirement: "not-required", reason: "정적 지도 shell 비교" },
        fixture: { summary: "QA 로그인 지도 fixture" },
        baseline: {
          finalUrl: "/map",
          screenState: "content",
          assertions: [
            {
              label: "지도 하단 컨트롤",
              kind: "selector",
              expected: ".map-controls",
              status: "passed",
            },
            {
              label: "사용자 로그인 상태",
              kind: "text",
              expected: "내 위치",
              status: "passed",
            },
          ],
          auth: {
            status: "passed",
            kind: "ui-assertion",
            evidence: "사용자 로그인 상태",
          },
          apiChecks: [],
          diagnosticsChecked: true,
          relevantConsoleErrors: [],
          relevantNetworkErrors: [],
        },
        target: {
          finalUrl: "/map",
          screenState: "content",
          assertions: [
            {
              label: "지도 하단 컨트롤",
              kind: "selector",
              expected: ".map-controls",
              status: "passed",
            },
            {
              label: "사용자 로그인 상태",
              kind: "text",
              expected: "내 위치",
              status: "passed",
            },
          ],
          auth: {
            status: "passed",
            kind: "ui-assertion",
            evidence: "사용자 로그인 상태",
          },
          apiChecks: [],
          diagnosticsChecked: true,
          relevantConsoleErrors: [],
          relevantNetworkErrors: [],
        },
      },
    ],
    targetCodeProfile: {
      framework: "vue3",
      evidenceSources: ["AGENTS.md"],
      componentStyle: "options-api-allowed",
      language: "mixed",
      stateManagement: "not-applicable",
      router: "not-applicable",
      legacyCompatibility: "allowed",
    },
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
