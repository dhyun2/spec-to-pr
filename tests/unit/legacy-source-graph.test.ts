import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { discoverLegacySourceGraph } from "../../src/legacy/legacy-source-graph.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy source graph", () => {
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
      "src/modules/shop/api.js":
        "export const url = `${process.env.VUE_APP_API_GW_V2_URL}shop`;",
      ".env.qa":
        "VUE_APP_API_GW_V2_URL=https://fairway.example/v2/\nUNRELATED_SECRET=must-not-appear\n",
    });

    const graph = await discoverLegacySourceGraph(path.join(project, "src/modules/shop"));

    expect(graph.environmentRefs).toEqual([
      expect.objectContaining({
        name: "VUE_APP_API_GW_V2_URL",
        runtime: "process.env",
        sanitizedOrigin: "https://fairway.example/v2/",
      }),
    ]);
    expect(JSON.stringify(graph)).not.toContain("must-not-appear");
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
