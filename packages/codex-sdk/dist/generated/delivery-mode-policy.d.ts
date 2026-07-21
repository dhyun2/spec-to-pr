export type PrReportSectionId = "api" | "legacy" | "visual" | "functional-review" | "design-review" | "performance" | "feature-evidence";
export type ModeRequirementSet = {
    brief: boolean;
    legacyBaseline: boolean;
    legacyInventory: boolean;
    targetedFeatureE2E: boolean;
    featureVideo: boolean;
    figmaBundle: boolean;
    visualComparison: boolean;
    apiCoverage: boolean;
    performanceEvidence: boolean;
    mockData: boolean;
};
export type ModeValidationId = "legacy-baseline" | "legacy-inventory" | "targeted-feature-e2e" | "feature-video" | "figma-bundle" | "visual-comparison" | "api-coverage" | "performance-evidence" | "mock-data" | "api-ready";
export type DeliveryPolicyInput = {
    mode: "brief" | "legacy" | "feature" | "figma";
    hasOpenApi: boolean;
    legacyApiOperationCount: number;
    ui: boolean;
    workload: "XS" | "S" | "M" | "L" | "XL";
};
export type ResolvedDeliveryPolicy = {
    requirements: ModeRequirementSet;
    requireApiReady: boolean;
    modeValidations: readonly ModeValidationId[];
    sectionApplicability: Readonly<Record<PrReportSectionId, boolean>>;
    parallelReviewers: boolean;
};
export declare const VISUAL_POLICY: {
    readonly reviewThreshold: 0.98;
    readonly maxMaskedAreaRatio: 0.2;
    readonly maxComparisonAttempts: 3;
};
export declare function parallelReviewersForWorkload(workload: DeliveryPolicyInput["workload"]): boolean;
export declare function resolveDeliveryPolicy(input: DeliveryPolicyInput): ResolvedDeliveryPolicy;
