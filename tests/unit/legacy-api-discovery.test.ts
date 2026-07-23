import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { discoverLegacyApiCandidates } from "../../src/legacy/legacy-api-discovery.js";
import { discoverLegacySourceGraph } from "../../src/legacy/legacy-source-graph.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic legacy API discovery", () => {
  it("does not infer HTTP transports from ordinary receiver names", async () => {
    const graph = await fixture({
      "src/modules/shop/profile.ts": `
        const profileService = { get(id) { return { id }; } };
        const client = { post(value) { return value; } };
        const http = { request(value) { return value; } };
        function inspect(serviceClient) { return serviceClient.get(profileId); }
        profileService.get(profileId);
        client.post("/not-an-api");
        http.request({ method: "GET", url: "/still-not-an-api" });
        inspect({ get(id) { return id; } });
      `,
    });

    expect(discoverLegacyApiCandidates(graph)).toEqual([]);
  });

  it("resolves environment URL aliases embedded in endpoint templates", async () => {
    const graph = await fixture({
      "src/modules/shop/orders.ts": `
        import axios from "axios";
        const apiBase = process.env.API_URL;
        export const loadOrder = (id) => axios.get(\`${"${apiBase}"}/orders/${"${id}"}\`);
      `,
      ".env.qa": "API_URL=https://api.example.test/v2/\n",
    });

    expect(discoverLegacyApiCandidates(graph)).toEqual([
      expect.objectContaining({
        method: "GET",
        pathTemplate: "/orders/{id}",
        originRef: expect.objectContaining({
          kind: "environment",
          runtime: "process.env",
          name: "API_URL",
        }),
      }),
    ]);
  });

  it("retains configured base origins on created transport receivers", async () => {
    const graph = await fixture({
      "src/modules/shop/clients.ts": `
        import axios from "axios";
        import { httpService } from "@/api/httpService";
        const axiosClient = axios.create({ baseURL: process.env.API_URL });
        const customClient = new httpService({ baseURL: import.meta.env.VITE_BACKEND_URL });
        axiosClient.get("/shop");
        customClient.post("/checkout");
      `,
      "src/api/httpService.ts": `
        export class httpService {
          constructor(options) { this.options = options; }
          post(path) { return path; }
        }
      `,
      ".env.qa": [
        "API_URL=https://api.example.test/v2/",
        "VITE_BACKEND_URL=https://backend.example.test/",
      ].join("\n"),
    });

    const candidates = discoverLegacyApiCandidates(graph);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKey: "GET /shop",
          originRef: expect.objectContaining({ kind: "environment", name: "API_URL" }),
        }),
        expect.objectContaining({
          operationKey: "POST /checkout",
          originRef: expect.objectContaining({
            kind: "environment",
            name: "VITE_BACKEND_URL",
          }),
        }),
      ]),
    );
  });

  it("preserves literal baseURL path prefixes for axios and custom clients", async () => {
    const graph = await fixture({
      "src/modules/shop/clients.ts": `
        import axios from "axios";
        import { httpService } from "@/api/httpService";
        const axiosClient = axios.create({ baseURL: "https://api.example/v2" });
        const customClient = new httpService({ baseURL: "https://custom.example/gateway/v3/" });
        axiosClient.get("/shop");
        customClient.post("checkout");
      `,
      "src/api/httpService.ts": `
        export class httpService {
          constructor(options) { this.options = options; }
          post(path) { return path; }
        }
      `,
    });

    expect(discoverLegacyApiCandidates(graph)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKey: "GET /v2/shop",
          originRef: { kind: "literal", sanitizedOrigin: "https://api.example" },
        }),
        expect.objectContaining({
          operationKey: "POST /gateway/v3/checkout",
          originRef: { kind: "literal", sanitizedOrigin: "https://custom.example" },
        }),
      ]),
    );
  });

  it("preserves a path suffix on an environment-derived baseURL", async () => {
    const graph = await fixture({
      "src/modules/shop/client.ts": [
        'import axios from "axios";',
        "const gatewayBase = `${process.env.API_HOST}/v2`;",
        "const client = axios.create({ baseURL: gatewayBase });",
        'client.get("/shop");',
      ].join("\n"),
      ".env.qa": "API_HOST=https://api.example\n",
    });

    expect(discoverLegacyApiCandidates(graph)).toEqual([
      expect.objectContaining({
        operationKey: "GET /v2/shop",
        originRef: expect.objectContaining({
          kind: "environment",
          runtime: "process.env",
          name: "API_HOST",
        }),
      }),
    ]);
  });

  it("traces only the imported outside-root facade symbol to its terminal HTTP call", async () => {
    const graph = await fixture({
      "src/modules/shop/profile.ts": `
        import { loadProfile } from "@/api";
        export const showProfile = (id) => loadProfile(id);
      `,
      "src/api/index.ts": `
        export * from "./auditApi";
        export * from "./profileApi";
      `,
      "src/api/profileApi.ts": `
        import axios from "axios";
        export const loadProfile = (id) => axios.get(\`/profiles/${"${id}"}\`);
        export const removeProfile = (id) => axios.delete(\`/profiles/${"${id}"}\`);
      `,
      "src/api/auditApi.ts": `
        export const loadAuditLog = () => fetch("/audit-log");
      `,
    });

    const candidates = discoverLegacyApiCandidates(graph);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ method: "GET", pathTemplate: "/profiles/{id}" });
    expect(candidates[0]?.callSites).toEqual([
      expect.objectContaining({
        ownerSourcePath: "profile.ts",
        terminalSourcePath: "@app/src/api/profileApi.ts",
        wrapperChain: ["@app/src/api/profileApi.ts#loadProfile"],
      }),
    ]);
  });

  it("ignores non-production test, mock, story, and fixture API calls", async () => {
    const graph = await fixture({
      "src/modules/shop/index.ts": `
        import { loadReferencedFixture } from "./fixtures/referenced";
        import { loadSingularFixture } from "./fixture/referenced";
        export const loadShop = () => fetch("/production");
        export const loadReference = () => loadReferencedFixture();
        export const loadSingularReference = () => loadSingularFixture();
      `,
      "src/modules/shop/fixtures/referenced.ts":
        'export const loadReferencedFixture = () => fetch("/referenced-fixture");',
      "src/modules/shop/fixture/referenced.ts":
        'export const loadSingularFixture = () => fetch("/referenced-singular-fixture");',
      "src/modules/shop/fixtures/unreferenced.ts": 'fetch("/unreferenced-fixture");',
      "src/modules/shop/fixture/unreferenced.ts": 'fetch("/singular-fixture");',
      "src/modules/shop/__tests__/shop.ts": 'fetch("/test-directory");',
      "src/modules/shop/__mocks__/shop.ts": 'fetch("/mock-directory");',
      "src/modules/shop/shop.spec.ts": 'fetch("/spec-file");',
      "src/modules/shop/shop.test.ts": 'fetch("/test-file");',
      "src/modules/shop/Shop.stories.tsx": 'fetch("/story-file");',
      "src/modules/shop/stories/ShopStory.tsx": 'fetch("/story-directory");',
      "src/modules/shop/test/shop.ts": 'fetch("/singular-test-directory");',
      "src/modules/shop/spec/shop.ts": 'fetch("/singular-spec-directory");',
      "src/modules/shop/mock/shop.ts": 'fetch("/singular-mock-directory");',
      "src/modules/shop/story/ShopStory.tsx": 'fetch("/singular-story-directory");',
      "src/modules/shop/storybook/ShopStory.tsx": 'fetch("/storybook-directory");',
      "src/modules/shop/contest/normal.ts": 'fetch("/contest-production");',
      "src/modules/shop/history/normal.ts": 'fetch("/history-production");',
      "src/modules/shop/mockingbird/normal.ts": 'fetch("/mockingbird-production");',
      "src/modules/shop/fixture-tools/normal.ts": 'fetch("/fixture-tools-production");',
      "src/modules/shop/storybook-tools/normal.ts": 'fetch("/storybook-tools-production");',
    });

    expect(
      discoverLegacyApiCandidates(graph)
        .map((candidate) => candidate.operationKey)
        .sort(),
    ).toEqual(
      [
        "GET /contest-production",
        "GET /fixture-tools-production",
        "GET /history-production",
        "GET /mockingbird-production",
        "GET /production",
        "GET /referenced-fixture",
        "GET /referenced-singular-fixture",
        "GET /storybook-tools-production",
      ].sort(),
    );
  });

  it("ignores comments, strings, constructors, local wrappers, and unrelated SDK calls", async () => {
    const graph = await fixture({
      "src/modules/shop/api.js": `
        import { httpService } from "@/api/httpService";
        import { GetObjectCommand } from "@aws-sdk/client-s3";
        const text = "fetch('/string-only')";
        // fetch('/comment-only')
        const client = new httpService();
        const wrapper = { getGhomeInfo: () => client.get('/shop/1') };
        wrapper.getGhomeInfo();
        new GetObjectCommand({ Bucket: "assets" });
      `,
      "src/api/httpService.js": `
        import axios from "axios";
        export class httpService { get(url) { return axios.get(url); } }
      `,
    });

    const candidates = discoverLegacyApiCandidates(graph);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ method: "GET", pathTemplate: "/shop/1" });
    expect(candidates.map((item) => item.operationKey).join(" ")).not.toContain("getGhomeInfo");
    expect(candidates.map((item) => item.operationKey).join(" ")).not.toContain("GetObjectCommand");
  });

  it("handles fetch Request objects, optional calls, bracket access, direct axios, and local method options", async () => {
    const graph = await fixture({
      "src/modules/shop/api.ts": `
        import axios from "axios";
        const apiClient = axios.create({ baseURL: import.meta.env.VITE_API_URL });
        const updateOptions = { method: "PATCH", body: payload };
        fetch(new Request("/request", { method: "PUT" }));
        apiClient?.post("/optional", payload);
        apiClient["get"]("/bracket");
        axios("/direct", updateOptions);
        fetch("/nearby");
        const unrelated = { method: "DELETE" };
      `,
      ".env.qa": "VITE_API_URL=https://api.example.test/v2/\n",
    });

    const candidates = discoverLegacyApiCandidates(graph);

    expect(candidates.map((item) => item.operationKey).sort()).toEqual([
      "GET /bracket",
      "GET /nearby",
      "PATCH /direct",
      "POST /optional",
      "PUT /request",
    ]);
  });

  it("collapses the Shop API facade to eight endpoints while preserving origin, transport, and callsites", async () => {
    const graph = await fixture({
      "src/modules/shop/api/ghomeApi.js": `
        import { httpService, defaultHttpService } from "@/api/httpService";
        const axiosInstance = new httpService();
        const defaultAxiosInstance = new defaultHttpService();
        export default {
          async getGhomeInfo(rgnNo) {
            if (isApp) return axiosInstance.get(\`${"${process.env.VUE_APP_API_GW_V2_URL}"}shop/${"${rgnNo}"}\`);
            return defaultAxiosInstance.get(\`${"${process.env.VUE_APP_API_GW_V2_URL}"}shop/${"${rgnNo}"}\`);
          },
          notices(params) { return defaultAxiosInstance.get(\`${"${process.env.VUE_APP_API_GW_V2_URL}"}shop/${"${params.rgnNo}"}/notices\`, { params }); },
          tournament(params) { return defaultAxiosInstance.get(\`${"${process.env.VUE_APP_API_GW_V1_URL}"}shop/glf\`, { params }); },
          ranking(params) { return defaultAxiosInstance.get(\`${"${process.env.VUE_APP_API_GW_V1_URL}"}shop/ranking\`, { params }); },
          mine(params) { return axiosInstance.get(\`${"${process.env.VUE_APP_API_GW_V1_URL}"}shop/ranking/mine\`, { params }); },
          remove(rgnNo) { return axiosInstance.delete(\`${"${process.env.VUE_APP_API_GW_V2_URL}"}shop/${"${rgnNo}"}/favorite\`); },
          favorite(rgnNo) { return axiosInstance.patch(\`${"${process.env.VUE_APP_API_GW_V2_URL}"}shop/${"${rgnNo}"}/favorite\`); },
          images(rgnNo) { return axiosInstance.get(\`${"${process.env.VUE_APP_API_GW_LOUNGE_API}"}v1/franchise-reservation/shops/image/${"${rgnNo}"}\`); },
        };
      `,
      "src/api/httpService.js": `
        import axios from "axios";
        export class defaultHttpService { get(url) { return axios.get(url); } }
        export class httpService extends defaultHttpService {}
      `,
      ".env.qa": [
        "VUE_APP_API_GW_V1_URL=https://fairway.example/v1/",
        "VUE_APP_API_GW_V2_URL=https://fairway.example/v2/",
        "VUE_APP_API_GW_LOUNGE_API=https://lounge.example/",
      ].join("\n"),
    });

    const candidates = discoverLegacyApiCandidates(graph);

    expect(candidates).toHaveLength(8);
    expect(
      new Set(
        candidates.map((item) => item.originRef?.kind === "environment" && item.originRef.name),
      ),
    ).toEqual(
      new Set(["VUE_APP_API_GW_V1_URL", "VUE_APP_API_GW_V2_URL", "VUE_APP_API_GW_LOUNGE_API"]),
    );
    expect(
      new Set(candidates.flatMap((item) => item.callSites.map((site) => site.transportRef))),
    ).toEqual(new Set(["httpService", "defaultHttpService"]));
    const shopInfo = candidates.find(
      (item) =>
        item.method === "GET" &&
        item.pathTemplate === "/shop/{rgnNo}" &&
        item.originRef?.kind === "environment" &&
        item.originRef.name === "VUE_APP_API_GW_V2_URL",
    );
    expect(shopInfo?.callSites).toHaveLength(2);
  });
});

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-api-discovery-"));
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
    await writeFile(absolutePath, content, "utf8");
  }
  return discoverLegacySourceGraph(path.join(root, "src/modules/shop"));
}
