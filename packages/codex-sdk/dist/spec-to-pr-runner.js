import { Codex, } from "@openai/codex-sdk";
import { DEFAULT_CODEX_VISUAL_REPAIR_POLICY, buildCodexPublishInstructions, buildCodexReviewAgentInstructions, buildCodexVisualRepairInstructions, } from "./workflow-policy.js";
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
    return [
        "Use the installed spec-to-pr Codex plugin when it is available.",
        "Start with the spec-to-pr doctor check before relying on MCP tools.",
        "Follow the evidence-first flow: intake sources, build traceability, generate OpenSpec/Gherkin/contracts, prepare agent runtime, run mandatory quality gates, run accessibility, performance/Web Vitals, security, observability, and run visual comparison when Figma evidence exists. Generate a PR report only after required evidence exists.",
        'Call generate_pr_report with language: "ko" unless the user explicitly asks for English.',
        "Do not publish a review request if the PR report decision is blocked.",
        "When Figma input is present, do not call the work review-ready unless there is Figma-vs-implementation visual comparison evidence.",
        "",
        buildCodexPublishInstructions(),
        "",
        input.enableReviewAgents === false ? "" : buildCodexReviewAgentInstructions(),
        "",
        input.enableVisualRepairLoop === false
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
