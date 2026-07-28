import { describe, expect, it } from "vitest";

import {
  VisualCaptureReceiptSchema,
  assertCaptureReceipt,
  canonicalCaptureAssetDigests,
  canonicalCaptureFontDigests,
  captureRendererLineageId,
} from "../../src/visual/capture-receipt.js";

const packet = {
  id: `packet_${"a".repeat(64)}`,
  runId: `run_${"b".repeat(32)}`,
  revision: 1,
  baseSha: "1".repeat(40),
  headSha: "2".repeat(40),
  evidenceDigest: `sha256:${"3".repeat(64)}`,
  diffDigest: `sha256:${"4".repeat(64)}`,
  changedFiles: ["src/shop.tsx"],
};
const actualDigest = `sha256:${"5".repeat(64)}` as const;
const fixtureDigest = `sha256:${"6".repeat(64)}` as const;
const stateContractDigest = `sha256:${"a".repeat(64)}` as const;
const expectedFonts = [{ family: "Pretendard", digest: `sha256:${"7".repeat(64)}` as const }];
const expectedAssets = [
  { path: "assets/nxplus_park.webp", digest: `sha256:${"8".repeat(64)}` as const },
];
const target = {
  targetId: "shop-available",
  name: "Shop",
  state: "available",
  route: "/shop?state=available",
  baselineKind: "figma" as const,
  baselinePath: "visual/shop.png",
  viewport: { width: 360, height: 1824 },
  deviceScaleFactor: 1,
  fixture: "shop:available",
  figmaCapture: {
    schemaVersion: "figma-capture-geometry-v2" as const,
    provider: "host-connected-figma-native-export" as const,
    nodeId: "2558:4382",
    state: "available",
    captureKind: "full-frame" as const,
    logicalSize: { width: 360, height: 1824 },
    exportScale: 1,
    bitmapSize: { width: 360, height: 1824 },
    colorSpace: "srgb" as const,
  },
  masks: [],
  reviewThreshold: 0.92,
};
const environment = {
  browser: {
    family: "chromium",
    channel: "chromium",
    version: "138.0.7204.168",
    userAgent: "Mozilla/5.0 Chromium",
  },
  renderer: {
    adapter: "spec-to-pr-playwright" as const,
    adapterVersion: "capture-runner-v2",
    playwrightVersion: "1.61.1",
  },
  locale: "ko-KR",
  timezone: "Asia/Seoul",
  colorScheme: "light" as const,
  reducedMotion: "reduce" as const,
  serverOrigin: "http://127.0.0.1:4173",
  readiness: {
    documentReadyState: "complete" as const,
    fontsReady: true as const,
    imagesReady: true as const,
    assetsReady: true as const,
  },
};
const validReceipt = {
  schemaVersion: "visual-capture-receipt-v2" as const,
  reviewPacketId: packet.id,
  headSha: packet.headSha,
  stateContractDigest,
  targetId: target.targetId,
  route: "http://127.0.0.1:4173/shop?state=available",
  state: target.state,
  captureKind: target.figmaCapture.captureKind,
  logicalSize: target.figmaCapture.logicalSize,
  deviceScaleFactor: target.deviceScaleFactor,
  environment,
  fonts: expectedFonts,
  fixture: { id: target.fixture, digest: fixtureDigest },
  assets: expectedAssets,
  actual: {
    path: `visual/actual/${packet.id}/shop-available.png`,
    digest: actualDigest,
    bitmapSize: { width: 360, height: 1824 },
  },
  normalizerVersion: "visual-normalizer-v1" as const,
  capturedAt: "2026-07-23T00:00:00.000Z",
};
const legacyReceipt = {
  reviewPacketId: packet.id,
  headSha: packet.headSha,
  targetId: target.targetId,
  route: target.route,
  state: target.state,
  captureKind: target.figmaCapture.captureKind,
  logicalSize: target.figmaCapture.logicalSize,
  deviceScaleFactor: target.deviceScaleFactor,
  playwrightVersion: "1.54.1",
  browserName: "chromium",
  browserVersion: "138.0.7204.168",
  locale: "ko-KR",
  colorScheme: "light" as const,
  timezone: "Asia/Seoul",
  userAgent: "Mozilla/5.0 Chromium",
  fonts: expectedFonts,
  fixture: { id: target.fixture, digest: fixtureDigest },
  assets: expectedAssets,
  assetsComplete: true as const,
  actual: validReceipt.actual,
  runnerVersion: "capture-runner-v1" as const,
  normalizerVersion: "visual-normalizer-v1" as const,
  capturedAt: validReceipt.capturedAt,
};

function assertReceipt(receipt: unknown): void {
  assertCaptureReceipt({
    receipt,
    packet,
    target,
    actualDigest,
    fixtureDigest,
    actualPath: validReceipt.actual.path,
    expectedFonts,
    expectedAssets,
    stateContractDigest,
  });
}

describe("visual capture receipts", () => {
  it("keeps historical v1 receipts readable but requires v2 for a new strict capture", () => {
    expect(VisualCaptureReceiptSchema.safeParse(legacyReceipt).success).toBe(true);
    expect(() => assertReceipt(legacyReceipt)).toThrow(
      /VISUAL_CAPTURE_RECEIPT_REACQUISITION_REQUIRED/,
    );
  });

  it("rejects a receipt from another packet or source head", () => {
    for (const receipt of [
      { ...validReceipt, reviewPacketId: `packet_${"f".repeat(64)}` },
      { ...validReceipt, headSha: "f".repeat(40) },
    ]) {
      expect(() => assertReceipt(receipt)).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
    }
  });

  it("rejects a receipt bound to another immutable state contract", () => {
    expect(() =>
      assertReceipt({
        ...validReceipt,
        stateContractDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID.*state contract/i);
  });

  it("rejects a declared fixture that was not consumed", () => {
    expect(() =>
      assertReceipt({
        ...validReceipt,
        fixture: { id: target.fixture, digest: `sha256:${"9".repeat(64)}` },
      }),
    ).toThrow(/MOCK_FIXTURE_NOT_CONSUMED/);
  });

  it.each([
    ["browser channel", { ...environment.browser, channel: undefined }],
    ["browser family", { ...environment.browser, family: undefined }],
    ["browser version", { ...environment.browser, version: undefined }],
  ])("rejects a v2 receipt missing %s", (_label, browser) => {
    expect(() =>
      assertReceipt({ ...validReceipt, environment: { ...environment, browser } }),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
  });

  it("rejects missing reduced-motion mode", () => {
    const { reducedMotion: _reducedMotion, ...withoutReducedMotion } = environment;
    expect(() => assertReceipt({ ...validReceipt, environment: withoutReducedMotion })).toThrow(
      /VISUAL_CAPTURE_PROVENANCE_INVALID/,
    );
  });

  it.each([
    ["adapter", { ...environment.renderer, adapter: undefined }],
    ["adapter version", { ...environment.renderer, adapterVersion: undefined }],
    ["Playwright version", { ...environment.renderer, playwrightVersion: undefined }],
  ])("rejects a v2 receipt missing renderer %s", (_label, renderer) => {
    expect(() =>
      assertReceipt({ ...validReceipt, environment: { ...environment, renderer } }),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
  });

  it.each([
    ["document ready state", { ...environment.readiness, documentReadyState: "interactive" }],
    ["fonts readiness", { ...environment.readiness, fontsReady: false }],
    ["images readiness", { ...environment.readiness, imagesReady: false }],
    ["assets readiness", { ...environment.readiness, assetsReady: false }],
  ])("rejects incomplete %s", (_label, readiness) => {
    expect(() =>
      assertReceipt({ ...validReceipt, environment: { ...environment, readiness } }),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
  });

  it("binds the captured route to the declared route resolved against the server origin", () => {
    expect(() =>
      assertReceipt({ ...validReceipt, route: `${environment.serverOrigin}/wrong` }),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
    expect(() =>
      assertReceipt({
        ...validReceipt,
        environment: { ...environment, serverOrigin: "http://127.0.0.1:5173" },
      }),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
  });

  it.each([
    [
      "actual PNG",
      {
        ...validReceipt,
        actual: { ...validReceipt.actual, digest: `sha256:${"9".repeat(64)}` },
      },
    ],
    [
      "font",
      {
        ...validReceipt,
        fonts: [{ ...expectedFonts[0]!, digest: `sha256:${"9".repeat(64)}` }],
      },
    ],
    [
      "asset",
      {
        ...validReceipt,
        assets: [{ ...expectedAssets[0]!, digest: `sha256:${"9".repeat(64)}` }],
      },
    ],
  ])("rejects a drifted %s digest", (_label, receipt) => {
    expect(() => assertReceipt(receipt)).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
  });

  it("rejects mapped fonts without immutable digests", () => {
    expect(() =>
      canonicalCaptureFontDigests([
        {
          family: "Pretendard",
          source: "assets/fonts/pretendard.woff2",
        },
      ]),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID.*Pretendard.*digest/i);
  });

  it("canonicalizes shared assets by path and rejects conflicting digests", () => {
    const shared = {
      path: "assets/shared.svg",
      digest: `sha256:${"8".repeat(64)}` as const,
    };
    expect(
      canonicalCaptureAssetDigests([
        { path: "assets/z.svg", digest: `sha256:${"9".repeat(64)}` },
        shared,
        shared,
      ]),
    ).toEqual([shared, { path: "assets/z.svg", digest: `sha256:${"9".repeat(64)}` }]);
    expect(() =>
      canonicalCaptureAssetDigests([shared, { ...shared, digest: `sha256:${"7".repeat(64)}` }]),
    ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID.*assets\/shared\.svg.*conflicting/i);
  });

  it("computes a canonical renderer lineage over every renderer-defining field", () => {
    expect(captureRendererLineageId(environment)).toBe(
      "sha256:3de501cb60e615a78147253250de31183e73a921ed3c7f3b98e17499aabee404",
    );
    for (const changed of [
      { ...environment, browser: { ...environment.browser, family: "firefox" } },
      { ...environment, browser: { ...environment.browser, channel: "chrome" } },
      { ...environment, browser: { ...environment.browser, version: "139" } },
      {
        ...environment,
        renderer: { ...environment.renderer, adapterVersion: "capture-runner-v3" },
      },
      { ...environment, renderer: { ...environment.renderer, playwrightVersion: "1.62.0" } },
      { ...environment, locale: "en-US" },
      { ...environment, timezone: "UTC" },
      { ...environment, colorScheme: "dark" as const },
      { ...environment, reducedMotion: "no-preference" as const },
      { ...environment, serverOrigin: "http://127.0.0.1:5173" },
    ]) {
      expect(captureRendererLineageId(changed)).not.toBe(
        "sha256:3de501cb60e615a78147253250de31183e73a921ed3c7f3b98e17499aabee404",
      );
    }
  });

  it("accepts a complete packet-specific v2 capture receipt", () => {
    expect(() => assertReceipt(validReceipt)).not.toThrow();
  });
});
