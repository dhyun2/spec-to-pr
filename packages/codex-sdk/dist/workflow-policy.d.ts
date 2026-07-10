export type CodexReviewAgentProfile = {
    name: string;
    focus: string;
    output: string;
};
export type CodexVisualRepairPolicy = {
    minPassingScore: number;
    maxAttempts: number;
};
export declare const DEFAULT_CODEX_VISUAL_REPAIR_POLICY: CodexVisualRepairPolicy;
export declare const CODEX_REVIEW_AGENT_PROFILES: CodexReviewAgentProfile[];
export declare function buildCodexReviewAgentInstructions(profiles?: CodexReviewAgentProfile[]): string;
export declare function buildCodexVisualRepairInstructions(policy?: Partial<CodexVisualRepairPolicy>): string;
export declare function buildCodexPublishInstructions(): string;
