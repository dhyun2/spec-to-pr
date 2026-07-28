import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Codex, } from "@openai/codex-sdk";
import { executeBudgetedBoundaryTurns, } from "./boundary-runner.js";
import { UsageCalibrationStore, calibrateTokenRange, isUsageCalibrationReadEnabled, isUsageCalibrationEligible, readCalibrationBestEffort, recordCalibrationBestEffort, } from "./usage-calibration.js";
import { defaultTokenRangeForWorkload, effectiveHardLimitForWorkload, estimateSdkWorkload, } from "./workload-budget.js";
import { CODEX_WORKFLOW_TOOL_NAMES, buildCodexActionEnvelopeInstructions, } from "./workflow-policy.js";
export const DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE = 24_000;
export async function runSpecToPrWithCodex(input) {
    validateSpecToPrRunInput(input);
    const composableSources = normalizeComposableSources(input);
    const codex = new Codex(buildCodexOptions(input));
    const deliveryMode = resolveDeliveryMode(input);
    const initialEstimate = estimateSdkWorkload({
        deliveryMode,
        promptLength: input.prompt?.length ?? 0,
        hasBrief: input.briefPath !== undefined,
        hasFigma: normalizedFigmaUrls(input).length > 0,
        hasOpenApi: composableSources.openApiPaths.length + composableSources.openApiUrls.length > 0,
    });
    const repositoryRoot = resolveRepositoryRoot(input.workingDirectory);
    const usageStore = new UsageCalibrationStore(resolveUsageHistoryPath(input), {
        excludedRoot: repositoryRoot,
    });
    const calibrationEnabled = input.usageCalibration !== false;
    const calibrationReadEnabled = isUsageCalibrationReadEnabled({
        enabled: calibrationEnabled,
        resumed: input.resumeThreadId !== undefined,
    });
    const calibrationRead = calibrationReadEnabled
        ? await readCalibrationBestEffort(usageStore)
        : { samples: [], status: "disabled" };
    const calibrationByWorkload = Object.fromEntries(["XS", "S", "M", "L", "XL"].map((size) => [
        size,
        calibrateTokenRange({
            mode: deliveryMode,
            workloadSize: size,
            fallback: defaultTokenRangeForWorkload(size),
            samples: calibrationRead.samples,
        }),
    ]));
    const calibration = calibrationByWorkload[initialEstimate.size];
    const initialWorkload = {
        size: initialEstimate.size,
        confidence: calibration.confidence,
        source: calibration.source,
        tokenRange: { min: calibration.min, max: calibration.max },
        sampleCount: calibration.sampleCount,
    };
    const hardLimitTokens = effectiveHardLimitForWorkload(initialWorkload.size);
    const requiredValidations = requiredValidationsForInput(input);
    const result = await executeBudgetedBoundaryTurns({
        client: createBoundaryClient(codex, buildThreadOptions(input)),
        initialPrompt: input.resumeThreadId === undefined ? buildSpecToPrPrompt(input) : buildResumeSpecToPrPrompt(),
        ...(input.resumeThreadId === undefined ? {} : { resumeThreadId: input.resumeThreadId }),
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
        hardLimitTokens,
        workloadSize: initialWorkload.size,
        workloadHardLimits: Object.fromEntries(Object.keys(calibrationByWorkload).map((size) => [
            size,
            effectiveHardLimitForWorkload(size),
        ])),
        requiredValidations,
        maxTurns: input.maxTurns ?? 12,
        blockedDiagnosticTokenReserve: input.blockedDiagnosticTokenReserve ?? DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE,
        inspectBlockedDiagnosticPreflight: () => inspectBlockedDiagnosticPreflight(input.workingDirectory, input.env),
    });
    const usage = sdkUsage(result.usage);
    const runtimeWorkload = result.workflowStatus?.workload;
    const runtimeCalibration = calibrationByWorkload[result.workloadSize];
    const workload = runtimeCalibration.source === "calibrated"
        ? {
            size: result.workloadSize,
            confidence: runtimeCalibration.confidence,
            source: runtimeCalibration.source,
            tokenRange: { min: runtimeCalibration.min, max: runtimeCalibration.max },
            sampleCount: runtimeCalibration.sampleCount,
        }
        : runtimeWorkload === undefined
            ? initialWorkload
            : {
                size: runtimeWorkload.size,
                confidence: runtimeWorkload.confidence,
                source: runtimeWorkload.source,
                tokenRange: runtimeWorkload.tokenRange,
                sampleCount: runtimeCalibration.sampleCount,
            };
    const calibrationWrite = !calibrationEnabled
        ? "disabled"
        : !isUsageCalibrationEligible({
            completed: result.state === "completed",
            resumed: input.resumeThreadId !== undefined,
            usageAvailability: result.usage.availability,
        })
            ? "skipped"
            : await recordCalibrationBestEffort(usageStore, {
                version: 1,
                mode: deliveryMode,
                workloadSize: result.workloadSize,
                estimatedMinTokens: workload.tokenRange.min,
                estimatedMaxTokens: workload.tokenRange.max,
                hardLimitTokens: result.hardLimitTokens,
                inputTokens: result.usage.inputTokens,
                cachedInputTokens: result.usage.cachedInputTokens,
                outputTokens: result.usage.outputTokens,
                reasoningOutputTokens: result.usage.reasoningOutputTokens,
                totalTokens: result.usage.totalTokens,
                turnCount: result.turnCount,
                checkpointCount: result.checkpointCount,
                completed: result.state === "completed",
                recordedAtEpochMs: Date.now(),
            });
    return {
        threadId: result.threadId,
        finalResponse: result.finalResponse,
        usage,
        items: result.items,
        workload,
        budget: {
            state: result.state,
            checkpointPercent: 80,
            checkpointAtTokens: Math.floor(result.hardLimitTokens * 0.8),
            hardLimitTokens: result.hardLimitTokens,
            usedTokens: result.usage.totalTokens,
            checkpointCount: result.checkpointCount,
            requiredValidations: result.requiredValidations,
            usageAvailability: result.usage.availability,
        },
        turnCount: result.turnCount,
        outputFormatting: result.outputFormatting,
        usageCalibration: {
            enabled: calibrationEnabled,
            read: calibrationRead.status,
            write: calibrationWrite,
            sampleCount: runtimeCalibration.sampleCount,
        },
    };
}
export function buildSpecToPrPrompt(input) {
    validateSpecToPrRunInput(input);
    const composableSources = normalizeComposableSources(input);
    const figmaUrls = normalizedFigmaUrls(input);
    const sources = [
        formatSource("Legacy project", input.legacyProjectRoot),
        formatSource("Legacy runtime network evidence", input.legacyNetworkEvidencePath),
        formatSource("Brief", input.briefPath),
        ...composableSources.docsPaths.map((sourcePath) => formatSource("Docs", sourcePath)),
        ...figmaUrls.map((figmaUrl) => formatSource("Figma", figmaUrl)),
        ...composableSources.openApiPaths.map((sourcePath) => formatSource("OpenAPI", sourcePath)),
        ...composableSources.openApiUrls.map((sourceUrl) => formatSource("OpenAPI URL", sourceUrl)),
        ...composableSources.guidancePaths.map((sourcePath) => formatSource("Project guidance", sourcePath)),
        ...composableSources.skillHints.map((skillHint) => formatSource("Optional skill hint", skillHint)),
    ].filter((line) => line !== undefined);
    const userPrompt = input.prompt ??
        "Run the spec-to-pr workflow from intake through evidence-backed implementation planning.";
    const hasUiScope = isUiScope(input, userPrompt);
    const deliveryMode = resolveDeliveryMode(input);
    const publication = input.publication ?? "draft";
    const changeKind = input.changeKind ?? defaultChangeKind(deliveryMode);
    const startFields = [
        `projectRoot: ${JSON.stringify(input.workingDirectory)}`,
        "requestText: the complete user request plus any faithful brief-derived UI/API scope summary",
        `scope: ${JSON.stringify(hasUiScope ? "ui" : "auto")}`,
        `mode: ${JSON.stringify(deliveryMode)}`,
        `changeKind: ${JSON.stringify(changeKind)}`,
        `publication: ${JSON.stringify(publication)}`,
        ...(input.legacyProjectRoot === undefined
            ? []
            : [`legacyProjectRoot: ${JSON.stringify(input.legacyProjectRoot)}`]),
        ...(input.legacyNetworkEvidencePath === undefined
            ? []
            : [`legacyNetworkEvidencePath: ${JSON.stringify(input.legacyNetworkEvidencePath)}`]),
        ...(input.briefPath === undefined ? [] : [`briefPath: ${JSON.stringify(input.briefPath)}`]),
        ...(figmaUrls.length === 0 ? [] : [`figmaUrls: ${JSON.stringify(figmaUrls)}`]),
        ...(composableSources.docsPaths.length === 0
            ? []
            : [`docsPaths: ${JSON.stringify(composableSources.docsPaths)}`]),
        ...(composableSources.openApiPaths.length === 0
            ? []
            : [`openApiPaths: ${JSON.stringify(composableSources.openApiPaths)}`]),
        ...(composableSources.openApiUrls.length === 0
            ? []
            : [`openApiUrls: ${JSON.stringify(composableSources.openApiUrls)}`]),
        ...(composableSources.guidancePaths.length === 0
            ? []
            : [`guidancePaths: ${JSON.stringify(composableSources.guidancePaths)}`]),
        ...(composableSources.skillHints.length === 0
            ? []
            : [`skillHints: ${JSON.stringify(composableSources.skillHints)}`]),
    ].join(", ");
    return [
        "Use the installed spec-to-pr Codex plugin when it is available.",
        `The complete public tool surface is: ${CODEX_WORKFLOW_TOOL_NAMES.join(", ")}. Do not call internal or legacy micro-tools.`,
        modeInstructions(deliveryMode),
        `Call workflow_info to read the contract. Call workflow_start exactly once with the request and these delivery fields: ${startFields}.`,
        "Apply instructions in this precedence order: current user request > explicit project guidance > automatically discovered project guidance > applicable installed skills > SpecToPR defaults.",
        "For each optional skill hint, ask the host to use the named skill only when it is installed and applicable. Missing optional skills do not block the Run; never assume a hinted capability is available.",
        "When submitting evidence, include an optional skill in guidanceTrace.appliedSkills only when it was actually applied. Do not copy unused skill hints or recommendations.",
        "Use workflow_advance until it returns an external action or terminal status. Fulfill external actions and return compact evidence with workflow_submit; use workflow_status to resume or inspect blockers.",
        "When workflow_status includes workspaceBinding, treat its repositoryRoot, sourceBranch, targetBranch, remoteName, remoteUrl, baseSha, and publicationTarget as immutable. Use those exact values for workflow_publish preview and execute; never infer or substitute a different branch, remote, host, or repository.",
        buildCodexActionEnvelopeInstructions({
            publication,
            includeReviewAgents: input.enableReviewAgents !== false,
            includeDesignReview: hasUiScope,
        }),
        'For API-backed UI, generate distinct physical non-empty project-local types, schemas, wrappers, mocks, and a passing JSON contract-test result before UI work and UI completion evidence; path, symlink, and hard-link aliases do not count separately. Submit workflow_submit with kind: "api-ready", status: "passed", one stable implementationContextId, artifactPaths, apiArtifacts with nonempty types/schemas/wrappers/mocks/contractTests arrays, and operation-aware operations. Continue UI in the same context and repeat that implementationContextId on final implementation only after workflow_status records the checkpoint; apiReady: true alone is not evidence. Final implementation must include apiCoverage mapping every documented operation to production call sites, mock handlers, and executable evidence, or an explicit blocking gap.',
        "Treat deliveryProfile.sourceProvenance as immutable pinned input evidence. For each UI state, declare visualTargets with baseline kind/path, route, state, fixture, viewport, deviceScaleFactor, and only justified masks. After capturing a target screenshot, answer compare-visuals with a capture manifest that repeats targetId, route, state, viewport, deviceScaleFactor, and fixture and records provider, ISO capturedAt, actualPath, and its sha256 actualDigest. The runtime rejects target drift or digest mismatch, then computes alpha-aware exact/review scores, diff, and overlay, requires at least 98%, and permits three total comparison attempts: the initial comparison plus at most two repairs. Never submit caller-computed scores or verdicts.",
        "When deliveryProfile.draftEvidenceBundle is present, use it as the stable feature-scoped review bundle. Keep product code and test source in their existing project paths; store only compact final contracts, JSON evidence, final visual PNGs, and reviewer report material below the bundle root. The manifest records run ID and digests, but no directory name includes a run ID. For legacy migration, create and submit the bundle manifest plus an OpenSpec proposal, delta spec, and tasks document as draftBundle contract evidence. Never place credentials, headers, full HAR files, raw browser logs, or transient output in that bundle.",
        "For brief, legacy, and feature delivery, include measured lab performance and Web Vitals evidence plus an explicit field-data source or unavailable reason. The final canonical pr-report-v2.1 binds source provenance, requirements, changed files, API coverage/gaps, legacy coverage, visual ratios/assets, both independent reviews, performance, feature evidence when applicable, blockers, risks, rollback, and the evidence index to the immutable review packet. Every section is complete, not-run, blocked, or not-applicable; stale packet paths are omitted. A blocked diagnostic uses the same 15-section PR shape and identifies the stopped stage and exact unblock action.",
        "Run the fast default gates selected by workflow applicability. Run full matrices, hardening suites, package verification, and cross-host manifest validation only for an explicit release workflow.",
        "",
        "User request:",
        userPrompt,
        "",
        "Sources:",
        sources.length === 0 ? "- none provided" : sources.join("\n"),
    ].join("\n");
}
export function buildResumeSpecToPrPrompt() {
    return [
        "Resume the existing Run recorded in this Codex task; do not create a new Run or repeat intake.",
        "Recover the latest runId from thread history and call workflow_status first. If no durable runId is recoverable, stop without modifying files.",
        "Use status.nextActions, blockerDetails, deliveryProfile.publication, delegationPolicy, diagnosticPublication, requiredValidations, and resumeContext as the compact action envelope.",
        "Complete only one external action group and stop after its fresh structured workflow status.",
        "Preserve every required validation and keep API and UI work in one implementation context.",
    ].join("\n");
}
export function inspectBlockedDiagnosticPreflight(workingDirectory, configuredEnv) {
    const env = configuredEnv === undefined ? { ...process.env } : { ...configuredEnv };
    const sourceBranch = gitOutput(workingDirectory, ["branch", "--show-current"], env);
    if (sourceBranch === undefined || !sourceBranch.startsWith("codex/")) {
        return { eligible: false, reason: "non-codex-or-detached-source-branch" };
    }
    const worktreeStatus = gitOutput(workingDirectory, ["status", "--porcelain", "--untracked-files=normal"], env);
    if (worktreeStatus === undefined || worktreeStatus !== "") {
        return { eligible: false, reason: "working-tree-not-clean" };
    }
    const remoteName = "origin";
    const remoteUrl = gitOutput(workingDirectory, ["remote", "get-url", remoteName], env);
    const host = supportedReviewHost(remoteUrl, env);
    if (host === undefined)
        return { eligible: false, reason: "unsupported-remote" };
    if (!hasExistingPublisherCredential(host, env)) {
        return { eligible: false, reason: "publisher-credentials-unavailable" };
    }
    const remoteHead = gitOutput(workingDirectory, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`], env);
    const targetBranch = remoteHead?.startsWith(`${remoteName}/`)
        ? remoteHead.slice(remoteName.length + 1)
        : "main";
    if (sourceBranch === targetBranch) {
        return { eligible: false, reason: "source-equals-target" };
    }
    if (gitOutput(workingDirectory, ["rev-parse", "--verify", targetBranch], env) === undefined) {
        return { eligible: false, reason: "target-branch-unavailable" };
    }
    const ahead = gitOutput(workingDirectory, ["rev-list", "--count", `${targetBranch}..${sourceBranch}`], env);
    if (ahead === undefined || !/^\d+$/.test(ahead) || Number(ahead) < 1) {
        return { eligible: false, reason: "no-committed-delta" };
    }
    return { eligible: true, sourceBranch, targetBranch, remoteName };
}
export function validateSpecToPrRunInput(input) {
    if (input.workingDirectory.trim() === "") {
        throw new Error("workingDirectory is required");
    }
    const mode = resolveDeliveryMode(input);
    const composableSources = normalizeComposableSources(input);
    const figmaUrls = normalizedFigmaUrls(input);
    validateComposableSources(input);
    if (input.resumeThreadId === undefined) {
        const fullDelivery = mode === "brief" || mode === "feature";
        if (fullDelivery && (input.briefPath === undefined || input.briefPath.trim() === "")) {
            throw new Error(mode + " mode requires briefPath");
        }
        if (fullDelivery && figmaUrls.length === 0) {
            throw new Error(mode + " mode requires figmaUrl or figmaUrls");
        }
        if (fullDelivery &&
            composableSources.openApiPaths.length + composableSources.openApiUrls.length === 0) {
            throw new Error(mode + " mode requires at least one OpenAPI source");
        }
        if (mode === "legacy" &&
            (input.legacyProjectRoot === undefined || input.legacyProjectRoot.trim() === "")) {
            throw new Error("legacy mode requires legacyProjectRoot");
        }
        if (input.legacyNetworkEvidencePath !== undefined && mode !== "legacy") {
            throw new Error("legacyNetworkEvidencePath is only valid for legacy mode");
        }
        if (mode === "figma" && figmaUrls.length === 0) {
            throw new Error("figma mode requires figmaUrl or figmaUrls");
        }
        if ((mode === "legacy" || mode === "feature") &&
            (input.prompt === undefined || input.prompt.trim().length < 3)) {
            throw new Error(mode + " mode requires a concrete prompt describing the requested change");
        }
    }
    if (input.maxTurns !== undefined && (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0)) {
        throw new Error("maxTurns must be a positive integer");
    }
    if ((input.publication ?? "draft") === "draft" && input.maxTurns !== undefined && input.maxTurns < 2) {
        throw new Error("draft publication requires maxTurns to be at least 2");
    }
    if (input.blockedDiagnosticTokenReserve !== undefined &&
        (!Number.isInteger(input.blockedDiagnosticTokenReserve) ||
            input.blockedDiagnosticTokenReserve <= 0 ||
            input.blockedDiagnosticTokenReserve >= effectiveHardLimitForWorkload("XS"))) {
        throw new Error("blockedDiagnosticTokenReserve must be a positive integer below the smallest supported hard limit");
    }
    if (input.usageCalibration !== false) {
        const usageHistoryPath = resolveUsageHistoryPath(input);
        if (isWithinDirectory(resolveRepositoryRoot(input.workingDirectory), canonicalizeThroughExistingAncestor(usageHistoryPath))) {
            throw new Error("usageHistoryPath must stay outside the target repository");
        }
        if (isHardLinkedFile(usageHistoryPath)) {
            throw new Error("usageHistoryPath must not be a hard-linked file");
        }
    }
    if (input.legacyProjectRoot !== undefined && input.additionalDirectories !== undefined) {
        const legacyRoot = canonicalizeThroughExistingAncestor(input.legacyProjectRoot);
        const overlap = input.additionalDirectories.some((candidate) => {
            const absoluteCandidate = path.isAbsolute(candidate)
                ? candidate
                : path.resolve(input.workingDirectory, candidate);
            const writableRoot = canonicalizeThroughExistingAncestor(absoluteCandidate);
            return (isWithinDirectory(legacyRoot, writableRoot) || isWithinDirectory(writableRoot, legacyRoot));
        });
        if (overlap) {
            throw new Error("Writable additionalDirectories must not overlap the legacy project");
        }
    }
}
function resolveUsageHistoryPath(input) {
    const configured = input.usageHistoryPath ??
        path.join(os.homedir(), ".codex", "spec-to-pr", "usage-history.jsonl");
    return path.isAbsolute(configured)
        ? path.normalize(configured)
        : path.resolve(input.workingDirectory, configured);
}
function isWithinDirectory(directory, candidate) {
    const relative = path.relative(directory, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
function canonicalizeThroughExistingAncestor(candidate) {
    let current = path.resolve(candidate);
    const missingSegments = [];
    while (true) {
        try {
            return path.resolve(realpathSync.native(current), ...missingSegments);
        }
        catch (error) {
            if (!isMissingPath(error))
                throw error;
            const parent = path.dirname(current);
            if (parent === current)
                return path.resolve(candidate);
            missingSegments.unshift(path.basename(current));
            current = parent;
        }
    }
}
function resolveRepositoryRoot(workingDirectory) {
    let current = canonicalizeThroughExistingAncestor(workingDirectory);
    while (true) {
        if (existsSync(path.join(current, ".git")))
            return current;
        const parent = path.dirname(current);
        if (parent === current)
            return canonicalizeThroughExistingAncestor(workingDirectory);
        current = parent;
    }
}
function isMissingPath(error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isHardLinkedFile(candidate) {
    try {
        const metadata = statSync(candidate);
        return metadata.isFile() && metadata.nlink > 1;
    }
    catch (error) {
        if (isMissingPath(error))
            return false;
        throw error;
    }
}
function createBoundaryClient(codex, options) {
    return {
        startThread: () => adaptThread(codex.startThread(options)),
        resumeThread: (threadId) => adaptThread(codex.resumeThread(threadId, options)),
    };
}
function adaptThread(thread) {
    return {
        get id() {
            return thread.id;
        },
        run: async (prompt, options) => options?.outputSchema === undefined
            ? thread.run(prompt)
            : thread.run(prompt, { outputSchema: options.outputSchema }),
    };
}
function sdkUsage(usage) {
    if (usage.availability !== "complete")
        return null;
    return {
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
        reasoning_output_tokens: usage.reasoningOutputTokens,
    };
}
function gitOutput(workingDirectory, args, env) {
    try {
        return execFileSync("git", args, {
            cwd: workingDirectory,
            encoding: "utf8",
            env,
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 10_000,
        }).trim();
    }
    catch {
        return undefined;
    }
}
function supportedReviewHost(remoteUrl, env) {
    if (remoteUrl === undefined)
        return undefined;
    const hostname = remoteHost(remoteUrl);
    if (hostname === undefined)
        return undefined;
    const override = env["SPEC_TO_PR_GIT_HOST"]?.trim().toLowerCase();
    if (override === "github" || override === "gitlab")
        return { provider: override, hostname };
    if (hostname === "github.com")
        return { provider: "github", hostname };
    if (hostname === "gitlab.com")
        return { provider: "gitlab", hostname };
    return undefined;
}
function remoteHost(remoteUrl) {
    const trimmed = remoteUrl.trim();
    const scpHost = /^[^@]+@([^:]+):/.exec(trimmed)?.[1];
    if (scpHost !== undefined)
        return scpHost.toLowerCase();
    try {
        return new URL(trimmed).hostname.toLowerCase();
    }
    catch {
        return undefined;
    }
}
function hasExistingPublisherCredential(host, env) {
    const names = host.provider === "github"
        ? ["GITHUB_TOKEN", "GH_TOKEN"]
        : ["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"];
    if (names.some((name) => (env[name]?.trim().length ?? 0) > 0))
        return true;
    const credential = credentialCommand(host.provider, host.hostname);
    try {
        return isCredentialOutputAvailable(execFileSync(credential.command, credential.args, {
            encoding: "utf8",
            env,
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 10_000,
        }));
    }
    catch {
        return false;
    }
}
function credentialCommand(provider, hostname) {
    return provider === "github"
        ? { command: "gh", args: ["auth", "token", "--hostname", hostname] }
        : { command: "glab", args: ["config", "get", "token", "--host", hostname] };
}
function isCredentialOutputAvailable(output) {
    const normalized = output.trim();
    return normalized.length > 0 && !/^usage:/im.test(normalized) && !/^help:/im.test(normalized);
}
function requiredValidationsForInput(input) {
    const prompt = input.prompt ?? "";
    const mode = resolveDeliveryMode(input);
    const composableSources = normalizeComposableSources(input);
    const ui = isUiScope(input, prompt);
    const validations = new Set(["functional"]);
    if (ui)
        validations.add("accessibility");
    if (normalizedFigmaUrls(input).length > 0) {
        validations.add("visual");
        validations.add("figma-bundle");
        validations.add("visual-comparison");
    }
    if (mode === "legacy") {
        validations.add("visual");
        validations.add("legacy-baseline");
        validations.add("legacy-inventory");
        validations.add("visual-comparison");
    }
    if (mode === "brief" || mode === "legacy" || mode === "feature") {
        validations.add("api-coverage");
        validations.add("performance");
        validations.add("performance-evidence");
    }
    if (mode === "figma")
        validations.add("mock-data");
    if (mode === "feature") {
        validations.add("targeted-feature-e2e");
        validations.add("feature-video");
    }
    if (ui &&
        (composableSources.openApiPaths.length + composableSources.openApiUrls.length > 0 ||
            /\b(api|openapi|endpoint|schema|mock)\b/i.test(prompt))) {
        validations.add("api-ready");
    }
    if ((input.publication ?? "draft") === "draft") {
        validations.add("draft-publication-preflight");
    }
    return [...validations];
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
    const additionalDirectories = uniqueInputValues(input.additionalDirectories ?? []);
    if (additionalDirectories.length > 0)
        options.additionalDirectories = additionalDirectories;
    return options;
}
function formatSource(label, value) {
    return value === undefined || value.trim() === ""
        ? undefined
        : `- ${label}: ${JSON.stringify(value)}`;
}
const MAX_COMPOSABLE_SOURCE_PATHS = 20;
const MAX_SOURCE_PATH_LENGTH = 1_000;
const MAX_SKILL_HINT_LENGTH = 128;
const SKILL_HINT_PATTERN = /^[a-z0-9][a-z0-9._ -]*(?::[a-z0-9][a-z0-9._ -]*)?$/i;
function normalizeComposableSources(input) {
    return {
        docsPaths: uniqueInputValues([
            ...(input.docsPath === undefined ? [] : [input.docsPath]),
            ...(input.docsPaths ?? []),
        ]),
        openApiPaths: uniqueInputValues([
            ...(input.openApiPath === undefined ? [] : [input.openApiPath]),
            ...(input.openApiPaths ?? []),
        ]),
        openApiUrls: uniqueUrlValues([
            ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
            ...(input.openApiUrls ?? []),
        ]),
        guidancePaths: uniqueInputValues(input.guidancePaths ?? []),
        skillHints: uniqueInputValues(input.skillHints ?? []),
    };
}
function normalizedFigmaUrls(input) {
    return uniqueUrlValues([
        ...(input.figmaUrl === undefined ? [] : [input.figmaUrl]),
        ...(input.figmaUrls ?? []),
    ]);
}
function validateComposableSources(input) {
    const pathArrays = [
        ["docsPaths", input.docsPaths ?? []],
        ["openApiPaths", input.openApiPaths ?? []],
        ["guidancePaths", input.guidancePaths ?? []],
    ];
    for (const [field, values] of pathArrays) {
        if (values.length > MAX_COMPOSABLE_SOURCE_PATHS) {
            throw new Error(`${field} cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} paths`);
        }
        values.forEach((value) => validateSourcePath(value, field));
    }
    if (input.docsPath !== undefined)
        validateSourcePath(input.docsPath, "docsPath");
    if (input.openApiPath !== undefined)
        validateSourcePath(input.openApiPath, "openApiPath");
    if (input.briefPath !== undefined)
        validateSourcePath(input.briefPath, "briefPath");
    if (input.legacyNetworkEvidencePath !== undefined) {
        validateSourcePath(input.legacyNetworkEvidencePath, "legacyNetworkEvidencePath");
    }
    const openApiUrls = [
        ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
        ...(input.openApiUrls ?? []),
    ];
    if (openApiUrls.length > MAX_COMPOSABLE_SOURCE_PATHS) {
        throw new Error(`openApiUrls cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} URLs`);
    }
    openApiUrls.forEach((value) => validateSourceUrl(value, "openApiUrls"));
    const figmaUrls = [
        ...(input.figmaUrl === undefined ? [] : [input.figmaUrl]),
        ...(input.figmaUrls ?? []),
    ];
    if (figmaUrls.length > MAX_COMPOSABLE_SOURCE_PATHS) {
        throw new Error(`figmaUrls cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} URLs`);
    }
    figmaUrls.forEach((value) => validateSourceUrl(value, "figmaUrls"));
    const skillHints = input.skillHints ?? [];
    if (skillHints.length > MAX_COMPOSABLE_SOURCE_PATHS) {
        throw new Error(`skillHints cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} hints`);
    }
    skillHints.forEach((skillHint) => {
        const normalized = skillHint.trim();
        if (normalized.length === 0 ||
            normalized.length > MAX_SKILL_HINT_LENGTH ||
            !SKILL_HINT_PATTERN.test(normalized)) {
            throw new Error("skillHints must contain skill names, not filesystem paths");
        }
    });
    const normalized = normalizeComposableSources(input);
    for (const field of ["docsPaths", "openApiPaths"]) {
        if (normalized[field].length > MAX_COMPOSABLE_SOURCE_PATHS) {
            throw new Error(`${field} legacy and plural inputs cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} distinct paths`);
        }
    }
    if (normalized.openApiPaths.length + normalized.openApiUrls.length >
        MAX_COMPOSABLE_SOURCE_PATHS) {
        throw new Error(`OpenAPI paths and URLs cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} distinct sources`);
    }
    const roles = new Map();
    for (const [role, values] of [
        ["briefPath", input.briefPath === undefined ? [] : [input.briefPath]],
        [
            "legacyNetworkEvidencePath",
            input.legacyNetworkEvidencePath === undefined ? [] : [input.legacyNetworkEvidencePath],
        ],
        ["docsPaths", [input.docsPath, ...(input.docsPaths ?? [])].filter(isDefined)],
        ["openApiPaths", [input.openApiPath, ...(input.openApiPaths ?? [])].filter(isDefined)],
        ["guidancePaths", input.guidancePaths ?? []],
    ]) {
        for (const sourcePath of values) {
            const key = normalizedInputPathKey(sourcePath);
            const previous = roles.get(key);
            if (previous !== undefined && previous !== role) {
                throw new Error(`Source path conflicts with ${previous}: ${sourcePath}`);
            }
            roles.set(key, role);
        }
    }
}
function validateSourcePath(value, field) {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > MAX_SOURCE_PATH_LENGTH) {
        throw new Error(`${field} entries must be between 1 and ${MAX_SOURCE_PATH_LENGTH} characters`);
    }
}
function validateSourceUrl(value, field) {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 2_000) {
        throw new Error(`${field} entries must be between 1 and 2000 characters`);
    }
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        throw new Error(`${field} entries must be valid URLs`);
    }
    if (parsed.protocol !== "https:")
        throw new Error(`${field} entries must use HTTPS`);
    if (parsed.username !== "" || parsed.password !== "") {
        throw new Error(`${field} entries must not contain embedded credentials`);
    }
    for (const name of parsed.searchParams.keys()) {
        if (/token|secret|password|credential|api[_-]?key|authorization/i.test(name)) {
            throw new Error(`${field} entries must not contain secret-shaped query parameters`);
        }
    }
}
function uniqueInputValues(values) {
    const unique = new Map();
    values.forEach((value) => {
        const trimmed = value.trim();
        const key = normalizedInputPathKey(trimmed);
        if (!unique.has(key))
            unique.set(key, trimmed);
    });
    return [...unique.values()];
}
function uniqueUrlValues(values) {
    const unique = new Map();
    values.forEach((value) => {
        const trimmed = value.trim();
        let key = trimmed;
        try {
            key = new URL(trimmed).toString();
        }
        catch {
            // Validation reports malformed URLs after normalization.
        }
        if (!unique.has(key))
            unique.set(key, trimmed);
    });
    return [...unique.values()];
}
function normalizedInputPathKey(value) {
    return path.normalize(value.trim()).split(path.sep).join("/");
}
function isDefined(value) {
    return value !== undefined;
}
function isUiScope(input, prompt) {
    const mode = resolveDeliveryMode(input);
    if (mode === "brief" || mode === "legacy" || mode === "feature" || mode === "figma") {
        return true;
    }
    if (normalizedFigmaUrls(input).length > 0) {
        return true;
    }
    return /\b(ui|ux|frontend|front-end|screen|page|view|component|design|figma|responsive|visual)\b/i.test(prompt);
}
function resolveDeliveryMode(input) {
    if (input.deliveryMode !== undefined)
        return input.deliveryMode;
    if (input.legacyProjectRoot !== undefined && input.legacyProjectRoot.trim() !== "") {
        return "legacy";
    }
    if (input.briefPath !== undefined && input.briefPath.trim() !== "")
        return "brief";
    if (normalizedFigmaUrls(input).length > 0)
        return "figma";
    return "auto";
}
function defaultChangeKind(mode) {
    if (mode === "feature" || mode === "brief")
        return "feature";
    if (mode === "legacy")
        return "migration";
    if (mode === "figma")
        return "design";
    return "auto";
}
function modeInstructions(mode) {
    if (mode === "brief") {
        return "Brief mode is full delivery: require the supplied brief, Figma source, and local OpenAPI path or HTTPS openApiUrls source before workflow_start; preserve acceptance criteria; implement API and UI in one context; produce sourceProvenance, visualTargets, API gap, apiCoverage, compare-visuals, accessibility, Web Vitals/performance, and pr-report-v2.1 evidence; do not invent missing requirements.";
    }
    if (mode === "legacy") {
        return "Legacy mode is cross-project migration: require a separate legacyProjectRoot, treat it as read-only, inspect workflow_status.legacyInventory, map every in-scope stable feature key through legacyCoverage, derive API candidates from the explicitly listed bounded source adapters, run both projects, use the running legacy screen as the mandatory visual baseline, compare the target at the same route/state/viewport through compare-visuals, and report migration/API/performance gaps in pr-report-v2.1. Treat legacyProjectRoot and workflow_status.legacyInventory as the immutable feature boundary, not a dependency visibility boundary. Resolve every requested feature only against that inventory; if no feature key matches, report an in-bound scope mismatch. A sibling, parent, or keyword-similar module requires an explicit replacement legacyProjectRoot and is never inferred from repository-wide search. Inspect directly referenced dependency evidence outside that root only through explicit in-root import or configuration edges and only to resolve or run an in-bound feature; bounded examples are HTTP client or alias configuration, environment-name schemas/examples, package metadata/type declarations, and enclosing build/start metadata. Never scan dependency trees or build output broadly, read or persist secret values, or turn dependency evidence into unrelated feature keys, routes, screens, or API candidates. When source discovery leaves an ambiguous method or path, optionally supply a project-local legacyNetworkEvidencePath containing bounded HAR JSON or a request array captured from the scoped legacy flow. API candidates require complete api-ready/apiCoverage evidence; zero candidates require a complete API section bound to the adapter list and inventory digest. Ambiguous methods/paths resolve only from a unique scoped OpenAPI/runtime match and otherwise remain a durable intake blocker. Optional OpenAPI enriches candidates but never controls API-section applicability.";
    }
    if (mode === "feature") {
        return [
            "Feature mode: inherit the full brief/Figma/OpenAPI delivery contract including visualTargets, compare-visuals, apiCoverage, Web Vitals, and pr-report-v2.1, then run a single targeted feature E2E selected by test path, tag, or project and record exactly one .webm or .mp4.",
            "Never run the full-project E2E suite by default.",
            "Run one unchained Playwright command without --list or --pass-with-no-tests. Use a stable implementationContextId and write a strict JSON result containing only status=passed, the exact selector, that same implementationContextId, and a positive testCount. Record a structurally valid non-zero-duration WebM/MP4 container up to 25 MB.",
            "Submit featureEvidence with scope=targeted-feature, testSelector, testCommand, resultPath, and videoPath on implementation.",
        ].join(" ");
    }
    if (mode === "figma") {
        return "Figma mode: before the one durable workflow_start, resolve the canonical clean codex/* workspace from the requested target, pin its base/remote and every supplied Figma URL. Use the connected Figma capability to capture every URL's real nodes, logical geometry, export scale/bitmap, variables, screenshots, components, fonts, and assets. Then, before contracts, submit exactly one figma-bundle with provider=host-connected-figma, ISO capturedAt, complete fileUrls/nodeIds, capturedComponents, strict designMapping, manifestPath, actual PNG artifacts, and visualTargets. Map every component to a verifiable design-system export, digest-bound canonical asset, or explicit exception. Implement deterministic mock data using {deterministic:true, fixtures:[{id,path,sha256}]} and bind every target to a consumed named fixture. Capture at logical geometry only after fixtures/fonts/assets load and emit current-packet receipts. Runtime owns sRGB normalization and the 98% comparison. On a valid failure, modify and commit implementation, submit a fresh packet, and recapture through implementation-repair; acquisition errors consume no attempt and valid comparisons are capped at three. Publish pr-report-v2.1 only with the exact pinned workspace branches and remote; do not add real API, full performance, or feature-video work by default.";
    }
    return "Auto mode: keep evidence proportional to the classified change and do not activate mode-specific gates without explicit input.";
}
