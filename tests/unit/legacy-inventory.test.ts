import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertLegacyInventoryFresh,
  buildLegacyInventory,
  directoriesOverlap,
  mergeLegacyRuntimeNetworkEvidence,
} from "../../src/legacy/legacy-inventory.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy inventory v2", () => {
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
        "GET //api.example/v4/Thing",
        "DELETE /API/Orders/1",
        "PUT /v1/Orders/1",
        "PATCH /v1/OrderItems",
        "UNKNOWN /v2/NeedsMethod",
        "DELETE https://api.example/v3/AccountID",
        "UNKNOWN dynamic:fetch:dynamicCheckoutUrl",
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
    expect(apiKeys).toContain("GET ${process.env.API_TOKEN}orders/${orderId}");
    expect(apiKeys).toContain("GET ${process.env.API_BASE_URL}orders/${buildOrderId()}");
    expect(apiKeys).toContain("GET ${process.env.API_BASE_URL}orders/order-${orderId}");
    expect(apiKeys).toContain("GET ${process.env.API_BASE_URL}https://other.example/orders");
    expect(apiKeys).toContain("GET ${process.env.API_BASE_URL}//other.example/orders");
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
    await expect(assertLegacyInventoryFresh(root, merged)).resolves.toMatchObject({
      rootDigest: sourceInventory.rootDigest,
    });
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
});

async function temporaryLegacyProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-inventory-"));
  directories.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
}
