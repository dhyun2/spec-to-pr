import { describe, expect, it } from "vitest";

import { buildDeliveryProfile } from "../../src/workflow/index.js";

const uiScope = {
  code: true,
  ui: true,
  api: false,
  specification: false,
  hasVisualBaseline: false,
  securitySensitive: false,
  performanceSensitive: false,
  observabilityRequested: false,
};

describe("delivery policy", () => {
  it("keeps auto mode lightweight for existing callers", () => {
    expect(
      buildDeliveryProfile({
        mode: "auto",
        changeKind: "auto",
        publication: "draft",
        scope: { ...uiScope, ui: false },
      }),
    ).toMatchObject({
      mode: "auto",
      requirements: {
        brief: false,
        legacyBaseline: false,
        targetedFeatureE2E: false,
        featureVideo: false,
        figmaBundle: false,
      },
    });
  });

  it("requires an explicit brief reference in brief mode", () => {
    expect(() =>
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
      }),
    ).toThrow(/briefPath/);

    expect(
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        briefPath: "docs/checkout-brief.md",
        scope: uiScope,
      }),
    ).toMatchObject({ mode: "brief", briefPath: "docs/checkout-brief.md" });
  });

  it("requires only a focused baseline for an explicit legacy change", () => {
    expect(
      buildDeliveryProfile({
        mode: "legacy",
        changeKind: "fix",
        publication: "draft",
        scope: { ...uiScope, ui: false },
      }).requirements,
    ).toEqual({
      brief: false,
      legacyBaseline: true,
      targetedFeatureE2E: false,
      featureVideo: false,
      figmaBundle: false,
    });
  });

  it("requires targeted E2E and one video only for user-facing feature mode", () => {
    expect(
      buildDeliveryProfile({
        mode: "feature",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
      }).requirements,
    ).toMatchObject({ targetedFeatureE2E: true, featureVideo: true });

    expect(
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        briefPath: "brief.md",
        scope: uiScope,
      }).requirements,
    ).toMatchObject({ targetedFeatureE2E: false, featureVideo: false });

    expect(() =>
      buildDeliveryProfile({
        mode: "feature",
        changeKind: "feature",
        publication: "draft",
        scope: { ...uiScope, ui: false },
      }),
    ).toThrow(/UI scope/);
  });

  it("requires a Figma URL and bundle without adding a new pipeline", () => {
    expect(() =>
      buildDeliveryProfile({
        mode: "figma",
        changeKind: "design",
        publication: "none",
        scope: uiScope,
      }),
    ).toThrow(/figmaUrl/);

    expect(
      buildDeliveryProfile({
        mode: "figma",
        changeKind: "design",
        publication: "none",
        figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
        scope: uiScope,
      }),
    ).toMatchObject({
      mode: "figma",
      publication: "none",
      requirements: { figmaBundle: true },
    });

    expect(() =>
      buildDeliveryProfile({
        mode: "figma",
        changeKind: "design",
        publication: "none",
        figmaUrl: "https://www.figma.com/design/abc/file",
        scope: { ...uiScope, ui: false },
      }),
    ).toThrow(/UI scope/);
  });
});
