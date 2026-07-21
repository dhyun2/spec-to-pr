import { describe, expect, it } from "vitest";

import { publicSourceRows } from "../../src/pr-report/public-provenance.js";
import { buildDeliveryProfile } from "../../src/workflow/delivery-policy.js";

describe("public report provenance", () => {
  it("removes home paths, URL query values, fragments, and credentials", () => {
    const profile = buildDeliveryProfile({
      mode: "legacy",
      changeKind: "migration",
      publication: "draft",
      scope: {
        code: true,
        ui: true,
        api: true,
        specification: false,
        hasVisualBaseline: true,
        securitySensitive: false,
        performanceSensitive: true,
        observabilityRequested: false,
      },
      legacyProjectRoot: "/Users/private/secret/legacy-app",
      sourceProvenance: [
        {
          kind: "openapi",
          locator: "https://user:pass@api.example.com/openapi.yaml?session=private#fragment",
          resolvedLocator: "https://api.example.com/openapi.yaml?resolved=secret#node",
          digest: `sha256:${"a".repeat(64)}`,
          capturedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    });

    const rows = publicSourceRows(profile, `sha256:${"b".repeat(64)}`);
    const serialized = JSON.stringify(rows);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "openapi",
          locator: "https://api.example.com/openapi.yaml",
          resolvedLocator: "https://api.example.com/openapi.yaml",
        }),
        expect.objectContaining({
          kind: "legacy",
          locator: "external-legacy-project",
          digest: `sha256:${"b".repeat(64)}`,
        }),
      ]),
    );
    expect(serialized).not.toMatch(/Users|private|secret|session|fragment|user:pass/);
  });
});
