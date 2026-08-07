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

  it("canonicalizes a concrete source template to one matching OpenAPI contract", () => {
    const result = resolveLegacyApiCandidates({
      candidates: [candidate({ method: "GET", pathTemplate: "/shop/{rgnNo}" })],
      openApiOperations: [
        {
          method: "GET",
          path: "/shop/{id}",
          operationId: "findShopInfo",
          sourceLocator: "shop.yaml",
          serverOrigins: ["https://api.example/v2/"],
        },
        {
          method: "GET",
          path: "/shop/ranking",
          operationId: "findShopRanking",
          sourceLocator: "shop.yaml",
          serverOrigins: ["https://api.example/v2/"],
        },
      ],
      runtimeRequests: [],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.operations).toEqual([
      expect.objectContaining({
        operationKey: "GET /shop/{id}",
        path: "/shop/{id}",
        operationId: "findShopInfo",
        resolution: "openapi",
        sourceLocator: "shop.yaml",
        serverOrigins: ["https://api.example/v2/"],
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

  it("matches a source path template to one concrete runtime request in the same origin", () => {
    const templated = candidate({ method: "UNKNOWN", pathTemplate: "/shop/{id}" });
    const result = resolveLegacyApiCandidates({
      candidates: [templated],
      openApiOperations: [],
      runtimeRequests: [{ method: "GET", path: "/shop/123", origin: "https://api.example/v2/" }],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.operations).toEqual([
      expect.objectContaining({
        operationKey: "GET /shop/{id}",
        path: "/shop/{id}",
        resolution: "runtime",
      }),
    ]);
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

  it("resolves a path-dynamic call only when scoped runtime evidence has one unique operation", () => {
    const dynamic = candidate({
      method: "GET",
      pathTemplate: undefined,
      operationKey: "GET path:unknown",
      originRef: undefined,
    });
    const result = resolveLegacyApiCandidates({
      candidates: [dynamic],
      openApiOperations: [],
      runtimeRequests: [{ method: "GET", path: "/resolved", origin: "https://api.example" }],
    });

    expect(result.operations).toEqual([
      expect.objectContaining({ operationKey: "GET /resolved", resolution: "runtime" }),
    ]);
    expect(
      resolveLegacyApiCandidates({
        candidates: [dynamic],
        openApiOperations: [],
        runtimeRequests: [
          { method: "GET", path: "/first" },
          { method: "GET", path: "/second" },
        ],
      }).unresolved,
    ).toEqual([dynamic]);
  });

  it("keeps competing path-dynamic calls unresolved without an explicit runtime link", () => {
    const first = {
      ...candidate({
        method: "GET",
        pathTemplate: undefined,
        operationKey: "GET path:unknown:first",
        originRef: undefined,
      }),
      candidateKey: "candidate_first",
      endpointKey: "endpoint_first",
    };
    const second = {
      ...candidate({
        method: "GET",
        pathTemplate: undefined,
        operationKey: "GET path:unknown:second",
        originRef: undefined,
      }),
      candidateKey: "candidate_second",
      endpointKey: "endpoint_second",
    };

    const result = resolveLegacyApiCandidates({
      candidates: [first, second],
      openApiOperations: [],
      runtimeRequests: [
        { method: "GET", path: "/resolved" },
        { method: "GET", path: "/resolved" },
      ],
    });

    expect(result.operations).toEqual([]);
    expect(result.unresolved).toEqual([first, second]);
  });

  it("uses an explicit runtime callSiteKey to resolve competing dynamic calls", () => {
    const first = {
      ...candidate({
        method: "UNKNOWN",
        pathTemplate: undefined,
        operationKey: "UNKNOWN path:unknown:first",
        originRef: undefined,
      }),
      candidateKey: "candidate_first",
      endpointKey: "endpoint_first",
      callSites: [
        {
          ...candidate({ method: "UNKNOWN", pathTemplate: undefined }).callSites[0]!,
          callSiteKey: "call_first",
        },
      ],
    };
    const second = {
      ...candidate({
        method: "UNKNOWN",
        pathTemplate: undefined,
        operationKey: "UNKNOWN path:unknown:second",
        originRef: undefined,
      }),
      candidateKey: "candidate_second",
      endpointKey: "endpoint_second",
      callSites: [
        {
          ...candidate({ method: "UNKNOWN", pathTemplate: undefined }).callSites[0]!,
          callSiteKey: "call_second",
        },
      ],
    };

    const result = resolveLegacyApiCandidates({
      candidates: [first, second],
      openApiOperations: [],
      runtimeRequests: [
        { method: "GET", path: "/voc/types", callSiteKeys: ["call_first"] },
        { method: "POST", path: "/voc", callSiteKeys: ["call_second"] },
      ],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateKeys: ["candidate_first"],
          operationKey: "GET /voc/types",
        }),
        expect.objectContaining({ candidateKeys: ["candidate_second"], operationKey: "POST /voc" }),
      ]),
    );
  });

  it("keeps equal method paths separate across gateways and preserves their endpoint identity", () => {
    const firstOrigin = {
      kind: "environment" as const,
      runtime: "process.env" as const,
      name: "API_GATEWAY_V1",
      sanitizedOrigin: "https://v1.example/api/",
    };
    const secondOrigin = {
      kind: "environment" as const,
      runtime: "process.env" as const,
      name: "API_GATEWAY_V2",
      sanitizedOrigin: "https://v2.example/api/",
    };
    const first = {
      ...candidate({ method: "GET", pathTemplate: "/shop/ranking", originRef: firstOrigin }),
      candidateKey: "candidate_gateway_v1",
      endpointKey: "endpoint_gateway_v1",
    };
    const second = {
      ...candidate({ method: "GET", pathTemplate: "/shop/ranking", originRef: secondOrigin }),
      candidateKey: "candidate_gateway_v2",
      endpointKey: "endpoint_gateway_v2",
    };

    const result = resolveLegacyApiCandidates({
      candidates: [first, second],
      openApiOperations: [],
      runtimeRequests: [],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.operations).toHaveLength(2);
    expect(result.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKey: "GET /shop/ranking",
          endpointKey: "endpoint_gateway_v1",
          originRef: firstOrigin,
          candidateKeys: ["candidate_gateway_v1"],
        }),
        expect.objectContaining({
          operationKey: "GET /shop/ranking",
          endpointKey: "endpoint_gateway_v2",
          originRef: secondOrigin,
          candidateKeys: ["candidate_gateway_v2"],
        }),
      ]),
    );
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
