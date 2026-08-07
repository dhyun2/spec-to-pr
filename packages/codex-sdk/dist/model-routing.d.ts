export type ModelRole = "fast" | "build" | "expert";
export type ModelRoutingStrategy = "adaptive-verified" | "pinned" | "custom";
export type CodexModelRoutingInput = {
    strategy?: ModelRoutingStrategy;
    pinnedModel?: string;
    customModels?: Partial<Record<ModelRole, string>>;
    /**
     * Adapter-provided availability signal. It is intentionally not a CLI
     * switch: a caller cannot claim a weaker verification environment is fine.
     */
    unavailableRoles?: ModelRole[];
};
export type CodexModelRouting = {
    workflow: {
        strategy: ModelRoutingStrategy;
        pinnedModel?: string;
        customModels?: Record<ModelRole, string>;
        qualityGaps: Array<{
            role: ModelRole;
            requestedModel: string;
            actualModel: string;
            reason: string;
        }>;
    };
    models: Record<ModelRole, string>;
};
/** Codex-owned catalog; workflow core only receives fast/build/expert roles. */
export declare const CODEX_DEFAULT_MODELS: Readonly<Record<ModelRole, string>>;
export declare function resolveCodexModelRouting(input?: CodexModelRoutingInput, legacyPinnedModel?: string): CodexModelRouting;
