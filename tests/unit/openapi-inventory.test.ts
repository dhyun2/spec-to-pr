import { describe, expect, it } from "vitest";

import {
  inventoryOpenApiOperations,
  openApiClassificationSummary,
} from "../../src/source-ingestion/openapi-inventory.js";

describe("OpenAPI operation inventory", () => {
  it("renders compact canonical operation summaries without full OpenAPI bodies", () => {
    const largeDescription = "internal implementation details ".repeat(500);
    const operations = inventoryOpenApiOperations([
      {
        path: "openapi.yaml",
        text: `openapi: 3.1.0
paths:
  /shops/{shopId}:
    get:
      operationId: getShop
      description: ${largeDescription}
`,
      },
    ]);

    const summary = openApiClassificationSummary(operations);

    expect(summary).toBe(
      '{"method":"GET","path":"/shops/{shopId}","operationId":"getShop","sourceLocator":"openapi.yaml"}',
    );
    expect(summary).not.toContain(largeDescription);
  });

  it("resolves local Path Item refs and keeps the referring path", () => {
    const operations = inventoryOpenApiOperations([
      {
        path: "openapi.yaml",
        text: `
openapi: 3.1.0
paths:
  /pets:
    $ref: '#/components/pathItems/Pets'
components:
  pathItems:
    Pets:
      get:
        operationId: listPets
`,
      },
    ]);

    expect(operations).toEqual([
      {
        operationKey: "GET /pets",
        method: "GET",
        path: "/pets",
        operationId: "listPets",
        sourceLocator: "openapi.yaml",
      },
    ]);
  });

  it("decodes escaped JSON pointers and lets explicit sibling methods override refs", () => {
    const operations = inventoryOpenApiOperations([
      {
        path: "openapi.json",
        text: JSON.stringify({
          openapi: "3.1.0",
          paths: {
            "/pets": {
              $ref: "#/components/pathItems/~1pets~0base",
              get: { operationId: "overridePets" },
            },
          },
          components: {
            pathItems: {
              "/pets~base": {
                get: { operationId: "basePets" },
                post: { operationId: "createPet" },
              },
            },
          },
        }),
      },
    ]);

    expect(
      operations.map(({ operationKey, operationId }) => ({ operationKey, operationId })),
    ).toEqual([
      { operationKey: "GET /pets", operationId: "overridePets" },
      { operationKey: "POST /pets", operationId: "createPet" },
    ]);
  });

  it("retains safe operation, path, or document server origins for scoped legacy matching", () => {
    const operations = inventoryOpenApiOperations([
      {
        path: "openapi.yaml",
        text: `
openapi: 3.1.0
servers:
  - url: https://api.example/v1/
paths:
  /pets:
    get: {}
  /orders:
    servers:
      - url: https://api.example/v2/
    post: {}
  /private:
    get:
      servers:
        - url: https://private.example/api/
`,
      },
    ]);

    expect(operations).toEqual([
      expect.objectContaining({
        operationKey: "GET /pets",
        serverOrigins: ["https://api.example/v1/"],
      }),
      expect.objectContaining({
        operationKey: "POST /orders",
        serverOrigins: ["https://api.example/v2/"],
      }),
      expect.objectContaining({
        operationKey: "GET /private",
        serverOrigins: ["https://private.example/api/"],
      }),
    ]);
  });

  it.each([
    ["external", "https://api.example.com/path-item.yaml"],
    ["broken", "#/components/pathItems/Missing"],
  ])("rejects %s Path Item refs", (_name, ref) => {
    expect(() =>
      inventoryOpenApiOperations([
        {
          path: "openapi.yaml",
          text: `openapi: 3.1.0\npaths:\n  /pets:\n    $ref: '${ref}'\ncomponents:\n  pathItems: {}\n`,
        },
      ]),
    ).toThrow(/OpenAPI.*ref/i);
  });

  it("rejects cyclic local Path Item refs", () => {
    expect(() =>
      inventoryOpenApiOperations([
        {
          path: "openapi.yaml",
          text: `
openapi: 3.1.0
paths:
  /pets:
    $ref: '#/components/pathItems/A'
components:
  pathItems:
    A:
      $ref: '#/components/pathItems/B'
    B:
      $ref: '#/components/pathItems/A'
`,
        },
      ]),
    ).toThrow(/cycle/i);
  });

  it("rejects duplicate operations across source documents", () => {
    const source = (path: string) => ({
      path,
      text: "openapi: 3.1.0\npaths:\n  /pets:\n    get: {}\n",
    });

    expect(() => inventoryOpenApiOperations([source("one.yaml"), source("two.yaml")])).toThrow(
      /Duplicate OpenAPI operation GET \/pets/,
    );
  });

  it("rejects inventories above the 1,000-operation ceiling", () => {
    const paths = Object.fromEntries(
      Array.from({ length: 1_001 }, (_unused, index) => [
        "/resource-" + String(index),
        { get: {} },
      ]),
    );

    expect(() =>
      inventoryOpenApiOperations([
        { path: "large.json", text: JSON.stringify({ openapi: "3.1.0", paths }) },
      ]),
    ).toThrow(/exceeds 1000/);
  });
});
