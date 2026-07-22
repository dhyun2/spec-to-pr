import { describe, expect, it } from "vitest";

import type { LegacyApiCandidate } from "../../src/legacy/legacy-api-contracts.js";
import { resolveLegacyApiCandidates } from "../../src/legacy/legacy-api-resolver.js";

describe("legacy API evidence resolver", () => {
  it("treats a concrete terminal source call as authoritative when OpenAPI is absent or partial", () => {
    const result = resolveLegacyApiCandidates({
      candidates: [candidate({ method: "GET", pathTemplate: "/shop/ranking" })],
      openApiOperations: [{ method: "GET", path: "/shop/{rgnNo}", sourceLocator: "shop.yaml" }],
      runtimeRequests: [],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.operations).toEqual([
      expect.objectContaining({
        operationKey: "GET /shop/ranking",
        resolution: "source",
        sourceLocator: "external-legacy-project/api/shop.ts",
      }),
    ]);
  });

  it("resolves an unknown method only from one scoped OpenAPI or runtime match", () => {
    const fromOpenApi = resolveLegacyApiCandidates({
      candidates: [candidate({ method: "UNKNOWN", pathTemplate: "/checkout" })],
      openApiOperations: [
        {
          method: "POST",
          path: "/checkout",
          sourceLocator: "checkout.yaml",
          serverOrigins: ["https://api.example/v2/"],
        },
      ],
      runtimeRequests: [],
    });
    expect(fromOpenApi.operations[0]).toMatchObject({ method: "POST", resolution: "openapi" });

    const fromRuntime = resolveLegacyApiCandidates({
      candidates: [candidate({ method: "UNKNOWN", pathTemplate: "/checkout" })],
      openApiOperations: [],
      runtimeRequests: [{ method: "PATCH", path: "/checkout", origin: "https://api.example/v2/" }],
    });
    expect(fromRuntime.operations[0]).toMatchObject({ method: "PATCH", resolution: "runtime" });
  });

  it("does not use an operation from a conflicting origin or choose between ambiguous methods", () => {
    const scoped = candidate({ method: "UNKNOWN", pathTemplate: "/checkout" });
    const wrongOrigin = resolveLegacyApiCandidates({
      candidates: [scoped],
      openApiOperations: [
        {
          method: "POST",
          path: "/checkout",
          sourceLocator: "other.yaml",
          serverOrigins: ["https://other.example/"],
        },
      ],
      runtimeRequests: [],
    });
    expect(wrongOrigin.operations).toEqual([]);
    expect(wrongOrigin.unresolved).toEqual([scoped]);

    const ambiguous = resolveLegacyApiCandidates({
      candidates: [
        candidate({ method: "UNKNOWN", pathTemplate: "/checkout", originRef: undefined }),
      ],
      openApiOperations: [
        { method: "GET", path: "/checkout", sourceLocator: "api.yaml" },
        { method: "POST", path: "/checkout", sourceLocator: "api.yaml" },
      ],
      runtimeRequests: [],
    });
    expect(ambiguous.operations).toEqual([]);
    expect(ambiguous.unresolved).toHaveLength(1);
  });

  it("matches explicit generated operation identifiers without treating local facades as evidence", () => {
    const result = resolveLegacyApiCandidates({
      candidates: [
        candidate({
          method: "UNKNOWN",
          pathTemplate: undefined,
          operationKey: "UNKNOWN operation:createOrder",
          originRef: undefined,
        }),
      ],
      openApiOperations: [
        {
          method: "POST",
          path: "/orders",
          operationId: "createOrder",
          sourceLocator: "orders.yaml",
        },
      ],
      runtimeRequests: [],
    });

    expect(result.operations[0]).toMatchObject({
      operationKey: "POST /orders",
      resolution: "openapi",
    });
  });
});

function candidate(
  overrides: Partial<LegacyApiCandidate> & {
    method: LegacyApiCandidate["method"];
    pathTemplate: string | undefined;
  },
): LegacyApiCandidate {
  const pathTemplate = overrides.pathTemplate;
  return {
    candidateKey: "candidate_test",
    endpointKey: "endpoint_test",
    operationKey: overrides.operationKey ?? `${overrides.method} ${pathTemplate ?? "path:unknown"}`,
    method: overrides.method,
    ...(pathTemplate === undefined ? {} : { pathTemplate }),
    ...(overrides.originRef === undefined && "originRef" in overrides
      ? {}
      : {
          originRef: overrides.originRef ?? {
            kind: "environment",
            runtime: "process.env",
            name: "API_BASE_URL",
            sanitizedOrigin: "https://api.example/v2/",
          },
        }),
    confidence: "high",
    terminalKind: "http-client",
    callSites: [
      {
        callSiteKey: "call_test",
        ownerSourcePath: "api/shop.ts",
        terminalSourcePath: "api/shop.ts",
        line: 1,
        column: 1,
        receiver: "apiClient",
        transportRef: "ApiClient",
        wrapperChain: [],
      },
    ],
    requestEvidence: { queryKeys: [], bodySymbols: [], headerKeys: [] },
    responseEvidence: { selectors: [] },
    witnesses: [{ kind: "source", locator: "api/shop.ts:1:1" }],
  };
}
