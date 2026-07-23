import { describe, expect, it } from "vitest";

import { createDraftEvidenceBundle } from "../../src/workflow/draft-evidence-bundle.js";

describe("draft evidence bundle", () => {
  it("derives one stable Shop review bundle without exposing a run ID", () => {
    expect(
      createDraftEvidenceBundle({
        mode: "legacy",
        legacyProjectRoot: "/legacy/src/modules/shop",
      }),
    ).toEqual({
      featureSlug: "shop",
      rootPath: ".spec-to-pr/shop",
      manifestPath: ".spec-to-pr/shop/manifest.json",
      contractsRoot: ".spec-to-pr/shop/contracts",
      evidenceRoot: ".spec-to-pr/shop/evidence",
      visualRoot: ".spec-to-pr/shop/visual",
      reportRoot: ".spec-to-pr/shop/report",
    });
  });

  it("rejects an unsafe legacy feature directory", () => {
    expect(() =>
      createDraftEvidenceBundle({
        mode: "legacy",
        legacyProjectRoot: "/legacy/src/modules/..",
      }),
    ).toThrow(/feature slug/i);
  });
});
