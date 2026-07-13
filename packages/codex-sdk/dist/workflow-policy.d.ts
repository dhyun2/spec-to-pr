export type CodexReviewAgentProfile = {
    name: string;
    focus: string;
    output: string;
};
export type CodexReviewAgentInstructionOptions = {
    includeFunctionalReview?: boolean;
    includeDesignReview?: boolean;
};
export declare const CODEX_WORKFLOW_TOOL_NAMES: readonly ["workflow_info", "workflow_start", "workflow_advance", "workflow_submit", "workflow_status", "workflow_publish", "workflow_archive"];
export declare const CODEX_REVIEW_AGENT_PROFILES: CodexReviewAgentProfile[];
export declare function buildCodexReviewAgentInstructions(options?: CodexReviewAgentInstructionOptions): string;
export declare function buildCodexPublishInstructions(): string;
