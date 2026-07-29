import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_SOURCE_DIGEST_ALGORITHM_V1,
  LEGACY_SOURCE_DIGEST_ALGORITHM_V2,
  discoverLegacySourceGraph,
} from "../../src/legacy/legacy-source-graph.js";
import {
  assertLegacyInventoryFresh,
  buildLegacyInventory,
  directoriesOverlap,
  mergeLegacyRuntimeNetworkEvidence,
} from "../../src/legacy/legacy-inventory.js";
import { LegacySourceCache } from "../../src/legacy/legacy-source-cache.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy inventory v3", () => {
  it("starts a fresh source snapshot for every public inventory build", async () => {
    const root = await temporaryLegacyProject();
    const sourcePath = path.join(root, "src", "route.ts");
    const cache = new LegacySourceCache();
    await writeFile(sourcePath, 'export const route = { path: "/before" };\n', "utf8");
    const before = await buildLegacyInventory(root, {}, { sourceCache: cache });

    await writeFile(sourcePath, 'export const route = { path: "/after" };\n', "utf8");
    const after = await buildLegacyInventory(root, {}, { sourceCache: cache });

    expect(after.rootDigest).not.toBe(before.rootDigest);
    expect(after.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ normalizedKey: "/after" })]),
    );
  });

  it("revalidates bytes when the same cache is reused across snapshots", async () => {
    const root = await temporaryLegacyProject();
    const sourcePath = path.join(root, "src", "route.ts");
    const cache = new LegacySourceCache();
    await writeFile(sourcePath, 'export const route = { path: "/before" };\n', "utf8");
    const pinned = await buildLegacyInventory(root, {}, { sourceCache: cache });

    await writeFile(sourcePath, 'export const route = { path: "/after" };\n', "utf8");

    await expect(assertLegacyInventoryFresh(root, pinned, { sourceCache: cache })).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
  });

  it("uses a fresh source snapshot for pre-fix-v3 compatibility rebuilds", async () => {
    const root = await temporaryLegacyProject();
    const sourcePath = path.join(root, "src", "route.ts");
    const cache = new LegacySourceCache();
    await writeFile(sourcePath, 'export const route = { path: "/before" };\n', "utf8");
    const preFixV3 = { ...(await buildLegacyInventory(root, {}, { sourceCache: cache })) };
    delete preFixV3.sourceEnvironmentRefs;
    delete preFixV3.sourceResolutionDecisions;

    await writeFile(sourcePath, 'export const route = { path: "/after" };\n', "utf8");

    await expect(
      assertLegacyInventoryFresh(root, preFixV3, { sourceCache: cache }),
    ).rejects.toThrow(/LEGACY_SOURCE_CHANGED/);
  });

  it("invalidates when referenced GW and URI environment origins change", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(path.join(root, "package.json"), '{"name":"environment-freshness"}\n', "utf8");
    const featureRoot = path.join(root, "src", "modules", "shop");
    await mkdir(featureRoot, { recursive: true });
    await writeFile(
      path.join(featureRoot, "client.ts"),
      [
        "export const gateway = process.env.SERVICE_GW;",
        "export const backend = import.meta.env.SERVICE_URI;",
      ].join("\n"),
      "utf8",
    );
    const environmentPath = path.join(root, ".env.qa");
    await writeFile(
      environmentPath,
      "SERVICE_GW=https://before.example/gw/\nSERVICE_URI=https://before.example/backend/\n",
      "utf8",
    );
    const pinned = await buildLegacyInventory(featureRoot);

    await writeFile(
      environmentPath,
      "SERVICE_GW=https://after.example/gw/\nSERVICE_URI=https://after.example/backend/\n",
      "utf8",
    );

    await expect(assertLegacyInventoryFresh(featureRoot, pinned)).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
  });

  it("uses identical per-file environment bounds for cold and warm manifests", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(path.join(root, "package.json"), '{"name":"bounded-environment"}\n', "utf8");
    const featureRoot = path.join(root, "src", "modules", "shop");
    await mkdir(featureRoot, { recursive: true });
    await writeFile(
      path.join(featureRoot, "client.ts"),
      "export const gateway = process.env.SERVICE_GW;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, ".env.qa"),
      `SERVICE_GW=https://legacy.example/${"x".repeat(2 * 1024 * 1024)}\n`,
      "utf8",
    );

    const pinned = await buildLegacyInventory(featureRoot);

    await expect(assertLegacyInventoryFresh(featureRoot, pinned)).resolves.toBe(pinned);
  });

  it("invalidates when a higher-priority supporting dependency appears", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(path.join(root, "package.json"), '{"name":"resolver-freshness"}\n', "utf8");
    const featureRoot = path.join(root, "src", "modules", "shop");
    const apiRoot = path.join(root, "src", "api");
    await mkdir(featureRoot, { recursive: true });
    await mkdir(apiRoot, { recursive: true });
    await writeFile(
      path.join(featureRoot, "index.ts"),
      'import { client } from "../../api/client"; export const feature = client;\n',
      "utf8",
    );
    await writeFile(
      path.join(apiRoot, "client.js"),
      "export const client = 'javascript';\n",
      "utf8",
    );
    const pinned = await buildLegacyInventory(featureRoot);

    await writeFile(
      path.join(apiRoot, "client.ts"),
      "export const client = 'typescript';\n",
      "utf8",
    );

    await expect(assertLegacyInventoryFresh(featureRoot, pinned)).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
  });

  it("invalidates when a previously unresolved bounded dependency appears", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "package.json"),
      '{"name":"missing-resolver-target"}\n',
      "utf8",
    );
    const featureRoot = path.join(root, "src", "modules", "shop");
    const apiRoot = path.join(root, "src", "api");
    await mkdir(featureRoot, { recursive: true });
    await mkdir(apiRoot, { recursive: true });
    await writeFile(
      path.join(featureRoot, "index.ts"),
      'import { client } from "../../api/missing"; export const feature = client;\n',
      "utf8",
    );
    const pinned = await buildLegacyInventory(featureRoot);

    expect(pinned).toHaveProperty(
      "sourceResolutionDecisions",
      expect.arrayContaining([
        expect.objectContaining({
          importer: "index.ts",
          specifier: "../../api/missing",
          resolvedPath: "@missing",
        }),
      ]),
    );

    await writeFile(
      path.join(apiRoot, "missing.ts"),
      "export const client = 'typescript';\n",
      "utf8",
    );

    await expect(assertLegacyInventoryFresh(featureRoot, pinned)).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
  });

  it("persists rejected conditional-export probes and refreshes them without a warm parse", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "package.json"),
      '{"name":"conditional-export-probe"}\n',
      "utf8",
    );
    const featureRoot = path.join(root, "src", "modules", "shop");
    const apiRoot = path.join(root, "src", "api");
    await mkdir(featureRoot, { recursive: true });
    await mkdir(apiRoot, { recursive: true });
    await writeFile(
      path.join(featureRoot, "profile.ts"),
      'import { loadProfile } from "../../api"; export const profile = loadProfile;\n',
      "utf8",
    );
    await writeFile(path.join(apiRoot, "index.ts"), 'export * from "./candidate";\n', "utf8");
    const candidatePath = path.join(apiRoot, "candidate.ts");
    await writeFile(candidatePath, "export const unrelated = true;\n", "utf8");
    const cache = new LegacySourceCache();
    const pinned = await buildLegacyInventory(featureRoot, {}, { sourceCache: cache });

    expect(pinned.sourceManifest?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ applicationRelativePath: "src/api/candidate.ts" }),
      ]),
    );
    const parsesAfterBuild = cache.snapshotStats().astParses;
    await expect(
      assertLegacyInventoryFresh(featureRoot, pinned, { sourceCache: cache }),
    ).resolves.toBe(pinned);
    expect(cache.snapshotStats().astParses).toBe(parsesAfterBuild);

    await writeFile(
      candidatePath,
      'export const loadProfile = () => fetch("/api/profile");\n',
      "utf8",
    );

    await expect(
      assertLegacyInventoryFresh(featureRoot, pinned, { sourceCache: cache }),
    ).rejects.toThrow(/LEGACY_SOURCE_CHANGED/);
  });

  it("persists missing recursive export decisions and invalidates when the target appears", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(path.join(root, "package.json"), '{"name":"recursive-export-probe"}\n', "utf8");
    const featureRoot = path.join(root, "src", "modules", "shop");
    const apiRoot = path.join(root, "src", "api");
    await mkdir(featureRoot, { recursive: true });
    await mkdir(apiRoot, { recursive: true });
    await writeFile(
      path.join(featureRoot, "profile.ts"),
      'import { loadProfile } from "../../api"; export const profile = loadProfile;\n',
      "utf8",
    );
    await writeFile(path.join(apiRoot, "index.ts"), 'export * from "./candidate";\n', "utf8");
    await writeFile(path.join(apiRoot, "candidate.ts"), 'export * from "./missing";\n', "utf8");
    const cache = new LegacySourceCache();
    const pinned = await buildLegacyInventory(featureRoot, {}, { sourceCache: cache });

    expect(pinned.sourceResolutionDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importer: "@app/src/api/candidate.ts",
          specifier: "./missing",
          resolvedPath: "@missing",
        }),
      ]),
    );
    const parsesAfterBuild = cache.snapshotStats().astParses;
    await expect(
      assertLegacyInventoryFresh(featureRoot, pinned, { sourceCache: cache }),
    ).resolves.toBe(pinned);
    expect(cache.snapshotStats().astParses).toBe(parsesAfterBuild);

    await writeFile(
      path.join(apiRoot, "missing.ts"),
      'export const loadProfile = () => fetch("/api/profile");\n',
      "utf8",
    );

    await expect(
      assertLegacyInventoryFresh(featureRoot, pinned, { sourceCache: cache }),
    ).rejects.toThrow(/LEGACY_SOURCE_CHANGED/);
  });

  it("truncates deterministically at the persisted resolver-decision bound", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "src", "index.ts"),
      Array.from(
        { length: 5_001 },
        (_, index) => `import "package-${String(index).padStart(4, "0")}";`,
      ).join("\n"),
      "utf8",
    );

    const inventory = await buildLegacyInventory(root, { maxElapsedMs: 20_000 });

    expect(inventory.truncated).toBe(true);
    expect(inventory.sourceResolutionDecisions).toHaveLength(5_000);
    expect(inventory.sourceResolutionDecisions?.[0]?.specifier).toBe("package-0000");
    expect(inventory.sourceResolutionDecisions?.at(-1)?.specifier).toBe("package-4999");
  }, 20_000);

  it("uses one cache across a deterministic 250-file cold, warm, and change cycle", async () => {
    const root = await temporaryLegacyProject();
    await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        writeFile(
          path.join(root, "src", `file-${String(index).padStart(3, "0")}.ts`),
          `export const route${index} = { path: "/route-${index}" };\n`,
          "utf8",
        ),
      ),
    );
    const sourceCache = new LegacySourceCache();

    const pinned = await buildLegacyInventory(root, {}, { sourceCache });

    expect(sourceCache.snapshotStats()).toMatchObject({
      fileReads: 250,
      astParses: 250,
      semanticRebuilds: 1,
    });
    expect(pinned.sourceManifestDigest).toBe(pinned.sourceManifest?.manifestDigest);

    const fresh = await assertLegacyInventoryFresh(root, pinned, { sourceCache });

    expect(fresh).toBe(pinned);
    expect(sourceCache.snapshotStats()).toMatchObject({
      fileReads: 500,
      astParses: 250,
      semanticRebuilds: 1,
    });

    await writeFile(
      path.join(root, "src", "file-125.ts"),
      'export const route125 = { path: "/changed" };\n',
      "utf8",
    );
    await expect(assertLegacyInventoryFresh(root, pinned, { sourceCache })).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
    expect(sourceCache.snapshotStats()).toMatchObject({
      fileReads: 1_000,
      astParses: 251,
      semanticRebuilds: 2,
    });
  });

  it("discovers bounded structural migration signals with stable feature keys", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "src", "checkout.tsx"),
      `
        export function CheckoutPage() {
          analytics.track("checkout_opened");
          return fetch("/api/checkout", { method: "POST" });
        }
        export const checkoutRoute = { path: "/checkout", component: CheckoutPage };
        export const checkoutStore = createStore({ persisted: localStorage.getItem("checkout") });
        window.ReactNativeWebView?.postMessage("checkout-complete");
      `,
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "global.css"),
      ":root { --brand: red; } body { margin: 0; }",
      "utf8",
    );

    const first = await buildLegacyInventory(root);
    await writeFile(
      path.join(root, "src", "checkout.tsx"),
      `export function CheckoutPage(){analytics.track("checkout_opened");return fetch("/api/checkout",{method:"POST"})}
       export const checkoutRoute={path:"/checkout",component:CheckoutPage};
       export const checkoutStore=createStore({persisted:localStorage.getItem("checkout")});
       window.ReactNativeWebView?.postMessage("checkout-complete");`,
      "utf8",
    );
    const reformatted = await buildLegacyInventory(root);

    expect(first.entries.map((entry) => entry.category)).toEqual(
      expect.arrayContaining([
        "route",
        "component",
        "api",
        "state",
        "persistence",
        "bridge",
        "analytics",
        "global-css",
      ]),
    );
    expect(reformatted.entries.map((entry) => entry.featureKey).sort()).toEqual(
      first.entries.map((entry) => entry.featureKey).sort(),
    );
    expect(first.scannedFiles).toBe(2);
    expect(first.truncated).toBe(false);
    expect(first.sourceDigestAlgorithm).toBe(LEGACY_SOURCE_DIGEST_ALGORITHM_V2);
  });

  it("preserves case-sensitive API paths and discovers configured request adapters", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "src", "api.ts"),
      `
        const cache = new Map();
        cache.get("/not-an-api");
        const commerce = axios.create({ baseURL: "/api" });
        apiClient.post("/API/Orders");
        apiClient.get("//user:password@api.example/v4/Thing?token=scheme-relative-secret#fragment");
        commerce.delete("/API/Orders/1");
        axios({ method: "PUT", url: "/v1/Orders/1" });
        http.request({ method: "PATCH", url: "/v1/OrderItems" });
        request({ path: "/v2/NeedsMethod?access_token=do-not-persist#fragment" });
        globalThis.fetch("https://user:password@api.example/v3/AccountID?token=do-not-persist#fragment", { method: "DELETE" });
        const backup = { url: "ftp://user:password@backup.example/archive?token=ftp-secret#fragment" };
        fetch(dynamicCheckoutUrl);
        import { useQuery } from "@apollo/client";
        import { capitalize } from "capitalize";
        import { getOrders } from "./api-client";
        import { GeneratedApiClient, getCheckout } from "./generated/api-client";
        import * as checkoutSdk from "./generated/sdk";
        const generatedClient = new GeneratedApiClient();
        const namespaceClient = new checkoutSdk.CheckoutApiClient();
        useQuery({ query: "orders" });
        capitalize("checkout");
        getOrders();
        getCheckout();
      `,
      "utf8",
    );

    const inventory = await buildLegacyInventory(root);
    const apiKeys = inventory.entries
      .filter((entry) => entry.category === "api")
      .map((entry) => entry.normalizedKey);

    expect(apiKeys).toEqual(
      expect.arrayContaining([
        "POST /API/Orders",
        "GET /v4/Thing",
        "DELETE /api/API/Orders/1",
        "PUT /v1/Orders/1",
        "PATCH /v1/OrderItems",
        "UNKNOWN /v2/NeedsMethod",
        "DELETE /v3/AccountID",
        "GET path:unknown",
        "GET operation:getCheckout",
        "GET operation:getOrders",
      ]),
    );
    expect(apiKeys).not.toContain("GET /not-an-api");
    expect(apiKeys).not.toContain("UNKNOWN operation:GeneratedApiClient");
    expect(apiKeys).not.toContain("UNKNOWN operation:CheckoutApiClient");
    expect(apiKeys).not.toContain("UNKNOWN operation:capitalize");
    expect(apiKeys).not.toContain("UNKNOWN operation:useQuery");
    expect(JSON.stringify(inventory)).not.toContain("do-not-persist");
    expect(JSON.stringify(inventory)).not.toContain("password@");
    expect(JSON.stringify(inventory)).not.toContain("scheme-relative-secret");
    expect(JSON.stringify(inventory)).not.toContain("ftp-secret");
    expect(inventory.apiDiscoveryAdapters).toEqual(
      expect.arrayContaining([
        "source-fetch-literal",
        "source-fetch-dynamic",
        "source-http-client",
        "source-request-config",
        "source-generated-client",
      ]),
    );
    expect(
      inventory.entries
        .filter((entry) => entry.category === "api")
        .every((entry) => entry.apiAdapter !== undefined && entry.evidenceConfidence !== undefined),
    ).toBe(true);
  });

  it("does not promote unreferenced test or fixture files into the feature inventory", async () => {
    const root = await temporaryLegacyProject();
    await mkdir(path.join(root, "src", "fixtures"), { recursive: true });
    await mkdir(path.join(root, "src", "__tests__"), { recursive: true });
    await writeFile(
      path.join(root, "src", "index.ts"),
      [
        'import "./fixtures/referenced";',
        'export const productionRoute = { path: "/production" };',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "fixtures", "referenced.ts"),
      'export const referencedRoute = { path: "/referenced-fixture" };\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "fixtures", "unreferenced.ts"),
      'export const unreferencedRoute = { path: "/unreferenced-fixture" };\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "__tests__", "route.test.ts"),
      'export const testRoute = { path: "/test-only" };\n',
      "utf8",
    );

    const inventory = await buildLegacyInventory(root);
    const routes = inventory.entries
      .filter((entry) => entry.category === "route")
      .map((entry) => entry.normalizedKey)
      .sort();

    expect(routes).toEqual(["/production", "/referenced-fixture"]);
  });

  it("does not duplicate Shop transport calls through local facades or constructors", async () => {
    const root = await temporaryLegacyProject();
    await mkdir(path.join(root, "api"), { recursive: true });
    await mkdir(path.join(root, "stores"), { recursive: true });
    await writeFile(
      path.join(root, "api", "ghomeApi.js"),
      [
        'import { httpService, defaultHttpService } from "@/api/httpService";',
        "const axiosInstance = new httpService();",
        "const defaultAxiosInstance = new defaultHttpService();",
        "export default {",
        "  getGhomeInfo(rgnNo, useDefault) {",
        "    return useDefault",
        "      ? defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}`)",
        "      : axiosInstance.get(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}`);",
        "  },",
        "  getRecentNoticeList(params) { return defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V2_URL}shop/${params.rgnNo}/notices`); },",
        "  getTournamentList() { return defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V1_URL}shop/glf`); },",
        "  getShopRanking() { return defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V1_URL}shop/ranking`); },",
        "  getMyRanking() { return axiosInstance.get(`${process.env.VUE_APP_API_GW_V1_URL}shop/ranking/mine`); },",
        "  deleteFavorite(rgnNo) { return axiosInstance.delete(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}/favorite`); },",
        "  pickFavorite(rgnNo) { return axiosInstance.patch(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}/favorite`); },",
        "  getGrxShopImageList(rgnNo) { return axiosInstance.get(`${process.env.VUE_APP_API_GW_LOUNGE_API}v1/franchise-reservation/shops/image/${rgnNo}`); },",
        "};",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "stores", "ghome.js"),
      [
        'import ghomeApi from "../api/ghomeApi";',
        "export const actions = {",
        "  info: (rgnNo) => ghomeApi.getGhomeInfo(rgnNo),",
        "  notices: (rgnNo) => ghomeApi.getRecentNoticeList(rgnNo),",
        "  tournaments: () => ghomeApi.getTournamentList(),",
        "  ranking: () => ghomeApi.getShopRanking(),",
        "  mine: () => ghomeApi.getMyRanking(),",
        "  images: (rgnNo) => ghomeApi.getGrxShopImageList(rgnNo),",
        "};",
      ].join("\n"),
      "utf8",
    );

    const inventory = await buildLegacyInventory(root);
    const apiEntries = inventory.entries.filter((entry) => entry.category === "api");

    expect(inventory.version).toBe(3);
    expect(inventory.apiState).toBe("detected");
    expect(inventory.apiCandidates).toHaveLength(8);
    expect(apiEntries.map((entry) => entry.normalizedKey).sort()).toEqual(
      [
        "DELETE /shop/{rgnNo}/favorite",
        "GET /shop/glf",
        "GET /shop/ranking",
        "GET /shop/ranking/mine",
        "GET /shop/{rgnNo}",
        "GET /shop/{rgnNo}/notices",
        "GET /v1/franchise-reservation/shops/image/{rgnNo}",
        "PATCH /shop/{rgnNo}/favorite",
      ].sort(),
    );
    expect(
      apiEntries.every(
        (entry) =>
          entry.sourcePath === "api/ghomeApi.js" &&
          entry.apiAdapter === "source-http-client" &&
          entry.evidenceConfidence === "high",
      ),
    ).toBe(true);
    expect(JSON.stringify(apiEntries)).not.toMatch(/operation:|process\.env/u);
    expect(
      new Set(
        inventory.apiCandidates.map((candidate) =>
          candidate.originRef?.kind === "environment" ? candidate.originRef.name : undefined,
        ),
      ),
    ).toEqual(
      new Set(["VUE_APP_API_GW_V1_URL", "VUE_APP_API_GW_V2_URL", "VUE_APP_API_GW_LOUNGE_API"]),
    );
  });

  it("normalizes only safe environment-base URL templates", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "src", "api.ts"),
      [
        "apiClient.get(`${process.env.API_BASE_URL}orders/${params.orderId}?token=do-not-persist`);",
        "apiClient.post(`${import.meta.env.VITE_API_BASE_URL}orders/${orderId}`);",
        "apiClient.get(`${process.env.API_TOKEN}orders/${orderId}`);",
        "apiClient.get(`${process.env.API_BASE_URL}orders/${buildOrderId()}`);",
        "apiClient.get(`${process.env.API_BASE_URL}orders/order-${orderId}`);",
        "apiClient.get(`${process.env.API_BASE_URL}https://other.example/orders`);",
        "apiClient.get(`${process.env.API_BASE_URL}//other.example/orders`);",
      ].join("\n"),
      "utf8",
    );

    const inventory = await buildLegacyInventory(root);
    const apiKeys = inventory.entries
      .filter((entry) => entry.category === "api")
      .map((entry) => entry.normalizedKey);

    expect(apiKeys).toContain("GET /orders/{orderId}");
    expect(apiKeys).toContain("POST /orders/{orderId}");
    expect(apiKeys).toContain("GET /{dynamic}orders/{orderId}");
    expect(apiKeys).toContain("GET /orders/{dynamic}");
    expect(apiKeys).toContain("GET /orders/order-{orderId}");
    expect(apiKeys).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("process.env"),
        expect.stringContaining("import.meta.env"),
      ]),
    );
    expect(JSON.stringify(inventory)).not.toContain("do-not-persist");
  });

  it("lists every bounded API discovery adapter even when no operation is found", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(path.join(root, "src", "plain.ts"), "export const answer = 42;\n", "utf8");

    const inventory = await buildLegacyInventory(root);

    expect(inventory.entries.filter((entry) => entry.category === "api")).toEqual([]);
    expect(inventory.apiDiscoveryAdapters).toEqual([
      "source-fetch-literal",
      "source-fetch-dynamic",
      "source-http-client",
      "source-request-config",
      "source-generated-client",
      "source-semantic-ast",
    ]);
  });

  it("merges bounded HAR requests as high-confidence runtime API evidence", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(
      path.join(root, "src", "checkout.ts"),
      'export async function submit(){ return http.request({ url: "/API/Checkout" }); }\n',
      "utf8",
    );
    const sourceInventory = await buildLegacyInventory(root);
    const merged = mergeLegacyRuntimeNetworkEvidence(
      sourceInventory,
      JSON.stringify({
        log: {
          entries: [
            { request: { method: "POST", url: "https://legacy.example/API/Checkout?retry=1" } },
          ],
        },
      }),
      "evidence/legacy.har",
    );

    expect(merged.sourceDigest).toBe(sourceInventory.rootDigest);
    expect(merged.rootDigest).not.toBe(sourceInventory.rootDigest);
    expect(merged.apiDiscoveryAdapters).toContain("runtime-network-har");
    expect(merged.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "api",
          normalizedKey: "POST /API/Checkout",
          sourcePath: "evidence/legacy.har",
          apiAdapter: "runtime-network-har",
          evidenceConfidence: "high",
        }),
      ]),
    );
    const fresh = await assertLegacyInventoryFresh(root, merged);
    expect(fresh).toBe(merged);
    expect(fresh.rootDigest).toBe(merged.rootDigest);
  });

  it("promotes only API resource types from HAR while retaining explicit request arrays", async () => {
    const root = await temporaryLegacyProject();
    const inventory = await buildLegacyInventory(root);
    const fromHar = mergeLegacyRuntimeNetworkEvidence(
      inventory,
      JSON.stringify({
        log: {
          entries: [
            ...[
              ["document", "/"],
              ["script", "/assets/app.js"],
              ["stylesheet", "/assets/app.css"],
              ["image", "/assets/logo.png"],
              ["font", "/assets/brand.woff2"],
              ["media", "/assets/intro.mp4"],
              ["beacon", "/telemetry/beacon"],
              ["analytics", "/analytics/collect"],
              ["xhr", "/api/shops"],
              ["fetch", "/api/orders"],
            ].map(([resourceType, url]) => ({
              _resourceType: resourceType,
              request: { method: "GET", url: `https://legacy.example${url}` },
            })),
            {
              _resourceType: "fetch",
              request: { method: "GET", url: "https://legacy.example/assets/fetched.js" },
              response: { content: { mimeType: "application/javascript" } },
            },
            {
              request: { method: "GET", url: "https://legacy.example/untyped-page" },
              response: { content: { mimeType: "text/html" } },
            },
            {
              request: { method: "GET", url: "https://legacy.example/api/untyped" },
              response: { content: { mimeType: "application/json" } },
            },
          ],
        },
      }),
      "evidence/legacy.har",
    );

    expect(
      fromHar.apiCandidates
        .filter((candidate) => candidate.witnesses.some((witness) => witness.kind === "runtime"))
        .map((candidate) => candidate.operationKey)
        .sort(),
    ).toEqual(["GET /api/orders", "GET /api/shops", "GET /api/untyped", "GET /assets/fetched.js"]);

    const fromExplicitRequests = mergeLegacyRuntimeNetworkEvidence(
      inventory,
      JSON.stringify({ requests: [{ method: "GET", url: "/assets/explicit.js" }] }),
      "evidence/explicit-requests.json",
    );
    expect(fromExplicitRequests.apiCandidates.map((candidate) => candidate.operationKey)).toContain(
      "GET /assets/explicit.js",
    );
  });

  it("trusts explicit HAR API resource types before response and asset heuristics", async () => {
    const root = await temporaryLegacyProject();
    const inventory = await buildLegacyInventory(root);
    const merged = mergeLegacyRuntimeNetworkEvidence(
      inventory,
      JSON.stringify({
        log: {
          entries: [
            {
              _resourceType: "fetch",
              request: {
                method: "GET",
                url: "https://legacy.example/reports/monthly.pdf",
                headers: [{ name: "Sec-Fetch-Dest", value: "document" }],
              },
              response: { content: { mimeType: "application/pdf" } },
            },
            {
              resourceType: "xhr",
              request: { method: "GET", url: "https://legacy.example/fragments/shop.html" },
              response: { content: { mimeType: "text/html; charset=utf-8" } },
            },
            {
              request: {
                method: "GET",
                url: "https://legacy.example/streams/updates.js",
                resourceType: "eventsource",
              },
              response: { content: { mimeType: "application/javascript" } },
            },
            {
              _resourceType: "script",
              request: { method: "GET", url: "https://legacy.example/api/script-data" },
              response: { content: { mimeType: "application/json" } },
            },
            {
              _resourceType: "document",
              request: { method: "GET", url: "https://legacy.example/api/document-data" },
              response: { content: { mimeType: "application/json" } },
            },
            {
              _resourceType: "image",
              request: { method: "GET", url: "https://legacy.example/api/image-data" },
              response: { content: { mimeType: "application/json" } },
            },
          ],
        },
      }),
      "evidence/legacy.har",
    );

    expect(
      merged.apiCandidates
        .filter((candidate) => candidate.witnesses.some((witness) => witness.kind === "runtime"))
        .map((candidate) => candidate.operationKey)
        .sort(),
    ).toEqual(
      ["GET /fragments/shop.html", "GET /reports/monthly.pdf", "GET /streams/updates.js"].sort(),
    );
  });

  it("rejects malformed or unbounded runtime network evidence", async () => {
    const root = await temporaryLegacyProject();
    const inventory = await buildLegacyInventory(root);

    expect(() =>
      mergeLegacyRuntimeNetworkEvidence(inventory, "not json", "evidence/legacy.har"),
    ).toThrow(/JSON/i);
    expect(() =>
      mergeLegacyRuntimeNetworkEvidence(
        inventory,
        JSON.stringify([{ url: "/API/Checkout" }]),
        "evidence/legacy.json",
      ),
    ).toThrow(/method/i);
    expect(() =>
      mergeLegacyRuntimeNetworkEvidence(
        inventory,
        JSON.stringify(
          Array.from({ length: 1_001 }, () => ({ method: "GET", url: "/API/Checkout" })),
        ),
        "evidence/legacy.json",
      ),
    ).toThrow(/1,000|1000|limit/i);
    expect(() =>
      mergeLegacyRuntimeNetworkEvidence(
        inventory,
        JSON.stringify({
          log: {
            entries: Array.from({ length: 1_001 }, () => ({
              _resourceType: "image",
              request: { method: "GET", url: "/assets/logo.png" },
            })),
          },
        }),
        "evidence/legacy.har",
      ),
    ).toThrow(/1,000|1000|limit/i);
    expect(() =>
      mergeLegacyRuntimeNetworkEvidence(
        inventory,
        JSON.stringify({
          log: {
            entries: [
              {
                _resourceType: "image",
                request: { method: "UNSUPPORTED", url: "/assets/logo.png" },
              },
            ],
          },
        }),
        "evidence/legacy.har",
      ),
    ).toThrow(/method/i);
    expect(() =>
      mergeLegacyRuntimeNetworkEvidence(
        inventory,
        " ".repeat(1024 * 1024 + 1),
        "evidence/legacy.har",
      ),
    ).toThrow(/1 MB|limit/i);
  });

  it("does not mutate the legacy tree while scanning", async () => {
    const root = await temporaryLegacyProject();
    const file = path.join(root, "src", "route.ts");
    const source = 'export const route = { path: "/orders" };\n';
    await writeFile(file, source, "utf8");

    await buildLegacyInventory(root);

    await expect(
      import("node:fs/promises").then(({ readFile }) => readFile(file, "utf8")),
    ).resolves.toBe(source);
  });

  it("treats equal, ancestor, and descendant directories as overlapping", () => {
    expect(directoriesOverlap("/tmp/project", "/tmp/project")).toBe(true);
    expect(directoriesOverlap("/tmp/project", "/tmp/project/legacy")).toBe(true);
    expect(directoriesOverlap("/tmp/project/target", "/tmp/project")).toBe(true);
    expect(directoriesOverlap("/tmp/project-a", "/tmp/project-b")).toBe(false);
  });

  it("counts irrelevant entries and stops at the independent entry budget", async () => {
    const root = await temporaryLegacyProject();
    await writeFile(path.join(root, "README.md"), "ignored", "utf8");
    await writeFile(path.join(root, "notes.txt"), "ignored", "utf8");

    const inventory = await buildLegacyInventory(root, { maxEntries: 2 });

    expect(inventory.truncated).toBe(true);
    expect(inventory.visitedEntries).toBe(3);
  });

  it("stops at the directory-depth and elapsed-time budgets", async () => {
    const root = await temporaryLegacyProject();
    await mkdir(path.join(root, "src", "a", "b"), { recursive: true });
    await writeFile(path.join(root, "src", "a", "b", "route.ts"), "export const A = () => 1");

    const depthLimited = await buildLegacyInventory(root, { maxDepth: 1 });
    const timeLimited = await buildLegacyInventory(root, { maxElapsedMs: 0 });

    expect(depthLimited.truncated).toBe(true);
    expect(timeLimited.truncated).toBe(true);
  });

  it("detects mutation and refuses a truncated pinned inventory", async () => {
    const root = await temporaryLegacyProject();
    const source = path.join(root, "src", "route.ts");
    await writeFile(source, 'export const route = { path: "/orders" };\n', "utf8");
    const pinned = await buildLegacyInventory(root);

    await writeFile(source, 'export const route = { path: "/changed" };\n', "utf8");
    await expect(assertLegacyInventoryFresh(root, pinned)).rejects.toThrow(/LEGACY_SOURCE_CHANGED/);
    await expect(assertLegacyInventoryFresh(root, { ...pinned, truncated: true })).rejects.toThrow(
      /LEGACY_INVENTORY_TRUNCATED/,
    );
  });

  it("resumes an unchanged 0.3.1 Run with its original digest and still detects source changes", async () => {
    const applicationRoot = await temporaryLegacyProject();
    await writeFile(
      path.join(applicationRoot, "package.json"),
      '{"name":"legacy-compatibility-fixture"}\n',
      "utf8",
    );
    const featureRoot = path.join(applicationRoot, "src", "modules", "shop");
    await mkdir(featureRoot, { recursive: true });
    await mkdir(path.join(applicationRoot, "src", "api"), { recursive: true });
    await writeFile(
      path.join(featureRoot, "profile.ts"),
      'import { loadProfile } from "../../api"; export const profile = (id) => loadProfile(id);\n',
      "utf8",
    );
    await writeFile(
      path.join(applicationRoot, "src", "api", "index.ts"),
      'export * from "./profileApi";\nexport * from "./ordersApi";\n',
      "utf8",
    );
    const profileApiPath = path.join(applicationRoot, "src", "api", "profileApi.ts");
    await writeFile(
      profileApiPath,
      "export const loadProfile = (id) => fetch(`/profiles/${id}`);\n",
      "utf8",
    );
    await writeFile(
      path.join(applicationRoot, "src", "api", "ordersApi.ts"),
      'export const loadOrders = () => fetch("/orders");\n',
      "utf8",
    );

    const current = await buildLegacyInventory(featureRoot);
    const legacyGraph = await discoverLegacySourceGraph(
      featureRoot,
      {},
      { digestAlgorithm: LEGACY_SOURCE_DIGEST_ALGORITHM_V1 },
    );
    const { sourceDigestAlgorithm: _newAlgorithm, ...withoutAlgorithm } = current;
    const pinnedFrom031 = {
      ...withoutAlgorithm,
      rootDigest: legacyGraph.sourceDigest,
      sourceDigest: legacyGraph.sourceDigest,
    };

    await expect(assertLegacyInventoryFresh(featureRoot, pinnedFrom031)).resolves.toMatchObject({
      sourceDigestAlgorithm: LEGACY_SOURCE_DIGEST_ALGORITHM_V2,
    });

    await writeFile(
      profileApiPath,
      "export const loadProfile = (id) => fetch(`/changed-profiles/${id}`);\n",
      "utf8",
    );
    await expect(assertLegacyInventoryFresh(featureRoot, pinnedFrom031)).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
  });

  it("keeps the root-only digest contract when checking a persisted v2 Run", async () => {
    const root = await temporaryLegacyProject();
    const sourcePath = path.join(root, "src", "route.ts");
    const source = 'export const route = { path: "/orders" };\n';
    await writeFile(sourcePath, source, "utf8");
    const current = await buildLegacyInventory(root);
    const legacyV2Digest = `sha256:${createHash("sha256")
      .update("src/route.ts")
      .update("\0")
      .update(source)
      .update("\0")
      .digest("hex")}` as const;
    const { sourceDigestAlgorithm: _newAlgorithm, ...withoutAlgorithm } = current;
    const pinnedV2 = {
      ...withoutAlgorithm,
      version: 2 as const,
      rootDigest: legacyV2Digest,
      sourceDigest: legacyV2Digest,
    };

    await expect(assertLegacyInventoryFresh(root, pinnedV2)).resolves.toMatchObject({
      sourceDigestAlgorithm: LEGACY_SOURCE_DIGEST_ALGORITHM_V2,
    });

    await writeFile(sourcePath, 'export const route = { path: "/changed" };\n', "utf8");
    await expect(assertLegacyInventoryFresh(root, pinnedV2)).rejects.toThrow(
      /LEGACY_SOURCE_CHANGED/,
    );
  });
});

async function temporaryLegacyProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-inventory-"));
  directories.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
}
