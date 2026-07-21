import {
  DelegationPolicySchema,
  DeliveryProfileSchema,
  type ChangeKind,
  type DelegationPolicy,
  type DeliveryMode,
  type DeliveryProfile,
  type WorkflowScope,
} from "./workflow-contracts.js";
import type { WorkloadSize } from "./workload-policy.js";
import { parallelReviewersForWorkload, resolveDeliveryPolicy } from "./delivery-mode-policy.js";

export function buildDelegationPolicy(size: WorkloadSize): DelegationPolicy {
  const maxReadOnlyScouts = size === "XS" || size === "S" ? 0 : size === "M" ? 1 : 2;

  return DelegationPolicySchema.parse({
    singleWriter: true,
    allowNested: false,
    maxReadOnlyScouts,
    parallelReviewers: parallelReviewersForWorkload(size),
  });
}

export function buildDeliveryProfile(input: {
  mode: DeliveryMode;
  changeKind: ChangeKind;
  publication: "draft" | "none";
  scope: WorkflowScope;
  legacyProjectRoot?: string;
  legacyNetworkEvidencePath?: string;
  briefPath?: string;
  figmaUrl?: string;
  docsPaths?: string[];
  openApiPaths?: string[];
  openApiUrls?: string[];
  openApiOperations?: DeliveryProfile["openApiOperations"];
  guidancePaths?: string[];
  discoveredGuidancePaths?: string[];
  skillHints?: string[];
  recommendedSkills?: string[];
  sourceProvenance?: DeliveryProfile["sourceProvenance"];
}): DeliveryProfile {
  const fullDelivery = input.mode === "brief" || input.mode === "feature";
  if (fullDelivery && input.briefPath === undefined) {
    throw new Error(input.mode + " mode requires briefPath");
  }
  if (fullDelivery && input.figmaUrl === undefined) {
    throw new Error(input.mode + " mode requires figmaUrl");
  }
  if (fullDelivery && (input.openApiPaths?.length ?? 0) + (input.openApiUrls?.length ?? 0) === 0) {
    throw new Error(input.mode + " mode requires at least one OpenAPI source");
  }
  if (input.mode === "legacy" && input.legacyProjectRoot === undefined) {
    throw new Error("legacy mode requires legacyProjectRoot");
  }
  if (input.mode === "figma" && input.figmaUrl === undefined) {
    throw new Error("figma mode requires figmaUrl");
  }
  if (
    (input.mode === "brief" ||
      input.mode === "legacy" ||
      input.mode === "feature" ||
      input.mode === "figma" ||
      input.figmaUrl !== undefined) &&
    !input.scope.ui
  ) {
    throw new Error(input.mode + " mode requires UI scope");
  }

  const hasOpenApi = (input.openApiPaths?.length ?? 0) + (input.openApiUrls?.length ?? 0) > 0;
  const requirements =
    input.mode === "auto"
      ? {
          brief: false,
          legacyBaseline: false,
          legacyInventory: false,
          targetedFeatureE2E: false,
          featureVideo: false,
          figmaBundle: false,
          visualComparison: false,
          apiCoverage: false,
          performanceEvidence: false,
          mockData: false,
        }
      : resolveDeliveryPolicy({
          mode: input.mode,
          hasOpenApi,
          legacyApiOperationCount:
            input.mode === "legacy" ? (input.openApiOperations?.length ?? 0) : 0,
          ui: input.scope.ui,
          workload: "M",
        }).requirements;

  return DeliveryProfileSchema.parse({
    mode: input.mode,
    changeKind: input.changeKind,
    publication: input.publication,
    ...(input.legacyProjectRoot === undefined
      ? {}
      : { legacyProjectRoot: input.legacyProjectRoot }),
    ...(input.legacyNetworkEvidencePath === undefined
      ? {}
      : { legacyNetworkEvidencePath: input.legacyNetworkEvidencePath }),
    ...(input.briefPath === undefined ? {} : { briefPath: input.briefPath }),
    ...(input.figmaUrl === undefined ? {} : { figmaUrl: input.figmaUrl }),
    docsPaths: input.docsPaths ?? [],
    openApiPaths: input.openApiPaths ?? [],
    openApiUrls: input.openApiUrls ?? [],
    openApiOperations: input.openApiOperations ?? [],
    guidancePaths: input.guidancePaths ?? [],
    discoveredGuidancePaths: input.discoveredGuidancePaths ?? [],
    skillHints: input.skillHints ?? [],
    recommendedSkills: input.recommendedSkills ?? [],
    sourceProvenance: input.sourceProvenance ?? [],
    requirements,
  });
}
