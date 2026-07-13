import {
  DeliveryProfileSchema,
  type ChangeKind,
  type DeliveryMode,
  type DeliveryProfile,
  type WorkflowScope,
} from "./workflow-contracts.js";

export function buildDeliveryProfile(input: {
  mode: DeliveryMode;
  changeKind: ChangeKind;
  publication: "draft" | "none";
  scope: WorkflowScope;
  briefPath?: string;
  figmaUrl?: string;
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
    requirements: {
      brief: input.mode === "brief",
      legacyBaseline: input.mode === "legacy",
      targetedFeatureE2E: userFacingFeature,
      featureVideo: userFacingFeature,
      figmaBundle: input.mode === "figma",
    },
  });
}
