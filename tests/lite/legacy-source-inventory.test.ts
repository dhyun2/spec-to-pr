import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectLegacySourceInventory } from "../../scripts/lite/legacy-source-inventory.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy source inventory", () => {
  it("keeps sourcePaths bounded while following relative and @/ supporting imports cycle-safely", async () => {
    const root = await createLegacyProject();
    await Promise.all([
      writeSource(
        root,
        "src/modules/mapfinder/Main.vue",
        [
          "import ShopMap from '../../components/ShopMap/index.vue';",
          "import kakaoMap from '@/utils/kakaoMap';",
          "import VueAwesomeSwiper from 'vue-awesome-swiper';",
          "import Swiper from 'swiper/core';",
          "void ShopMap; void kakaoMap; void VueAwesomeSwiper; void Swiper;",
        ].join("\n"),
      ),
      writeSource(
        root,
        "src/components/ShopMap/index.vue",
        "import Main from '../../modules/mapfinder/Main.vue';\nconst supportRoutes = [{ path: '/shared-map-debug' }];\nwindow.kakao.maps.Map;\nvoid Main; void supportRoutes;\n",
      ),
      writeSource(root, "src/utils/kakaoMap.ts", "export const createMap = () => 'map';\n"),
    ]);

    const inventory = await collectLegacySourceInventory({
      legacyProjectRoot: root,
      sourcePaths: ["src/modules/mapfinder"],
    });

    expect(inventory.sourcePaths).toEqual(["src/modules/mapfinder"]);
    expect(inventory.supportingDependencies).toEqual([
      expect.objectContaining({
        sourceFile: "src/components/ShopMap/index.vue",
        importedBy: ["src/modules/mapfinder/Main.vue"],
        specifiers: ["../../components/ShopMap/index.vue"],
      }),
      expect.objectContaining({
        sourceFile: "src/utils/kakaoMap.ts",
        importedBy: ["src/modules/mapfinder/Main.vue"],
        specifiers: ["@/utils/kakaoMap"],
      }),
    ]);
    expect(inventory.runtimeDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marker: "kakao-map-wrapper", kind: "map-sdk" }),
        expect.objectContaining({ marker: "kakao.maps.Map", kind: "map-sdk" }),
        expect.objectContaining({ marker: "vue-awesome-swiper", kind: "carousel" }),
        expect.objectContaining({ marker: "Swiper", kind: "carousel" }),
      ]),
    );
    expect(inventory.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: "/shared-map-debug", scope: "supporting" }),
      ]),
    );
    expect(inventory.warnings).toEqual([]);
  });

  it("collects declared and navigated routes and normalizes template parameters", async () => {
    const root = await createLegacyProject();
    await writeSource(
      root,
      "src/modules/booking/routes.vue",
      [
        "const routes = [{ path: '/booking' }];",
        "router.push(`/booking/take/new/${shopNo}`);",
        "this.$router.replace('/booking/history');",
        "window.location.href = `/booking/result/${reservation.id}`;",
        "location.assign('/booking/login');",
        "utils.viewOpen(`/booking/manage/${item['bookingId']}`);",
        "const detailUrl = `${utils.getDomain()}/booking/#/booking/take/new/${shopNo}`;",
        "utils.viewOpen(detailUrl);",
        '<router-link to="/booking/help">Help</router-link>',
        '<a :href="`/booking/shop/${shop.shopNo}`">Shop</a>',
        '<img src="/assets/logo.png">',
      ].join("\n"),
    );

    const inventory = await collectLegacySourceInventory({
      legacyProjectRoot: root,
      sourcePaths: ["src/modules/booking"],
    });

    expect(inventory.routes.map((route) => route.route)).toEqual([
      "/booking",
      "/booking/help",
      "/booking/history",
      "/booking/login",
      "/booking/manage/:bookingId",
      "/booking/result/:id",
      "/booking/shop/:shopNo",
      "/booking/take/new/:shopNo",
    ]);
    expect(inventory.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: "/booking", kind: "declaration" }),
        expect.objectContaining({ route: "/booking/take/new/:shopNo", kind: "navigation" }),
      ]),
    );
  });

  it("keeps shared dependencies out of the bounded CSS contract and ignores dynamic links", async () => {
    const root = await createLegacyProject();
    await Promise.all([
      writeSource(
        root,
        "src/modules/shop/page.scss",
        "@import '../../styles/base';\n.shop-page { background: url('./shop.png'); }\n",
      ),
      writeSource(
        root,
        "src/styles/_base.scss",
        ".global-shell { color: red; background: url('./shared.png'); }\n",
      ),
      writeSource(
        root,
        "src/modules/shop/Page.vue",
        [
          '<a :href="banner.adImageUrl">Banner</a>',
          '<a href="tel:0212345678">Call</a>',
          '<a href="hybridfunction:openMap">Map</a>',
        ].join("\n"),
      ),
    ]);

    const inventory = await collectLegacySourceInventory({
      legacyProjectRoot: root,
      sourcePaths: ["src/modules/shop"],
    });

    expect(inventory.selectors.map((item) => item.selector)).toContain(".shop-page");
    expect(inventory.selectors.map((item) => item.selector)).not.toContain(".global-shell");
    expect(inventory.assets.map((item) => item.reference)).toEqual(
      expect.arrayContaining(["./shop.png", "./shared.png"]),
    );
    expect(inventory.assets.map((item) => item.reference)).not.toEqual(
      expect.arrayContaining(["banner.adImageUrl", "tel:0212345678", "hybridfunction:openMap"]),
    );
  });

  it("reports unresolved local and dynamic imports as warnings instead of throwing", async () => {
    const root = await createLegacyProject();
    await writeSource(
      root,
      "src/modules/mapfinder/lazy.ts",
      [
        "import Missing from './Missing.vue';",
        "export const load = (name) => import(`@/views/${name}.vue`);",
        "void Missing;",
      ].join("\n"),
    );

    const inventory = await collectLegacySourceInventory({
      legacyProjectRoot: root,
      sourcePaths: ["src/modules/mapfinder"],
    });

    expect(inventory.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "local-import-unresolved",
          specifier: "./Missing.vue",
        }),
        expect.objectContaining({
          code: "dynamic-import-unresolved",
          message: expect.stringContaining("@/views/${name}.vue"),
        }),
      ]),
    );
  });

  it("bounds supporting import traversal and reports the skipped dependency as a warning", async () => {
    const root = await createLegacyProject();
    await Promise.all([
      writeSource(
        root,
        "src/modules/mapfinder/Main.ts",
        "import '@/shared/one'; import '@/shared/two';\n",
      ),
      writeSource(root, "src/shared/one.ts", "export const one = 1;\n"),
      writeSource(root, "src/shared/two.ts", "export const two = 2;\n"),
    ]);

    const inventory = await collectLegacySourceInventory({
      legacyProjectRoot: root,
      sourcePaths: ["src/modules/mapfinder"],
      maxSupportingFiles: 1,
    });

    expect(inventory.supportingDependencies).toHaveLength(1);
    expect(inventory.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "dependency-limit" })]),
    );
  });
});

async function createLegacyProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-source-inventory-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeSource(root: string, relativePath: string, contents: string): Promise<void> {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, "utf8");
}
