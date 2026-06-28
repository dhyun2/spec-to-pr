import { describe, expect, it } from "vitest";

import { generateTypescriptTypes } from "../../src/api-pipeline/openapi-schema-to-typescript.js";

describe("generateTypescriptTypes", () => {
  it("generates object types", () => {
    const result = generateTypescriptTypes({
      schemas: {
        Reservation: {
          type: "object",
          required: ["reserveNo"],
          properties: {
            reserveNo: {
              type: "string",
            },
            status: {
              type: "string",
              enum: ["WAITING", "CONFIRMED"],
            },
          },
        },
      },
    });

    expect(result.content).toContain("export type Reservation");
    expect(result.content).toContain('"reserveNo": string');
    expect(result.content).toContain('"WAITING" | "CONFIRMED"');
  });
});
