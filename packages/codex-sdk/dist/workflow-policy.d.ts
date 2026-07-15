import type { WorkloadSize } from "./workload-budget.js";
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
export type CodexScoutRoutingPolicy = {
    maxReadOnlyScouts: 0 | 1 | 2;
    independentReadHeavyOnly: true;
    allowNested: false;
    parallelWriters: false;
    parallelReviewersAfterImplementation: boolean;
};
export declare function scoutRoutingForWorkload(workloadSize: WorkloadSize): CodexScoutRoutingPolicy;
export declare function buildCodexActionEnvelopeInstructions(options: {
    publication: "draft" | "none";
    includeReviewAgents: boolean;
    includeDesignReview: boolean;
}): string;
export declare function buildCodexReviewAgentInstructions(options?: CodexReviewAgentInstructionOptions): string;
export declare function buildCodexPublishInstructions(): string;
