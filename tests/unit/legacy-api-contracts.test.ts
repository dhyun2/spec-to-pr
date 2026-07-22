import { describe, expect, it } from "vitest";

import {
  LegacyApiCandidateSchema,
  endpointIdentity,
  upgradeLegacyInventoryV2,
} from "../../src/legacy/legacy-api-contracts.js";

describe("legacy API contracts v3", () => {
  it("keeps identical method paths distinct across environment origins", () => {
    const first = LegacyApiCandidateSchema.parse(candidate("V1_API_URL"));
    const second = LegacyApiCandidateSchema.parse(candidate("V2_API_URL"));

    expect(first.operationKey).toBe("GET /health");
    expect(second.operationKey).toBe("GET /health");
    expect(endpointIdentity(first)).not.toBe(endpointIdentity(second));
  });

  it("upgrades a v2 inventory without inventing origin or transport evidence", () => {
    const upgraded = upgradeLegacyInventoryV2({
      version: 2,
      rootDigest: `sha256:${"a".repeat(64)}`,
      sourceDigest: `sha256:${"a".repeat(64)}`,
      visitedDirectories: 1,
      visitedEntries: 1,
      scannedFiles: 1,
      scannedBytes: 10,
      truncated: false,
      apiDiscoveryAdapters: ["source-http-client"],
      entries: [],
    });

    expect(upgraded).toMatchObject({ version: 3, apiState: "not-detected", apiCandidates: [] });
  });
});

function candidate(environmentName: string) {
  return {
    candidateKey: `candidate:${environmentName}`,
    endpointKey: `env:${environmentName}|GET /health`,
    operationKey: "GET /health",
    method: "GET",
    pathTemplate: "/health",
    originRef: { kind: "environment", runtime: "process.env", name: environmentName },
    confidence: "high",
    terminalKind: "http-client",
    callSites: [
      {
        callSiteKey: `call:${environmentName}`,
        ownerSourcePath: "api/health.ts",
        terminalSourcePath: "api/health.ts",
        line: 1,
        column: 1,
        receiver: "apiClient",
        transportRef: "ApiClient",
        wrapperChain: [],
      },
    ],
    requestEvidence: { queryKeys: [], bodySymbols: [], headerKeys: [] },
    responseEvidence: { selectors: [] },
    witnesses: [{ kind: "source", locator: "api/health.ts:1:1" }],
  };
}
