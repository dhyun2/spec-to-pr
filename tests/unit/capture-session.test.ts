import { describe, expect, it } from "vitest";

import {
  CaptureSessionReceiptV1Schema,
  captureSessionIdentity,
} from "../../src/workflow/capture-session.js";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

const session = {
  schemaVersion: "capture-session-v1",
  runId: `run_${"a".repeat(32)}`,
  implementationContextId: "implementation_capture_session",
  candidate: {
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    diffDigest: digest("c"),
  },
  invocation: {
    runner: "playwright-test-cli",
    command: "pnpm exec playwright test e2e/profile.spec.ts",
    selector: "e2e/profile.spec.ts",
    invocationCount: 1,
    reporterResultPath: "artifacts/e2e/capture.playwright.json",
    reporterResultDigest: digest("d"),
  },
  environment: {
    browser: {
      family: "chromium",
      channel: "chromium",
      version: "123.0.0",
      userAgent: "Mozilla/5.0",
    },
    renderer: {
      adapter: "spec-to-pr-playwright",
      adapterVersion: "capture-runner-v2",
      playwrightVersion: "1.61.1",
    },
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    colorScheme: "light",
    reducedMotion: "no-preference",
    serverOrigin: "http://127.0.0.1:3000",
    readiness: {
      documentReadyState: "complete",
      fontsReady: true,
      imagesReady: true,
      assetsReady: true,
    },
  },
  inputs: {
    capturePlanDigest: digest("e"),
    scenarioDigest: digest("f"),
    fixtureDigest: digest("1"),
    uiBundleDigest: digest("2"),
    rendererLineageId: digest("3"),
  },
  outputs: {
    featureResult: {
      path: "artifacts/e2e/result.json",
      digest: digest("4"),
      testId: "profile e2e",
    },
    video: {
      path: "artifacts/e2e/profile.webm",
      digest: digest("5"),
      durationMs: 1_500,
    },
    performance: {
      path: "artifacts/e2e/performance.json",
      digest: digest("6"),
    },
    targets: [
      {
        targetId: "profile-selected",
        testId: "profile selected visual",
        actualPath: "artifacts/visual/profile-selected.png",
        actualDigest: digest("7"),
        observationPath: "artifacts/visual/profile-selected.observation.json",
        observationDigest: digest("8"),
      },
      {
        targetId: "profile-unselected",
        testId: "profile unselected visual",
        actualPath: "artifacts/visual/profile-unselected.png",
        actualDigest: digest("9"),
        observationPath: "artifacts/visual/profile-unselected.observation.json",
        observationDigest: digest("a"),
      },
    ],
  },
};

describe("capture session", () => {
  it("creates one stable candidate-bound identity regardless of target order", () => {
    const parsed = CaptureSessionReceiptV1Schema.parse({
      ...session,
      captureSessionId: captureSessionIdentity(session),
    });
    const reorderedDraft = {
      ...session,
      outputs: { ...session.outputs, targets: [...session.outputs.targets].reverse() },
    };
    const reordered = CaptureSessionReceiptV1Schema.parse({
      ...reorderedDraft,
      captureSessionId: captureSessionIdentity(reorderedDraft),
    });

    expect(captureSessionIdentity(parsed)).toMatch(/^capture_[a-f0-9]{64}$/);
    expect(captureSessionIdentity(reordered)).toBe(captureSessionIdentity(parsed));
  });

  it("rejects a capture plan with more than one Playwright invocation", () => {
    expect(() =>
      CaptureSessionReceiptV1Schema.parse({
        ...session,
        captureSessionId: captureSessionIdentity(session),
        invocation: { ...session.invocation, invocationCount: 2 },
      }),
    ).toThrow(/invocationCount/i);
  });
});
