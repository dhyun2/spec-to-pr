import { Codex, } from "@openai/codex-sdk";
import { CODEX_WORKFLOW_TOOL_NAMES, DEFAULT_CODEX_VISUAL_REPAIR_POLICY, buildCodexPublishInstructions, buildCodexReviewAgentInstructions, buildCodexVisualRepairInstructions, } from "./workflow-policy.js";
export async function runSpecToPrWithCodex(input) {
    const codex = new Codex(buildCodexOptions(input));
    const thread = input.resumeThreadId === undefined
        ? codex.startThread(buildThreadOptions(input))
        : codex.resumeThread(input.resumeThreadId, buildThreadOptions(input));
    const result = input.outputSchema === undefined
        ? await thread.run(buildSpecToPrPrompt(input))
        : await thread.run(buildSpecToPrPrompt(input), {
            outputSchema: input.outputSchema,
        });
    return {
        threadId: thread.id,
        finalResponse: result.finalResponse,
        usage: result.usage,
        items: result.items,
    };
}
export function buildSpecToPrPrompt(input) {
    const sources = [
        formatSource("Brief", input.briefPath),
        formatSource("Docs", input.docsPath),
        formatSource("Figma", input.figmaUrl),
        formatSource("OpenAPI", input.openApiPath),
    ].filter((line) => line !== undefined);
    const userPrompt = input.prompt ??
        "Run the spec-to-pr workflow from intake through evidence-backed implementation planning.";
    const hasUiScope = isUiScope(input, userPrompt);
    return [
        "Use the installed spec-to-pr Codex plugin when it is available.",
        `The complete public tool surface is: ${CODEX_WORKFLOW_TOOL_NAMES.join(", ")}. Do not call internal or legacy micro-tools.`,
        "Call workflow_info to read the contract, then workflow_start once with the request and sources.",
        "Use workflow_advance until it returns an external action or terminal status. Fulfill external actions and return compact evidence with workflow_submit; use workflow_status to resume or inspect blockers.",
        "Keep API and UI work in one implementation context; never split them into separate implementation agents or worktrees.",
        "For API-backed scope, generate types, schemas, wrappers, mocks, and contract-test evidence, then submit the api-ready checkpoint before UI completion evidence.",
        "Run the fast default gates selected by workflow applicability. Run full matrices, hardening suites, package verification, and cross-host manifest validation only for an explicit release workflow.",
        "",
        buildCodexPublishInstructions(),
        "",
        input.enableReviewAgents === false
            ? ""
            : buildCodexReviewAgentInstructions({
                includeFunctionalReview: true,
                includeDesignReview: hasUiScope,
            }),
        "",
        input.enableVisualRepairLoop === false || !hasUiScope
            ? ""
            : buildCodexVisualRepairInstructions({
                ...DEFAULT_CODEX_VISUAL_REPAIR_POLICY,
                ...input.visualRepairPolicy,
            }),
        "",
        "User request:",
        userPrompt,
        "",
        "Sources:",
        sources.length === 0 ? "- none provided" : sources.join("\n"),
    ].join("\n");
}
function buildCodexOptions(input) {
    const options = {};
    if (input.codexPathOverride !== undefined) {
        options.codexPathOverride = input.codexPathOverride;
    }
    if (input.env !== undefined) {
        options.env = input.env;
    }
    return options;
}
function buildThreadOptions(input) {
    const options = {
        workingDirectory: input.workingDirectory,
        sandboxMode: input.sandboxMode ?? "workspace-write",
        approvalPolicy: input.approvalPolicy ?? "on-request",
        modelReasoningEffort: input.modelReasoningEffort ?? "high",
    };
    if (input.model !== undefined) {
        options.model = input.model;
    }
    if (input.additionalDirectories !== undefined) {
        options.additionalDirectories = input.additionalDirectories;
    }
    return options;
}
function formatSource(label, value) {
    return value === undefined || value.trim() === "" ? undefined : `- ${label}: ${value}`;
}
function isUiScope(input, prompt) {
    if (input.figmaUrl !== undefined && input.figmaUrl.trim() !== "") {
        return true;
    }
    return /\b(ui|ux|frontend|front-end|screen|page|view|component|design|figma|responsive|visual)\b/i.test(prompt);
}
