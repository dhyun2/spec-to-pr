import { describe, expect, it } from "vitest";

import { generateZodSchemas } from "../../src/api-pipeline/openapi-schema-to-zod.js";

describe("generateZodSchemas", () => {
  it("generates object schemas", () => {
    const result = generateZodSchemas({
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

    expect(result.content).toContain("export const ReservationSchema");
    expect(result.content).toContain('"reserveNo": z.string()');
    expect(result.content).toContain('z.enum(["WAITING", "CONFIRMED"])');
  });

  it("warns for oneOf", () => {
    const result = generateZodSchemas({
      schemas: {
        Mixed: {
          oneOf: [{ type: "string" }, { type: "number" }],
        },
      },
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.content).toContain("z.unknown()");
  });
});
