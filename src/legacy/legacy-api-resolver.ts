import type { LegacyApiCandidate } from "./legacy-api-contracts.js";

export type LegacyOpenApiOperationEvidence = {
  method: Exclude<LegacyApiCandidate["method"], "UNKNOWN">;
  path: string;
  operationId?: string;
  sourceLocator: string;
  serverOrigins?: string[];
};

export type LegacyRuntimeRequestEvidence = {
  method: Exclude<LegacyApiCandidate["method"], "UNKNOWN">;
  path: string;
  origin?: string;
};

export type ResolvedLegacyApiOperation = {
  operationKey: string;
  method: Exclude<LegacyApiCandidate["method"], "UNKNOWN">;
  path: string;
  sourceLocator: string;
  resolution: "source" | "openapi" | "runtime";
  candidateKeys: string[];
};

export function resolveLegacyApiCandidates(input: {
  candidates: LegacyApiCandidate[];
  openApiOperations: LegacyOpenApiOperationEvidence[];
  runtimeRequests: LegacyRuntimeRequestEvidence[];
}): { operations: ResolvedLegacyApiOperation[]; unresolved: LegacyApiCandidate[] } {
  const operations = new Map<string, ResolvedLegacyApiOperation>();
  const unresolved: LegacyApiCandidate[] = [];
  for (const candidate of input.candidates) {
    const resolution = resolveCandidate(candidate, input.openApiOperations, input.runtimeRequests);
    if (resolution === undefined) {
      unresolved.push(candidate);
      continue;
    }
    const operationKey = `${resolution.method} ${resolution.path}`;
    const existing = operations.get(operationKey);
    if (existing === undefined) {
      operations.set(operationKey, {
        operationKey,
        ...resolution,
        candidateKeys: [candidate.candidateKey],
      });
    } else if (!existing.candidateKeys.includes(candidate.candidateKey)) {
      existing.candidateKeys.push(candidate.candidateKey);
      existing.candidateKeys.sort();
    }
  }
  return {
    operations: [...operations.values()].sort((left, right) =>
      left.operationKey.localeCompare(right.operationKey),
    ),
    unresolved,
  };
}

function resolveCandidate(
  candidate: LegacyApiCandidate,
  openApi: LegacyOpenApiOperationEvidence[],
  runtime: LegacyRuntimeRequestEvidence[],
): Omit<ResolvedLegacyApiOperation, "operationKey" | "candidateKeys"> | undefined {
  if (candidate.method !== "UNKNOWN" && candidate.pathTemplate !== undefined) {
    return {
      method: candidate.method,
      path: candidate.pathTemplate,
      sourceLocator: `external-legacy-project/${candidate.callSites[0]!.terminalSourcePath}`,
      resolution: "source",
    };
  }

  const operationId = /^UNKNOWN operation:(.+)$/u.exec(candidate.operationKey)?.[1];
  const openApiMatches = uniqueMatches(
    openApi
      .filter((operation) => {
        const identityMatches =
          operationId === undefined
            ? candidate.pathTemplate !== undefined &&
              samePathTemplate(candidate.pathTemplate, operation.path)
            : operation.operationId === operationId;
        return (
          identityMatches &&
          (candidate.method === "UNKNOWN" || candidate.method === operation.method) &&
          originMatches(candidate, operation.serverOrigins)
        );
      })
      .map((operation) => ({
        method: operation.method,
        path: operation.path,
        sourceLocator: operation.sourceLocator,
        resolution: "openapi" as const,
      })),
  );
  if (openApiMatches.length === 1) return openApiMatches[0];

  if (candidate.pathTemplate === undefined) return undefined;
  const runtimeMatches = uniqueMatches(
    runtime
      .filter(
        (request) =>
          samePathTemplate(candidate.pathTemplate!, request.path) &&
          (candidate.method === "UNKNOWN" || candidate.method === request.method) &&
          runtimeOriginMatches(candidate, request.origin),
      )
      .map((request) => ({
        method: request.method,
        path: candidate.pathTemplate!,
        sourceLocator: "legacy-runtime-network",
        resolution: "runtime" as const,
      })),
  );
  return runtimeMatches.length === 1 ? runtimeMatches[0] : undefined;
}

function uniqueMatches<T extends { method: string; path: string }>(matches: T[]): T[] {
  return [
    ...new Map(matches.map((match) => [`${match.method} ${match.path}`, match] as const)).values(),
  ];
}

function samePathTemplate(left: string, right: string): boolean {
  return pathShape(left) === pathShape(right);
}

function pathShape(value: string): string {
  return value
    .split(/[?#]/u, 1)[0]!
    .replace(/\{[^/{}]+\}/gu, "{}")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

function originMatches(
  candidate: LegacyApiCandidate,
  serverOrigins: string[] | undefined,
): boolean {
  if (serverOrigins === undefined || serverOrigins.length === 0) return true;
  const candidateOrigin = sanitizedCandidateOrigin(candidate);
  if (candidateOrigin === undefined) return true;
  return serverOrigins.some(
    (origin) => normalizedOrigin(origin) === normalizedOrigin(candidateOrigin),
  );
}

function runtimeOriginMatches(
  candidate: LegacyApiCandidate,
  runtimeOrigin: string | undefined,
): boolean {
  const candidateOrigin = sanitizedCandidateOrigin(candidate);
  return (
    candidateOrigin === undefined ||
    runtimeOrigin === undefined ||
    normalizedOrigin(candidateOrigin) === normalizedOrigin(runtimeOrigin)
  );
}

function sanitizedCandidateOrigin(candidate: LegacyApiCandidate): string | undefined {
  const origin = candidate.originRef;
  if (origin === undefined || origin.kind === "openapi-server") return undefined;
  return origin.sanitizedOrigin;
}

function normalizedOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/u, "");
  } catch {
    return value.replace(/\/+$/u, "");
  }
}
