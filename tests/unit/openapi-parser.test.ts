import { describe, expect, it } from "vitest";

import { detectOpenApiGapCandidates } from "../../src/openapi/openapi-gaps.js";
import { buildOpenApiInventory } from "../../src/openapi/openapi-inventory.js";
import { parseOpenApiDocument } from "../../src/openapi/openapi-parser.js";

const yaml = `
openapi: 3.1.0
info:
  title: Reservation API
  version: 1.0.0
paths:
  /reservations:
    get:
      operationId: getReservations
      tags:
        - Reservation
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ReservationList'
        '400':
          description: Bad Request
components:
  schemas:
    ReservationList:
      type: object
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
`;

describe("OpenAPI parser and inventory", () => {
  it("parses YAML OpenAPI documents", () => {
    const parsed = parseOpenApiDocument({
      content: Buffer.from(yaml, "utf8"),
      path: "openapi.yaml",
      mediaType: "application/yaml",
    });

    expect(parsed.versionKind).toBe("openapi-3.1");
  });

  it("builds operation schema security and ref inventory", () => {
    const parsed = parseOpenApiDocument({
      content: Buffer.from(yaml, "utf8"),
      path: "openapi.yaml",
    });

    const inventory = buildOpenApiInventory(parsed);

    expect(inventory.operationCount).toBe(1);
    expect(inventory.schemaCount).toBe(1);
    expect(inventory.securitySchemeCount).toBe(1);
    expect(inventory.refCount).toBeGreaterThan(0);
    expect(inventory.operations[0]).toMatchObject({
      method: "get",
      path: "/reservations",
      operationId: "getReservations",
    });
  });

  it("detects missing operationId", () => {
    const parsed = parseOpenApiDocument({
      content: Buffer.from(
        `
openapi: 3.1.0
info:
  title: API
  version: 1.0.0
paths:
  /x:
    get:
      responses:
        '200':
          description: OK
`,
        "utf8",
      ),
      path: "openapi.yaml",
    });

    const inventory = buildOpenApiInventory(parsed);
    const gaps = detectOpenApiGapCandidates({ parsed, inventory });

    expect(gaps.some((gap) => gap.code === "missing-operation-id")).toBe(true);
  });
});
