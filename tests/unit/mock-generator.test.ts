import { describe, expect, it } from "vitest";

import { generateMswHandlers } from "../../src/api-pipeline/mock-generator.js";

describe("generateMswHandlers", () => {
  it("generates MSW handler skeletons", () => {
    const file = generateMswHandlers({
      sourceKey: "staff",
      outputPath: "src/shared/api/mocks/staff.handlers.ts",
      operations: [
        {
          method: "get",
          path: "/reservations/{reserveNo}",
          pointer: "/paths/~1reservations~1{reserveNo}/get",
          operationId: "fetchReservation",
          tags: [],
          requestContentTypes: [],
          responseStatuses: ["200"],
          responseContentTypes: ["application/json"],
          securitySchemeNames: [],
        },
      ],
    });

    expect(file.content).toContain('http.get("/reservations/:reserveNo"');
    expect(file.content).toContain("HttpResponse.json");
  });
});
