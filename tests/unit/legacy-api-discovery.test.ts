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
