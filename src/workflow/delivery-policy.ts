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

export function buildDelegationPolicy(size: WorkloadSize): DelegationPolicy {
  const maxReadOnlyScouts = size === "XS" || size === "S" ? 0 : size === "M" ? 1 : 2;

  return DelegationPolicySchema.parse({
    singleWriter: true,
    allowNested: false,
    maxReadOnlyScouts,
    parallelReviewers: size === "L" || size === "XL",
  });
}

export function buildDeliveryProfile(input: {
  mode: DeliveryMode;
  changeKind: ChangeKind;
  publication: "draft" | "none";
  scope: WorkflowScope;
  briefPath?: string;
  figmaUrl?: string;
  docsPaths?: string[];
  openApiPaths?: string[];
  guidancePaths?: string[];
  discoveredGuidancePaths?: string[];
  skillHints?: string[];
  recommendedSkills?: string[];
}): DeliveryProfile {
  if (input.mode === "brief" && input.briefPath === undefined) {
    throw new Error("brief mode requires briefPath");
  }
  if (input.mode === "figma" && input.figmaUrl === undefined) {
    throw new Error("figma mode requires figmaUrl");
  }
  if ((input.mode === "feature" || input.mode === "figma") && !input.scope.ui) {
    throw new Error(`${input.mode} mode requires UI scope`);
  }

  const userFacingFeature = input.mode === "feature" && input.scope.ui;

  return DeliveryProfileSchema.parse({
    mode: input.mode,
    changeKind: input.changeKind,
    publication: input.publication,
    ...(input.briefPath === undefined ? {} : { briefPath: input.briefPath }),
    ...(input.figmaUrl === undefined ? {} : { figmaUrl: input.figmaUrl }),
    docsPaths: input.docsPaths ?? [],
    openApiPaths: input.openApiPaths ?? [],
    guidancePaths: input.guidancePaths ?? [],
    discoveredGuidancePaths: input.discoveredGuidancePaths ?? [],
    skillHints: input.skillHints ?? [],
    recommendedSkills: input.recommendedSkills ?? [],
    requirements: {
      brief: input.briefPath !== undefined,
      legacyBaseline: input.mode === "legacy",
      targetedFeatureE2E: userFacingFeature,
      featureVideo: userFacingFeature,
      figmaBundle: input.figmaUrl !== undefined,
    },
  });
}
