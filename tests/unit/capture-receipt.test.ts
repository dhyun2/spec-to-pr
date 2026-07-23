import { describe, expect, it } from "vitest";

import { assertCaptureReceipt } from "../../src/visual/capture-receipt.js";

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
const target = {
  targetId: "shop-available",
  name: "Shop",
  state: "available",
  route: "/shop",
  baselineKind: "figma" as const,
  baselinePath: "visual/shop.png",
  viewport: { width: 360, height: 1824 },
  deviceScaleFactor: 1,
  fixture: "shop:available",
  figmaCapture: {
    nodeId: "2558:4382",
    captureKind: "full-frame" as const,
    logicalSize: { width: 360, height: 1824 },
    exportScale: 1,
    bitmapSize: { width: 360, height: 1824 },
    colorSpace: "srgb" as const,
  },
  masks: [],
  reviewThreshold: 0.98,
};
const validReceipt = {
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
  fonts: [{ family: "Pretendard", digest: `sha256:${"7".repeat(64)}` }],
  fixture: { id: target.fixture, digest: fixtureDigest },
  assets: [{ path: "assets/nxplus_park.webp", digest: `sha256:${"8".repeat(64)}` }],
  assetsComplete: true as const,
  actual: {
    path: `visual/actual/${packet.id}/shop-available.png`,
    digest: actualDigest,
    bitmapSize: { width: 360, height: 1824 },
  },
  runnerVersion: "capture-runner-v1" as const,
  normalizerVersion: "visual-normalizer-v1" as const,
  capturedAt: "2026-07-23T00:00:00.000Z",
};

describe("visual capture receipts", () => {
  it("rejects a receipt from another packet or source head", () => {
    for (const receipt of [
      { ...validReceipt, reviewPacketId: `packet_${"f".repeat(64)}` },
      { ...validReceipt, headSha: "f".repeat(40) },
    ]) {
      expect(() =>
        assertCaptureReceipt({ receipt, packet, target, actualDigest, fixtureDigest }),
      ).toThrow(/VISUAL_CAPTURE_PROVENANCE_INVALID/);
    }
  });

  it("rejects a declared fixture that was not consumed", () => {
    expect(() =>
      assertCaptureReceipt({
        receipt: {
          ...validReceipt,
          fixture: { id: target.fixture, digest: `sha256:${"9".repeat(64)}` },
        },
        packet,
        target,
        actualDigest,
        fixtureDigest,
      }),
    ).toThrow(/MOCK_FIXTURE_NOT_CONSUMED/);
  });

  it("accepts a complete packet-specific capture receipt", () => {
    expect(() =>
      assertCaptureReceipt({
        receipt: validReceipt,
        packet,
        target,
        actualDigest,
        fixtureDigest,
      }),
    ).not.toThrow();
  });
});
