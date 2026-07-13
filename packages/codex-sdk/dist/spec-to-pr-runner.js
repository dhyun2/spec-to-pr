import { Codex, } from "@openai/codex-sdk";
import { CODEX_WORKFLOW_TOOL_NAMES, buildCodexPublishInstructions, buildCodexReviewAgentInstructions, } from "./workflow-policy.js";
export async function runSpecToPrWithCodex(input) {
    validateSpecToPrRunInput(input);
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
    validateSpecToPrRunInput(input);
    const sources = [
        formatSource("Brief", input.briefPath),
        formatSource("Docs", input.docsPath),
        formatSource("Figma", input.figmaUrl),
        formatSource("OpenAPI", input.openApiPath),
    ].filter((line) => line !== undefined);
    const userPrompt = input.prompt ??
        "Run the spec-to-pr workflow from intake through evidence-backed implementation planning.";
    const hasUiScope = isUiScope(input, userPrompt);
    const deliveryMode = resolveDeliveryMode(input);
    const publication = input.publication ?? (deliveryMode === "figma" ? "none" : "draft");
    const changeKind = input.changeKind ?? defaultChangeKind(deliveryMode);
    const startFields = [
        `projectRoot: ${JSON.stringify(input.workingDirectory)}`,
        "requestText: the complete user request plus any faithful brief-derived UI/API scope summary",
        `scope: ${JSON.stringify(hasUiScope ? "ui" : "auto")}`,
        `mode: ${JSON.stringify(deliveryMode)}`,
        `changeKind: ${JSON.stringify(changeKind)}`,
        `publication: ${JSON.stringify(publication)}`,
        ...(input.briefPath === undefined ? [] : [`briefPath: ${JSON.stringify(input.briefPath)}`]),
        ...(input.figmaUrl === undefined ? [] : [`figmaUrl: ${JSON.stringify(input.figmaUrl)}`]),
    ].join(", ");
    return [
        "Use the installed spec-to-pr Codex plugin when it is available.",
        `The complete public tool surface is: ${CODEX_WORKFLOW_TOOL_NAMES.join(", ")}. Do not call internal or legacy micro-tools.`,
        modeInstructions(deliveryMode),
        `Call workflow_info to read the contract, then workflow_start once with the request and these delivery fields: ${startFields}.`,
        publication === "draft"
            ? "Before implementation, inspect git status and work on an actual non-target codex/<short-slug> source branch without absorbing unrelated dirty changes. Before workflow_publish, stage only intended files, commit all intended changes on that source branch, require a clean tree and at least one commit beyond the target, then pass the actual sourceBranch and targetBranch."
            : "Do not create a publication-only branch when publication is none unless implementation isolation requires it.",
        "Use workflow_advance until it returns an external action or terminal status. Fulfill external actions and return compact evidence with workflow_submit; use workflow_status to resume or inspect blockers.",
        "Keep API and UI work in one implementation context; never split them into separate implementation agents or worktrees.",
        'For API-backed UI, generate distinct physical non-empty project-local types, schemas, wrappers, mocks, and a passing JSON contract-test result before UI work and UI completion evidence; path, symlink, and hard-link aliases do not count separately. Submit workflow_submit with kind: "api-ready", status: "passed", one stable implementationContextId, artifactPaths, and apiArtifacts containing nonempty types, schemas, wrappers, mocks, and contractTests arrays. Continue UI in the same context and repeat that implementationContextId on final implementation only after workflow_status records the checkpoint; apiReady: true alone is not evidence.',
        "Run the fast default gates selected by workflow applicability. Run full matrices, hardening suites, package verification, and cross-host manifest validation only for an explicit release workflow.",
        "",
        buildCodexPublishInstructions(),
        "",
        input.enableReviewAgents === false
            ? ""
            : buildCodexReviewAgentInstructions({
                includeFunctionalReview: true,
                includeDesignReview: hasUiScope || deliveryMode === "brief",
            }),
        "",
        "User request:",
        userPrompt,
        "",
        "Sources:",
        sources.length === 0 ? "- none provided" : sources.join("\n"),
    ].join("\n");
}
export function validateSpecToPrRunInput(input) {
    if (input.workingDirectory.trim() === "") {
        throw new Error("workingDirectory is required");
    }
    const mode = resolveDeliveryMode(input);
    if (mode === "brief" && (input.briefPath === undefined || input.briefPath.trim() === "")) {
        throw new Error("brief mode requires briefPath");
    }
    if (mode === "figma" && (input.figmaUrl === undefined || input.figmaUrl.trim() === "")) {
        throw new Error("figma mode requires figmaUrl");
    }
    if ((mode === "legacy" || mode === "feature") &&
        (input.prompt === undefined || input.prompt.trim().length < 3)) {
        throw new Error(`${mode} mode requires a concrete prompt describing the requested change`);
    }
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
    if (input.deliveryMode === "feature" || input.deliveryMode === "figma") {
        return true;
    }
    if (input.figmaUrl !== undefined && input.figmaUrl.trim() !== "") {
        return true;
    }
    return /\b(ui|ux|frontend|front-end|screen|page|view|component|design|figma|responsive|visual)\b/i.test(prompt);
}
function resolveDeliveryMode(input) {
    if (input.deliveryMode !== undefined)
        return input.deliveryMode;
    if (input.figmaUrl !== undefined && input.figmaUrl.trim() !== "")
        return "figma";
    if (input.briefPath !== undefined && input.briefPath.trim() !== "")
        return "brief";
    return "auto";
}
function defaultChangeKind(mode) {
    if (mode === "feature" || mode === "brief")
        return "feature";
    if (mode === "figma")
        return "design";
    return "auto";
}
function modeInstructions(mode) {
    if (mode === "brief") {
        return "Brief mode: read the supplied project-local brief before workflow_start, preserve its acceptance criteria, set scope=ui when applicable, and include a compact faithful UI/API scope summary in requestText. The runtime also reads briefPath for classification; do not invent missing requirements.";
    }
    if (mode === "legacy") {
        return "Legacy mode: capture a focused baseline for the requested behavior and verify only the affected regression scope by default.";
    }
    if (mode === "feature") {
        return [
            "Feature mode: run a single targeted feature E2E selected by test path, tag, or project and record exactly one .webm or .mp4.",
            "Never run the full-project E2E suite by default.",
            "Run one unchained Playwright command without --list or --pass-with-no-tests. Use a stable implementationContextId and write a strict JSON result containing only status=passed, the exact selector, that same implementationContextId, and a positive testCount. Record a structurally valid non-zero-duration WebM/MP4 container up to 25 MB.",
            "Submit featureEvidence with scope=targeted-feature, testSelector, testCommand, resultPath, and videoPath on implementation.",
        ].join(" ");
    }
    if (mode === "figma") {
        return "Figma mode: use the connected Figma capability to capture real nodes, variables, screenshots, and component context; before contracts submit exactly one figma-bundle with provider=host-connected-figma, ISO capturedAt, matching fileUrl, nonempty nodeIds, a declared JSON manifestPath, and one or more actual PNG artifacts. The strict manifest repeats that provenance and exactly lists the PNG visualPaths. Do not replace intake with URL-only claims, repeat the bundle, or poll at runtime.";
    }
    return "Auto mode: keep evidence proportional to the classified change and do not activate mode-specific gates without explicit input.";
}
