import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanLegacyFeatureInventory } from "../../src/legacy/legacy-feature-inventory.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-inventory-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("legacy feature inventory", () => {
  it("extracts branch behavior signals from legacy Vue source", async () => {
    await mkdir(path.join(directory, "src", "pages", "mapfinder"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "pages", "mapfinder", "Map.vue"),
      `
export default {
  mounted() {
    NetFunnel_Action({ service_id: 'mapfinder' });
    window.nativeBackPressed = () => this.$router.back();
    window.GolfzonApp.hideWebNavBar();
    const { rgnNo, lat, lng, optFilter } = this.$route.query;
    this.radius = [2.5, 3, 5][0];
    this.$toast('좀 더 넓은 위치 탐색');
    trackPV('/mapfinder');
  },
  methods: {
    reserve(store) {
      if (store.isGrx) location.href = '/academy/#/grx/stores/' + store.rgnNo;
      else location.href = '/booking/#/stores/' + store.rgnNo;
    },
    findPath(store) {
      window.open('kakaomap://route?ep=' + store.lat + ',' + store.lng);
    },
    onImageError(event) {
      event.target.src = resizeImage('/fallback.png');
    },
  },
};
`,
    );

    const inventory = await scanLegacyFeatureInventory({
      legacyRoot: directory,
    });
    const categories = new Set(inventory.features.map((feature) => feature.category));

    expect(inventory.featureCount).toBeGreaterThanOrEqual(9);
    expect([...categories]).toEqual(
      expect.arrayContaining([
        "netfunnel",
        "native-bridge",
        "query-param",
        "radius-expansion",
        "dialog-toast",
        "analytics",
        "reservation-routing",
        "url-open",
        "image-fallback",
      ]),
    );
    expect(inventory.features.map((feature) => feature.label).join("\n")).toContain(
      "nativeBackPressed",
    );
  });

  it("extracts legacy resource binding signals used by visual parity", async () => {
    await mkdir(path.join(directory, "src", "pages", "mapfinder"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "pages", "mapfinder", "StoreCard.vue"),
      `
<template>
  <img :src="getResizeImgUrl(store.logoImgUrl)" @error="onImageError" />
  <img :src="store.imgUrl || defaultStoreImage" />
  <span v-if="store.gpassYn === 'Y'">G PASS</span>
</template>
<script>
export default {
  data() {
    return {
      markerOptions: { image: markerSpriteUrl, level: this.mapLevel },
      defaultStoreImage: 'https://cdn.example/default-store.png',
    };
  },
};
</script>
`,
    );

    const inventory = await scanLegacyFeatureInventory({
      legacyRoot: directory,
    });
    const resourceFeatures = inventory.features.filter(
      (feature) => feature.category === "resource-binding",
    );

    expect(resourceFeatures.map((feature) => feature.snippet).join("\n")).toContain("logoImgUrl");
    expect(resourceFeatures.map((feature) => feature.snippet).join("\n")).toContain("imgUrl");
    expect(resourceFeatures.map((feature) => feature.snippet).join("\n")).toContain(
      "markerOptions",
    );
    expect(resourceFeatures.map((feature) => feature.snippet).join("\n")).toContain("G PASS");
  });

  it("extracts root global CSS selectors that affect legacy screens", async () => {
    await mkdir(path.join(directory, "src", "pages", "mapfinder"), {
      recursive: true,
    });
    await mkdir(path.join(directory, "src", "styles"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "pages", "mapfinder", "Map.vue"),
      `
<template>
  <section class="mapfinder-root">
    <button class="btn-reserve">Reserve</button>
  </section>
</template>
`,
    );
    await writeFile(
      path.join(directory, "src", "styles", "global.css"),
      `
.mapfinder-root .btn-reserve {
  position: fixed;
  bottom: env(safe-area-inset-bottom);
  z-index: 2000;
}
#app .map-marker.active {
  background-image: url('/legacy-marker-active.png');
}
`,
    );

    const inventory = await scanLegacyFeatureInventory({
      legacyRoot: directory,
    });
    const globalStyleFeatures = inventory.features.filter(
      (feature) => feature.category === "global-style",
    );

    expect(globalStyleFeatures.map((feature) => feature.file)).toContain("src/styles/global.css");
    expect(globalStyleFeatures.map((feature) => feature.snippet).join("\n")).toContain(
      ".mapfinder-root .btn-reserve",
    );
    expect(globalStyleFeatures.map((feature) => feature.snippet).join("\n")).toContain(
      "#app .map-marker.active",
    );
  });

  it("includes root global CSS even when includeGlobs target a legacy screen path", async () => {
    await mkdir(path.join(directory, "src", "pages", "mapfinder"), {
      recursive: true,
    });
    await mkdir(path.join(directory, "src", "styles"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "pages", "mapfinder", "Map.vue"),
      `
<template>
  <section class="mapfinder-root">Map</section>
</template>
`,
    );
    await writeFile(
      path.join(directory, "src", "styles", "global.scss"),
      `
.mapfinder-root {
  min-height: 100vh;
}
`,
    );

    const inventory = await scanLegacyFeatureInventory({
      legacyRoot: directory,
      includeGlobs: ["src/pages/mapfinder/**"],
    });

    expect(
      inventory.features.some(
        (feature) =>
          feature.category === "global-style" && feature.file === "src/styles/global.scss",
      ),
    ).toBe(true);
  });

  it("extracts swiper interaction features from legacy modules", async () => {
    await mkdir(path.join(directory, "src", "pages", "mapfinder"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "src", "pages", "mapfinder", "ShopList.vue"),
      `
<template>
  <Swiper @slideChange="moveMarkerBySlide">
    <SwiperSlide v-for="shop in shops" :key="shop.rgnNo">{{ shop.name }}</SwiperSlide>
  </Swiper>
</template>
<script>
import Swiper from 'swiper';
export default {
  methods: {
    moveMarkerBySlide(swiper) {
      this.kakaoMap.moveMarker(this.mapId, this.shops[swiper.activeIndex].rgnNo);
    },
  },
};
</script>
`,
    );

    const inventory = await scanLegacyFeatureInventory({
      legacyRoot: directory,
      includeGlobs: ["src/pages/mapfinder/**"],
    });
    const swiperFeatures = inventory.features.filter(
      (feature) => feature.category === "carousel-swipe",
    );

    expect(swiperFeatures.map((feature) => feature.snippet).join("\n")).toContain("slideChange");
    expect(swiperFeatures.map((feature) => feature.keywords).flat()).toContain("swiper");
  });
});
