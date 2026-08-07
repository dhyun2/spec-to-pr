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
  /** Optional explicit link for otherwise indistinguishable dynamic call sites. */
  callSiteKeys?: string[];
};

export type ResolvedLegacyApiOperation = {
  operationKey: string;
  endpointKey: string;
  method: Exclude<LegacyApiCandidate["method"], "UNKNOWN">;
  path: string;
  originRef?: LegacyApiCandidate["originRef"];
  sourceLocator: string;
  operationId?: string;
  serverOrigins?: string[];
  resolution: "source" | "openapi" | "runtime";
  candidateKeys: string[];
};

type CandidateResolution = Omit<
  ResolvedLegacyApiOperation,
  "operationKey" | "endpointKey" | "originRef" | "candidateKeys"
> & { runtimeEvidenceKey?: string };

export function resolveLegacyApiCandidates(input: {
  candidates: LegacyApiCandidate[];
  openApiOperations: LegacyOpenApiOperationEvidence[];
  runtimeRequests: LegacyRuntimeRequestEvidence[];
}): { operations: ResolvedLegacyApiOperation[]; unresolved: LegacyApiCandidate[] } {
  const operations = new Map<string, ResolvedLegacyApiOperation>();
  const unresolved: LegacyApiCandidate[] = [];
  const resolutions = input.candidates.map((candidate) => ({
    candidate,
    resolution: resolveCandidate(candidate, input.openApiOperations, input.runtimeRequests),
  }));
  const pathlessRuntimeClaims = new Map<string, number>();
  for (const { candidate, resolution } of resolutions) {
    if (
      candidate.pathTemplate === undefined &&
      resolution?.resolution === "runtime" &&
      resolution.runtimeEvidenceKey !== undefined
    ) {
      pathlessRuntimeClaims.set(
        resolution.runtimeEvidenceKey,
        (pathlessRuntimeClaims.get(resolution.runtimeEvidenceKey) ?? 0) + 1,
      );
    }
  }
  for (const { candidate, resolution } of resolutions) {
    if (resolution === undefined) {
      unresolved.push(candidate);
      continue;
    }
    if (
      candidate.pathTemplate === undefined &&
      resolution.runtimeEvidenceKey !== undefined &&
      (pathlessRuntimeClaims.get(resolution.runtimeEvidenceKey) ?? 0) > 1
    ) {
      unresolved.push(candidate);
      continue;
    }
    const { runtimeEvidenceKey: _runtimeEvidenceKey, ...resolvedOperation } = resolution;
    const operationKey = `${resolution.method} ${resolution.path}`;
    const operationIdentity = `${operationKey}\0${candidate.endpointKey}`;
    const existing = operations.get(operationIdentity);
    if (existing === undefined) {
      operations.set(operationIdentity, {
        operationKey,
        endpointKey: candidate.endpointKey,
        ...(candidate.originRef === undefined ? {} : { originRef: candidate.originRef }),
        ...resolvedOperation,
        candidateKeys: [candidate.candidateKey],
      });
    } else if (!existing.candidateKeys.includes(candidate.candidateKey)) {
      existing.candidateKeys.push(candidate.candidateKey);
      existing.candidateKeys.sort();
    }
  }
  return {
    operations: [...operations.values()].sort(
      (left, right) =>
        left.operationKey.localeCompare(right.operationKey) ||
        left.endpointKey.localeCompare(right.endpointKey),
    ),
    unresolved,
  };
}

function resolveCandidate(
  candidate: LegacyApiCandidate,
  openApi: LegacyOpenApiOperationEvidence[],
  runtime: LegacyRuntimeRequestEvidence[],
): CandidateResolution | undefined {
  if (candidate.method !== "UNKNOWN" && candidate.pathTemplate !== undefined) {
    const matchingContract = uniqueMatches(
      openApi
        .filter(
          (operation) =>
            operation.method === candidate.method &&
            sameContractPathTemplate(candidate.pathTemplate!, operation.path),
        )
        .map(openApiResolution),
    );
    if (matchingContract.length === 1) return matchingContract[0];
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
              sameContractPathTemplate(candidate.pathTemplate, operation.path)
            : operation.operationId === operationId;
        return (
          identityMatches &&
          (candidate.method === "UNKNOWN" || candidate.method === operation.method) &&
          originMatches(candidate, operation.serverOrigins)
        );
      })
      .map(openApiResolution),
  );
  if (openApiMatches.length === 1) return openApiMatches[0];

  if (candidate.pathTemplate === undefined) {
    const matchingRuntime = runtime.filter(
      (request) =>
        (candidate.method === "UNKNOWN" || candidate.method === request.method) &&
        runtimeOriginMatches(candidate, request.origin),
    );
    const explicitLinks = matchingRuntime.filter((request) =>
      request.callSiteKeys?.some((key) =>
        candidate.callSites.some((callSite) => callSite.callSiteKey === key),
      ),
    );
    const runtimeMatches = uniqueRuntimeMatches(
      (explicitLinks.length > 0 ? explicitLinks : matchingRuntime).map((request) => ({
        method: request.method,
        path: request.path,
        sourceLocator: "legacy-runtime-network",
        resolution: "runtime" as const,
        runtimeEvidenceKey: runtimeRequestIdentity(request),
      })),
    );
    return runtimeMatches.length === 1 ? runtimeMatches[0] : undefined;
  }
  const runtimeMatches = uniqueRuntimeMatches(
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
        runtimeEvidenceKey: runtimeRequestIdentity(request),
      })),
  );
  return runtimeMatches.length === 1 ? runtimeMatches[0] : undefined;
}

function openApiResolution(operation: LegacyOpenApiOperationEvidence): CandidateResolution {
  return {
    method: operation.method,
    path: operation.path,
    sourceLocator: operation.sourceLocator,
    ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
    ...(operation.serverOrigins === undefined ? {} : { serverOrigins: operation.serverOrigins }),
    resolution: "openapi",
  };
}

function uniqueMatches<T extends { method: string; path: string }>(matches: T[]): T[] {
  return [
    ...new Map(matches.map((match) => [`${match.method} ${match.path}`, match] as const)).values(),
  ];
}

function uniqueRuntimeMatches<T extends { runtimeEvidenceKey: string }>(matches: T[]): T[] {
  return [...new Map(matches.map((match) => [match.runtimeEvidenceKey, match] as const)).values()];
}

function runtimeRequestIdentity(request: LegacyRuntimeRequestEvidence): string {
  const origin = request.origin === undefined ? "origin:unknown" : normalizedOrigin(request.origin);
  return `${request.method} ${normalizedPath(request.path)}\0${origin}`;
}

function samePathTemplate(left: string, right: string): boolean {
  const normalizedLeft = normalizedPath(left);
  const normalizedRight = normalizedPath(right);
  return pathTemplatePattern(normalizedLeft).test(normalizedRight);
}

function sameContractPathTemplate(left: string, right: string): boolean {
  const leftSegments = normalizedPath(left).split("/");
  const rightSegments = normalizedPath(right).split("/");
  if (leftSegments.length !== rightSegments.length) return false;
  return leftSegments.every((segment, index) => {
    const other = rightSegments[index]!;
    const segmentIsParameter = /^\{[^/{}]+\}$/u.test(segment);
    const otherIsParameter = /^\{[^/{}]+\}$/u.test(other);
    return segmentIsParameter || otherIsParameter
      ? segmentIsParameter && otherIsParameter
      : segment === other;
  });
}

function normalizedPath(value: string): string {
  return value.split(/[?#]/u, 1)[0]!.replace(/\/+$/u, "").toLowerCase();
}

function pathTemplatePattern(value: string): RegExp {
  const pattern = value
    .split(/(\{[^/{}]+\})/gu)
    .map((part) => (/^\{[^/{}]+\}$/u.test(part) ? "[^/]+" : escapeRegExp(part)))
    .join("");
  return new RegExp(`^${pattern}$`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function originMatches(
  candidate: LegacyApiCandidate,
  serverOrigins: string[] | undefined,
): boolean {
  if (serverOrigins === undefined || serverOrigins.length === 0) return true;
  const candidateOrigins = sanitizedCandidateOrigins(candidate);
  if (candidateOrigins.length === 0) return true;
  return serverOrigins.some((origin) =>
    candidateOrigins.some((candidateOrigin) => normalizedOriginsOverlap(origin, candidateOrigin)),
  );
}

function runtimeOriginMatches(
  candidate: LegacyApiCandidate,
  runtimeOrigin: string | undefined,
): boolean {
  const candidateOrigins = sanitizedCandidateOrigins(candidate);
  return (
    candidateOrigins.length === 0 ||
    runtimeOrigin === undefined ||
    candidateOrigins.some((candidateOrigin) =>
      normalizedOriginsOverlap(candidateOrigin, runtimeOrigin),
    )
  );
}

function sanitizedCandidateOrigins(candidate: LegacyApiCandidate): string[] {
  const origin = candidate.originRef;
  if (origin === undefined || origin.kind === "openapi-server") return [];
  if (origin.kind !== "environment") return [origin.sanitizedOrigin];
  return [
    ...(origin.sanitizedOrigin === undefined ? [] : [origin.sanitizedOrigin]),
    ...(origin.sanitizedOrigins ?? []).map((item) => item.origin),
  ];
}

function normalizedOriginsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizedOrigin(left);
  const normalizedRight = normalizedOrigin(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
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
