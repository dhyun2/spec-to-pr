import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  LEGACY_SOURCE_DIGEST_ALGORITHM_V1,
  LEGACY_SOURCE_DIGEST_ALGORITHM_V2,
  discoverLegacySourceGraph,
} from "../../src/legacy/legacy-source-graph.js";
import { LegacySourceCache } from "../../src/legacy/legacy-source-cache.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("legacy source graph", () => {
  it("starts a fresh source snapshot for every public graph discovery", async () => {
    const project = await vueFixture({
      "src/route.ts": 'export const route = { path: "/before" };',
    });
    const sourcePath = path.join(project, "src", "route.ts");
    const cache = new LegacySourceCache();
    const before = await discoverLegacySourceGraph(
      path.join(project, "src"),
      {},
      { sourceCache: cache },
    );

    await writeFile(sourcePath, 'export const route = { path: "/after" };\n', "utf8");
    const after = await discoverLegacySourceGraph(
      path.join(project, "src"),
      {},
      { sourceCache: cache },
    );

    expect(after.sourceDigest).not.toBe(before.sourceDigest);
    expect(after.files.find((file) => file.sourcePath === "route.ts")?.content).toContain("/after");
  });

  it("reads and parses each of 250 included code files at most once", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [
        `src/file-${String(index).padStart(3, "0")}.ts`,
        `export const value${index} = ${index};`,
      ]),
    );
    const project = await vueFixture(files);
    const cache = new LegacySourceCache();

    const graph = await discoverLegacySourceGraph(
      path.join(project, "src"),
      {},
      { sourceCache: cache },
    );

    expect(graph.files).toHaveLength(250);
    expect(cache.snapshotStats()).toMatchObject({
      fileReads: 251,
      astParses: 250,
    });
  });

  it("follows only the requested symbol through a supporting barrel", async () => {
    const project = await vueFixture({
      "src/modules/shop/profile.ts":
        'import { loadProfile } from "@/api"; export const profile = (id) => loadProfile(id);',
      "src/api/index.ts": ['export * from "./profileApi";', 'export * from "./ordersApi";'].join(
        "\n",
      ),
      "src/api/profileApi.ts":
        'import axios from "axios"; export const loadProfile = (id) => axios.get(`/profiles/${id}`);',
      "src/api/ordersApi.ts":
        'import axios from "axios"; export const loadOrders = () => axios.get("/orders");',
    });

    const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

    expect(graph.digestAlgorithm).toBe(LEGACY_SOURCE_DIGEST_ALGORITHM_V2);
    expect(graph.supportingFiles.map((file) => file.applicationRelativePath)).toEqual([
      "src/api/index.ts",
      "src/api/profileApi.ts",
    ]);
    expect(JSON.stringify(graph.files)).not.toContain("ordersApi.ts");
    expect(JSON.stringify(graph.edges)).not.toContain("ordersApi.ts");
    expect(graph.resolutionDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: "./ordersApi",
          resolvedPath: "src/api/ordersApi.ts",
        }),
      ]),
    );

    await writeFile(
      path.join(project, "src/api/ordersApi.ts"),
      'export const loadOrders = () => fetch("/changed-but-unreferenced");\n',
      "utf8",
    );
    const afterSiblingChange = await discoverLegacySourceGraph(
      path.join(project, "src/modules/shop"),
    );
    expect(afterSiblingChange.sourceDigest).toBe(graph.sourceDigest);
  });

  it("can reproduce the 0.3.1 all-import source digest for persisted Runs", async () => {
    const project = await vueFixture({
      "src/modules/shop/profile.ts":
        'import { loadProfile } from "@/api"; export const profile = (id) => loadProfile(id);',
      "src/api/index.ts": ['export * from "./profileApi";', 'export * from "./ordersApi";'].join(
        "\n",
      ),
      "src/api/profileApi.ts":
        'import axios from "axios"; export const loadProfile = (id) => axios.get(`/profiles/${id}`);',
      "src/api/ordersApi.ts":
        'import axios from "axios"; export const loadOrders = () => axios.get("/orders");',
    });

    const selected = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));
    const legacy = await discoverLegacySourceGraph(
      path.join(project, "src/modules/shop"),
      {},
      { digestAlgorithm: LEGACY_SOURCE_DIGEST_ALGORITHM_V1 },
    );

    expect(legacy.digestAlgorithm).toBe(LEGACY_SOURCE_DIGEST_ALGORITHM_V1);
    expect(legacy.supportingFiles.map((file) => file.applicationRelativePath)).toEqual([
      "src/api/index.ts",
      "src/api/ordersApi.ts",
      "src/api/profileApi.ts",
    ]);
    expect(legacy.sourceDigest).not.toBe(selected.sourceDigest);
  });

  it("counts export inspection reads against the graph budget and reports truncation", async () => {
    const featureSource =
      'import { missingExport } from "@/api"; export const profile = missingExport;';
    const exports = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `src/api/unrelated-${index}.ts`,
        `export const unrelated${index} = ${index};`,
      ]),
    );
    const project = await vueFixture({
      "src/modules/shop/profile.ts": featureSource,
      "src/api/index.ts": Array.from(
        { length: 5 },
        (_, index) => `export * from "./unrelated-${index}";`,
      ).join("\n"),
      ...exports,
    });

    const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"), {
      maxFiles: 3,
    });

    expect(graph.truncated).toBe(true);
    expect(graph.truncation?.limit).toBe("maxFiles");

    const byteLimited = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"), {
      maxBytes: Buffer.byteLength(`${featureSource}\n`, "utf8") + 1,
    });
    expect(byteLimited.truncated).toBe(true);
    expect(byteLimited.truncation?.limit).toBe("maxBytes");
  });

  it("resolves an enclosing Vue alias without discovering sibling features", async () => {
    const project = await vueFixture({
      "src/modules/shop/api.js":
        'import { httpService } from "@/api/httpService"; export const api = new httpService();',
      "src/api/httpService.js":
        'import axios from "axios"; export class httpService { get(path) { return axios.get(path); } }',
      "src/modules/booking/payment.js": 'fetch("/booking/payment")',
    });

    const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

    expect(graph.applicationRoot).toBe(await realpath(project));
    expect(graph.ownedFiles.map((file) => file.sourcePath)).toContain("api.js");
    expect(graph.supportingFiles.map((file) => file.applicationRelativePath)).toContain(
      "src/api/httpService.js",
    );
    expect(JSON.stringify(graph)).not.toContain("booking/payment.js");
  });

  it("records referenced environment names without exposing unrelated values", async () => {
    const project = await vueFixture({
      "src/modules/shop/api.js": "export const url = `${process.env.VUE_APP_API_GW_V2_URL}shop`;",
      ".env.qa":
        "VUE_APP_API_GW_V2_URL=https://fairway.example/v2/\nUNRELATED_SECRET=must-not-appear\n",
    });

    const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

    expect(graph.environmentRefs).toEqual([
      expect.objectContaining({
        name: "VUE_APP_API_GW_V2_URL",
        runtime: "process.env",
        sanitizedOrigin: "https://fairway.example/v2/",
        sanitizedOrigins: [{ sourceName: ".env.qa", origin: "https://fairway.example/v2/" }],
      }),
    ]);
    expect(JSON.stringify(graph)).not.toContain("must-not-appear");
  });

  it("bounds environment evidence with the shared source-read budget", async () => {
    const featureSource = "export const url = `${process.env.VUE_APP_API_GW_V2_URL}shop`;";
    const environmentFiles = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `.env.${String(index).padStart(3, "0")}`,
        "VUE_APP_API_GW_V2_URL=https://fairway.example/v2/",
      ]),
    );
    const project = await vueFixture({
      "src/modules/shop/api.js": featureSource,
      ...environmentFiles,
    });

    const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

    expect(graph.truncated).toBe(true);
    expect(graph.truncation).toEqual({
      limit: "maxFiles",
      sourcePath: "@app/.env.100",
    });
    expect(graph.environmentRefs[0]?.sanitizedOrigins).toHaveLength(100);

    const byteLimited = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"), {
      maxBytes: Buffer.byteLength(`${featureSource}\n`, "utf8") + 1,
    });
    expect(byteLimited.truncated).toBe(true);
    expect(byteLimited.truncation).toEqual({
      limit: "maxBytes",
      sourcePath: "@app/.env.000",
    });
  });

  it("keeps ordinary app directories and falls back to the feature root without a package marker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-graph-rootless-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(path.join(root, "app", "api.ts"), 'fetch("/inside-app")\n', "utf8");

    const graph = await discoverLegacySourceGraph(root);

    expect(graph.applicationRoot).toBe(await realpath(root));
    expect(graph.ownedFiles.map((file) => file.sourcePath)).toContain("app/api.ts");
  });
});

async function vueFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-graph-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "package.json"), '{"name":"legacy-fixture"}\n', "utf8");
  await writeFile(
    path.join(root, "vue.config.js"),
    "const path = require('path'); module.exports = { configureWebpack: { resolve: { alias: { '@': path.join(__dirname, 'src/') } } } };\n",
    "utf8",
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${content}\n`, "utf8");
  }
  return root;
}
