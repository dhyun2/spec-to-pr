import { describe, expect, it } from "vitest";

import { generateFeatureWrappers } from "../../src/api-pipeline/wrapper-generator.js";

describe("generateFeatureWrappers", () => {
  it("generates wrappers for operations with operationId", () => {
    const wrappers = generateFeatureWrappers({
      sourceKey: "staff",
      wrapperRoot: "src/features",
      operations: [
        {
          method: "get",
          path: "/reservations",
          pointer: "/paths/~1reservations/get",
          operationId: "fetchReservations",
          tags: [],
          requestContentTypes: [],
          responseStatuses: ["200", "400"],
          responseContentTypes: ["application/json"],
          securitySchemeNames: [],
        },
      ],
    });

    expect(wrappers).toHaveLength(1);
    expect(wrappers[0]!.path).toContain("reservations/api/fetch-reservations.ts");
    expect(wrappers[0]!.content).toContain("export async function fetchReservations");
  });
});
