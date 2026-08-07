import { accumulateUsage, decideBudgetAction, } from "./workload-budget.js";
import { parallelReviewersForWorkload } from "./generated/delivery-mode-policy.js";
export async function executeBudgetedBoundaryTurns(input) {
    if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) {
        throw new Error("maxTurns must be a positive integer");
    }
    if (input.blockedDiagnosticTokenReserve !== undefined &&
        (!Number.isInteger(input.blockedDiagnosticTokenReserve) ||
            input.blockedDiagnosticTokenReserve <= 0 ||
            input.blockedDiagnosticTokenReserve >= input.hardLimitTokens)) {
        throw new Error("blockedDiagnosticTokenReserve must be a positive integer below hardLimitTokens");
    }
    assertPositiveTimeout(input.turnTimeoutMs, "turnTimeoutMs");
    assertPositiveTimeout(input.runTimeoutMs, "runTimeoutMs");
    const now = input.now ?? performance.now.bind(performance);
    const startedAtMs = now();
    let activeRoute = { role: "fast", reasoningEffort: "medium" };
    let thread = input.resumeThreadId === undefined
        ? input.client.startThread(activeRoute)
        : input.client.resumeThread(input.resumeThreadId, activeRoute);
    let prompt = input.initialPrompt;
    let usage = null;
    let finalResponse = "";
    let workflowStatus = null;
    let state = "turn-limit";
    let outputFormatting = input.outputSchema === undefined ? "not-requested" : "not-terminal";
    let checkpointed = false;
    let checkpointCount = 0;
    let turnCount = 0;
    let activeWorkloadSize = input.workloadSize;
    let activeHardLimitTokens = input.hardLimitTokens;
    let activeRequiredValidations = [...input.requiredValidations];
    let hasAuthoritativeValidations = false;
    let pinnedRunId = null;
    let blockedFinalizationAttempted = false;
    let blockedDiagnosticPreflightIneligible = false;
    let blockedDiagnosticReserveLatched = false;
    let blockedDiagnosticReserveExhausted = false;
    const items = [];
    const actionTurns = [];
    let formatTurn;
    while (turnCount < input.maxTurns) {
        const result = await executeBoundaryTurnWithTimeout({
            thread,
            prompt,
            turn: turnCount + 1,
            kind: "action",
            ...(input.turnTimeoutMs === undefined ? {} : { turnTimeoutMs: input.turnTimeoutMs }),
            ...(input.runTimeoutMs === undefined ? {} : { runTimeoutMs: input.runTimeoutMs }),
            startedAtMs,
            now,
        });
        actionTurns.push(result.timing);
        if (result.kind === "timeout") {
            state = result.timeout === "run-timeout" ? "run-timeout" : "turn-timeout";
            finalResponse = timeoutFinalResponse({
                timeout: result.timeout,
                threadId: thread.id,
                timeoutMs: result.timeoutMs,
            });
            break;
        }
        const turn = result.turn;
        turnCount += 1;
        finalResponse = turn.finalResponse;
        items.push(...turn.items);
        usage = accumulateUsage(usage, turn.usage);
        const currentStatus = extractWorkflowStatus(turn.items);
        if (currentStatus === null) {
            state = "status-unavailable";
            break;
        }
        if (pinnedRunId !== null && currentStatus.runId !== pinnedRunId) {
            state = "run-mismatch";
            break;
        }
        pinnedRunId ??= currentStatus.runId;
        workflowStatus = currentStatus;
        blockedDiagnosticReserveLatched ||=
            input.blockedDiagnosticTokenReserve !== undefined &&
                currentStatus.deliveryProfile.publication === "draft";
        const configuredHardLimit = input.workloadHardLimits?.[currentStatus.workload.size];
        if (configuredHardLimit !== undefined) {
            activeHardLimitTokens = configuredHardLimit;
        }
        else if (currentStatus.workload.size !== activeWorkloadSize) {
            activeHardLimitTokens = currentStatus.workload.budget.hardLimitTokens;
        }
        activeWorkloadSize = currentStatus.workload.size;
        activeRequiredValidations = hasAuthoritativeValidations
            ? unionStrings(activeRequiredValidations, currentStatus.requiredValidations)
            : [...currentStatus.requiredValidations];
        hasAuthoritativeValidations = true;
        if (workflowStatus.status === "completed") {
            state = "completed";
            break;
        }
        if (workflowStatus.status === "blocked") {
            state = "blocked";
            const blockedDiagnosticReserveRemaining = !blockedDiagnosticReserveLatched ||
                usage.totalTokens <= activeHardLimitTokens - (input.blockedDiagnosticTokenReserve ?? 0);
            blockedDiagnosticReserveExhausted =
                blockedDiagnosticReserveLatched && !blockedDiagnosticReserveRemaining;
            if (!blockedFinalizationAttempted &&
                canAttemptBlockedDiagnosticFinalization(workflowStatus) &&
                usage.availability === "complete" &&
                usage.totalTokens < activeHardLimitTokens &&
                blockedDiagnosticReserveRemaining &&
                turnCount < input.maxTurns) {
                const preflight = await inspectBlockedDiagnosticPreflight(input.inspectBlockedDiagnosticPreflight);
                if (preflight.eligible) {
                    blockedFinalizationAttempted = true;
                    prompt = buildBlockedDiagnosticFinalizationPrompt(workflowStatus, preflight);
                    continue;
                }
                blockedDiagnosticPreflightIneligible = true;
            }
            break;
        }
        if (turn.usage === null) {
            state = "usage-unavailable";
            break;
        }
        const normalTurnLimit = blockedDiagnosticReserveLatched ? input.maxTurns - 1 : input.maxTurns;
        const normalTokenLimit = blockedDiagnosticReserveLatched
            ? activeHardLimitTokens - (input.blockedDiagnosticTokenReserve ?? 0)
            : activeHardLimitTokens;
        const canAdmitAnotherNormalTurn = !blockedDiagnosticReserveLatched ||
            usage.totalTokens + turn.usage.input_tokens + turn.usage.output_tokens < normalTokenLimit;
        const decision = decideBudgetAction({
            usedTokens: usage.totalTokens,
            hardLimitTokens: normalTokenLimit,
            checkpointed,
            workloadSize: activeWorkloadSize,
            requiredValidations: activeRequiredValidations,
        });
        if (decision.action === "split-required") {
            state = decision.action;
            break;
        }
        if (decision.action === "checkpoint") {
            if (turnCount >= normalTurnLimit || !canAdmitAnotherNormalTurn) {
                state = "turn-limit";
                break;
            }
            checkpointed = true;
            checkpointCount += 1;
            activeRoute = routeForWorkflowStatus(workflowStatus);
            thread = input.client.startThread(activeRoute);
            prompt = buildCompactCheckpointPrompt(workflowStatus, activeRequiredValidations, {
                usedTokens: usage.totalTokens,
                hardLimitTokens: normalTokenLimit,
            });
            continue;
        }
        if (turnCount >= normalTurnLimit || !canAdmitAnotherNormalTurn) {
            state = "turn-limit";
            break;
        }
        const nextRoute = routeForWorkflowStatus(workflowStatus);
        if ((nextRoute.reasoningEffort !== activeRoute.reasoningEffort ||
            nextRoute.role !== activeRoute.role) &&
            thread.id !== null) {
            thread = input.client.resumeThread(thread.id, nextRoute);
            activeRoute = nextRoute;
        }
        prompt = buildBoundaryContinuationPrompt(workflowStatus, activeRequiredValidations, {
            usedTokens: usage.totalTokens,
            hardLimitTokens: normalTokenLimit,
        });
    }
    if (input.outputSchema !== undefined && (state === "completed" || state === "blocked")) {
        if (blockedDiagnosticPreflightIneligible || blockedDiagnosticReserveExhausted) {
            outputFormatting = "budget-skipped";
        }
        else if (usage?.availability !== "complete") {
            outputFormatting = "usage-unavailable";
        }
        else if (usage.totalTokens >= activeHardLimitTokens || turnCount >= input.maxTurns) {
            outputFormatting = "budget-skipped";
        }
        else {
            try {
                if ((activeRoute.reasoningEffort !== "medium" || activeRoute.role !== "fast") &&
                    thread.id !== null) {
                    activeRoute = { role: "fast", reasoningEffort: "medium" };
                    thread = input.client.resumeThread(thread.id, activeRoute);
                }
                const formattedResult = await executeBoundaryTurnWithTimeout({
                    thread,
                    prompt: buildFinalResponsePrompt(workflowStatus),
                    turn: turnCount + 1,
                    kind: "format",
                    outputSchema: input.outputSchema,
                    ...(input.turnTimeoutMs === undefined ? {} : { turnTimeoutMs: input.turnTimeoutMs }),
                    ...(input.runTimeoutMs === undefined ? {} : { runTimeoutMs: input.runTimeoutMs }),
                    startedAtMs,
                    now,
                });
                formatTurn = formattedResult.timing;
                if (formattedResult.kind === "timeout") {
                    state = formattedResult.timeout;
                    outputFormatting = "failed";
                    finalResponse = timeoutFinalResponse({
                        timeout: formattedResult.timeout,
                        threadId: thread.id,
                        timeoutMs: formattedResult.timeoutMs,
                    });
                    return boundaryRunResult({
                        thread,
                        finalResponse,
                        items,
                        usage,
                        state,
                        outputFormatting,
                        turnCount,
                        checkpointCount,
                        workflowStatus,
                        requiredValidations: activeRequiredValidations,
                        workloadSize: activeWorkloadSize,
                        hardLimitTokens: activeHardLimitTokens,
                        startedAtMs,
                        now,
                        actionTurns,
                        ...(formatTurn === undefined ? {} : { formatTurn }),
                    });
                }
                const formatted = formattedResult.turn;
                turnCount += 1;
                finalResponse = formatted.finalResponse;
                items.push(...formatted.items);
                usage = accumulateUsage(usage, formatted.usage);
                outputFormatting = "applied";
            }
            catch {
                usage = accumulateUsage(usage, null);
                outputFormatting = "failed";
            }
        }
    }
    return boundaryRunResult({
        thread,
        finalResponse,
        items,
        usage,
        state,
        outputFormatting,
        turnCount,
        checkpointCount,
        workflowStatus,
        requiredValidations: activeRequiredValidations,
        workloadSize: activeWorkloadSize,
        hardLimitTokens: activeHardLimitTokens,
        startedAtMs,
        now,
        actionTurns,
        ...(formatTurn === undefined ? {} : { formatTurn }),
    });
}
async function executeBoundaryTurnWithTimeout(input) {
    const startedAtMs = input.now();
    const remainingRunMs = input.runTimeoutMs === undefined
        ? Number.POSITIVE_INFINITY
        : input.runTimeoutMs - (startedAtMs - input.startedAtMs);
    if (remainingRunMs <= 0) {
        return {
            kind: "timeout",
            timeout: "run-timeout",
            timeoutMs: input.runTimeoutMs,
            timing: {
                turn: input.turn,
                kind: input.kind,
                elapsedMs: 0,
                outcome: "run-timeout",
            },
        };
    }
    const timeoutMs = Math.min(input.turnTimeoutMs ?? Number.POSITIVE_INFINITY, remainingRunMs);
    const timeout = timeoutMs === Number.POSITIVE_INFINITY
        ? undefined
        : input.turnTimeoutMs !== undefined && input.turnTimeoutMs <= remainingRunMs
            ? "turn-timeout"
            : "run-timeout";
    const controller = new AbortController();
    let timer;
    const timeoutPromise = timeout === undefined
        ? undefined
        : new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new BoundaryTurnTimeoutError(timeout, timeoutMs);
                controller.abort(error);
                reject(error);
            }, timeoutMs);
        });
    try {
        const runOptions = {
            ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
            ...(timeout === undefined ? {} : { signal: controller.signal }),
        };
        const invocation = input.thread.run(input.prompt, Object.keys(runOptions).length === 0 ? undefined : runOptions);
        const turn = timeoutPromise === undefined
            ? await invocation
            : await Promise.race([invocation, timeoutPromise]);
        return {
            kind: "completed",
            turn,
            timing: {
                turn: input.turn,
                kind: input.kind,
                elapsedMs: Math.max(0, input.now() - startedAtMs),
                outcome: "completed",
            },
        };
    }
    catch (error) {
        if (error instanceof BoundaryTurnTimeoutError) {
            return {
                kind: "timeout",
                timeout: error.timeout,
                timeoutMs: error.timeoutMs,
                timing: {
                    turn: input.turn,
                    kind: input.kind,
                    elapsedMs: Math.max(0, input.now() - startedAtMs),
                    outcome: error.timeout,
                },
            };
        }
        throw error;
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
class BoundaryTurnTimeoutError extends Error {
    timeout;
    timeoutMs;
    constructor(timeout, timeoutMs) {
        super(`${timeout} after ${timeoutMs}ms`);
        this.timeout = timeout;
        this.timeoutMs = timeoutMs;
        this.name = "BoundaryTurnTimeoutError";
    }
}
function assertPositiveTimeout(timeoutMs, name) {
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
        throw new Error(`${name} must be a positive integer`);
    }
}
function routeForWorkflowStatus(status) {
    const expertStages = new Set(["functional-review", "design-review"]);
    const expertActions = new Set(["review-functional", "review-design"]);
    // Keep the established boundary behavior: a route changes only when the
    // durable stage and its matching external action both authorize the work.
    // A free-form status label such as "implement" is not a stage transition.
    const buildStages = new Set(["implementation"]);
    const buildActions = new Set([
        "prepare-contracts",
        "implement",
        "implementation-repair",
        "compare-visuals",
    ]);
    const actionKinds = status.nextActions.flatMap((action) => typeof action === "object" &&
        action !== null &&
        "kind" in action &&
        typeof action.kind === "string"
        ? [action.kind]
        : []);
    const hasExpertAction = actionKinds.some((kind) => expertActions.has(kind));
    const hasBuildAction = actionKinds.some((kind) => buildActions.has(kind));
    if (status.currentStage !== undefined &&
        expertStages.has(status.currentStage) &&
        hasExpertAction) {
        return { role: "expert", reasoningEffort: "high" };
    }
    if (status.currentStage !== undefined && buildStages.has(status.currentStage) && hasBuildAction) {
        return { role: "build", reasoningEffort: "high" };
    }
    return { role: "fast", reasoningEffort: "medium" };
}
function timeoutFinalResponse(input) {
    const reason = input.timeout === "turn-timeout"
        ? `a single Codex turn exceeded its ${input.timeoutMs}ms deadline`
        : `the total Run deadline of ${input.timeoutMs}ms was exhausted`;
    return [
        `The spec-to-pr runner stopped waiting because ${reason}.`,
        "No validation was waived and no terminal verdict was inferred.",
        input.threadId === null
            ? "Resume this Codex task to inspect the durable workflow status before continuing."
            : `The existing thread ${input.threadId} can be resumed after the blocked dependency is addressed.`,
    ].join(" ");
}
function boundaryRunResult(input) {
    return {
        threadId: input.thread.id,
        finalResponse: input.finalResponse,
        items: input.items,
        usage: input.usage ?? accumulateUsage(null, null),
        state: input.state,
        outputFormatting: input.outputFormatting,
        turnCount: input.turnCount,
        checkpointCount: input.checkpointCount,
        workflowStatus: input.workflowStatus,
        requiredValidations: input.requiredValidations,
        workloadSize: input.workloadSize,
        hardLimitTokens: input.hardLimitTokens,
        timing: {
            elapsedMs: Math.max(0, input.now() - input.startedAtMs),
            actionTurns: input.actionTurns,
            ...(input.formatTurn === undefined ? {} : { formatTurn: input.formatTurn }),
        },
    };
}
export function extractWorkflowStatus(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.type !== "mcp_tool_call" || item.result === undefined)
            continue;
        const parsed = parseWorkflowStatus(item.result.structured_content);
        if (parsed !== null)
            return parsed;
    }
    return null;
}
export function buildCompactCheckpointPrompt(status, requiredValidations, effectiveBudget) {
    return [
        "Resume the installed spec-to-pr workflow from this compact context checkpoint.",
        `Call workflow_status with ${JSON.stringify({ runId: status.runId, view: "checkpoint" })} first; durable workflow state and project files are authoritative.`,
        "Complete only the next external action group, then stop after the returned workflow status. Independent functional and design reviews in the same action group may run in parallel.",
        "Do not waive, skip, or reduce required validation because of token pressure. Keep API and UI implementation in one context.",
        `Checkpoint: ${JSON.stringify(compactStatus(status, requiredValidations, effectiveBudget))}`,
    ].join("\n");
}
export function buildBoundaryContinuationPrompt(status, requiredValidations, effectiveBudget) {
    const immutableDetail = requiresImmutableDetail(status);
    const statusView = immutableDetail ? "detail" : "action";
    return [
        `Continue spec-to-pr Run ${status.runId}.`,
        `Call workflow_status with ${JSON.stringify({ runId: status.runId, view: statusView })} first, complete only the next external action group, and stop after its returned status. Independent functional and design reviews in the same group may run in parallel.`,
        "When compare-visuals and review-functional are both exposed, start capture and functional review concurrently; keep each reviewer read-only and submit its verdict through the orchestrator after the capture result is available.",
        ...(immutableDetail
            ? [
                "Use that detail snapshot as the immutable reviewer evidence or report evidence, including accepted contracts, diff, and evidence handles.",
            ]
            : []),
        "Preserve every required validation; budget pressure never authorizes a waiver.",
        `Boundary: ${JSON.stringify(compactStatus(status, requiredValidations, effectiveBudget))}`,
    ].join("\n");
}
export function buildFinalResponsePrompt(status) {
    return [
        `Format the final result for terminal spec-to-pr Run ${status.runId}.`,
        "Do not perform another workflow action or modify files. Use the durable status and evidence already produced in this thread.",
        `Terminal status: ${JSON.stringify(compactStatus(status, status.requiredValidations))}`,
    ].join("\n");
}
export function buildBlockedDiagnosticFinalizationPrompt(status, preflight) {
    const blocker = status.blockerDetails.find((item) => !item.retryable);
    return [
        `Finalize blocked diagnostic evidence for spec-to-pr Run ${status.runId}; do not retry implementation or the blocked validation.`,
        "This is the only diagnostic-publication turn. First verify that a committed delta, a clean branch, a supported remote (GitHub/GitLab), and existing non-interactive credentials already exist.",
        preflight === undefined
            ? 'Only when every precondition is already true, call workflow_publish once with intent: "blocked-diagnostic", mode: "execute", confirm: true, and the actual non-target sourceBranch and targetBranch.'
            : `The SDK preflight already passed. Call workflow_publish once with intent: "blocked-diagnostic", mode: "execute", confirm: true, sourceBranch: ${JSON.stringify(preflight.sourceBranch)}, targetBranch: ${JSON.stringify(preflight.targetBranch)}, and remoteName: ${JSON.stringify(preflight.remoteName)}.`,
        "If any precondition is absent, do not create commits, branches, credentials, issues, or another recovery loop; preserve the local diagnostic report.",
        `Call workflow_status once with ${JSON.stringify({ runId: status.runId, view: "action" })} after the publish attempt or local-only decision, then stop even when the Run remains blocked.`,
        `Blocked action envelope: ${JSON.stringify({
            runId: status.runId,
            publication: status.deliveryProfile.publication,
            blocker,
            diagnosticPublication: status.diagnosticPublication ?? null,
        })}`,
    ].join("\n");
}
async function inspectBlockedDiagnosticPreflight(inspect) {
    if (inspect === undefined) {
        return { eligible: false, reason: "preflight-inspector-unavailable" };
    }
    try {
        return await inspect();
    }
    catch {
        return { eligible: false, reason: "preflight-inspection-failed" };
    }
}
function compactStatus(status, requiredValidations, effectiveBudget) {
    return {
        runId: status.runId,
        revision: status.revision,
        status: status.status,
        ...(status.currentStage === undefined ? {} : { currentStage: status.currentStage }),
        stages: status.stages,
        workload: status.workload,
        actionEnvelope: {
            nextActions: status.nextActions,
            blockers: status.blockers,
            blockerDetails: status.blockerDetails,
            publication: status.deliveryProfile.publication,
            recommendedSkills: status.deliveryProfile.recommendedSkills,
            delegationPolicy: status.delegationPolicy,
            diagnosticPublication: status.diagnosticPublication ?? null,
            ...(status.resumeContext === undefined ? {} : { resumeContext: status.resumeContext }),
            requiredValidations: [...requiredValidations],
        },
        ...(effectiveBudget === undefined
            ? {}
            : {
                effectiveBudget: {
                    usedTokens: effectiveBudget.usedTokens,
                    remainingTokens: Math.max(0, effectiveBudget.hardLimitTokens - effectiveBudget.usedTokens),
                    checkpointAtTokens: Math.floor(effectiveBudget.hardLimitTokens * 0.8),
                    hardLimitTokens: effectiveBudget.hardLimitTokens,
                },
            }),
    };
}
function requiresImmutableDetail(status) {
    if (status.currentStage === "report")
        return true;
    return status.nextActions.some((action) => {
        if (typeof action !== "object" || action === null || Array.isArray(action))
            return false;
        const kind = action["kind"];
        return kind === "review-functional" || kind === "review-design";
    });
}
function canAttemptBlockedDiagnosticFinalization(status) {
    if (status.deliveryProfile.publication !== "draft" ||
        status.diagnosticPublication !== undefined) {
        return false;
    }
    const blocker = status.blockerDetails.find((item) => !item.retryable);
    return blocker !== undefined && blocker.kind !== "publish-precondition";
}
function unionStrings(left, right) {
    return [...new Set([...left, ...right])];
}
function parseWorkflowStatus(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const nested = parseWorkflowStatusCandidate(record["status"]);
    if (nested !== null)
        return nested;
    return parseWorkflowStatusCandidate(value);
}
function parseWorkflowStatusCandidate(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const runId = record["runId"];
    const revision = record["revision"];
    const status = record["status"];
    const view = record["view"] ?? "action";
    const allowedStatuses = new Set([
        "running",
        "needs-external-action",
        "blocked",
        "publish-ready",
        "completed",
    ]);
    if (typeof runId !== "string" ||
        typeof revision !== "number" ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        typeof status !== "string" ||
        !allowedStatuses.has(status) ||
        (view !== "action" && view !== "checkpoint" && view !== "detail")) {
        return null;
    }
    if (!Array.isArray(record["stages"]) ||
        !Array.isArray(record["nextActions"]) ||
        !isStringArray(record["blockers"]) ||
        !isStringArray(record["requiredValidations"])) {
        return null;
    }
    const currentStage = record["currentStage"];
    if (currentStage !== undefined && typeof currentStage !== "string")
        return null;
    const workload = parseWorkload(record["workload"]);
    const resumeContext = parseResumeContext(record["resumeContext"]);
    if (workload === null ||
        resumeContext === null ||
        (view !== "action" && resumeContext === undefined)) {
        return null;
    }
    const deliveryProfile = parseDeliveryProfile(record["deliveryProfile"]);
    const delegationPolicy = parseDelegationPolicy(record["delegationPolicy"], workload.size);
    const blockerDetails = parseBlockerDetails(record["blockerDetails"]);
    const diagnosticPublication = parseDiagnosticPublication(record["diagnosticPublication"]);
    if (deliveryProfile === null ||
        delegationPolicy === null ||
        blockerDetails === null ||
        diagnosticPublication === null) {
        return null;
    }
    return {
        view,
        runId,
        revision,
        status: status,
        ...(currentStage === undefined ? {} : { currentStage }),
        stages: record["stages"],
        nextActions: record["nextActions"],
        blockers: record["blockers"],
        blockerDetails,
        deliveryProfile,
        delegationPolicy,
        ...(diagnosticPublication === undefined ? {} : { diagnosticPublication }),
        ...(resumeContext === undefined ? {} : { resumeContext }),
        requiredValidations: record["requiredValidations"],
        workload,
    };
}
function parseDeliveryProfile(value) {
    if (value === undefined)
        return { publication: "none", recommendedSkills: [] };
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const publication = record["publication"];
    const recommendedSkills = record["recommendedSkills"] ?? [];
    if ((publication !== "draft" && publication !== "none") || !isStringArray(recommendedSkills)) {
        return null;
    }
    return { publication, recommendedSkills };
}
function parseDelegationPolicy(value, workloadSize) {
    if (value === undefined) {
        return {
            singleWriter: true,
            allowNested: false,
            maxReadOnlyScouts: workloadSize === "M" ? 1 : workloadSize === "L" || workloadSize === "XL" ? 2 : 0,
            parallelReviewers: parallelReviewersForWorkload(workloadSize),
        };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const maxReadOnlyScouts = record["maxReadOnlyScouts"];
    if (record["singleWriter"] !== true ||
        record["allowNested"] !== false ||
        (maxReadOnlyScouts !== 0 && maxReadOnlyScouts !== 1 && maxReadOnlyScouts !== 2) ||
        typeof record["parallelReviewers"] !== "boolean") {
        return null;
    }
    return {
        singleWriter: true,
        allowNested: false,
        maxReadOnlyScouts,
        parallelReviewers: record["parallelReviewers"],
    };
}
function parseBlockerDetails(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        return null;
    const parsed = value.map(parseBlocker);
    return parsed.every((item) => item !== null) ? parsed : null;
}
function parseBlocker(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const kind = record["kind"];
    if (typeof record["stage"] !== "string" ||
        typeof record["code"] !== "string" ||
        typeof kind !== "string" ||
        ![
            "missing-input",
            "missing-tool",
            "policy",
            "verification",
            "publish-precondition",
            "budget-split",
            "unexpected",
        ].includes(kind) ||
        typeof record["summary"] !== "string" ||
        typeof record["retryable"] !== "boolean" ||
        typeof record["resumable"] !== "boolean" ||
        !isStringArray(record["completedWork"]) ||
        !isStringArray(record["evidencePaths"]) ||
        !isStringArray(record["attemptedRecovery"]) ||
        !isStringArray(record["unrunValidations"]) ||
        typeof record["exactUnblockAction"] !== "string") {
        return null;
    }
    return {
        stage: record["stage"],
        code: record["code"],
        kind: kind,
        summary: record["summary"],
        retryable: record["retryable"],
        resumable: record["resumable"],
        completedWork: record["completedWork"],
        evidencePaths: record["evidencePaths"],
        attemptedRecovery: record["attemptedRecovery"],
        unrunValidations: record["unrunValidations"],
        exactUnblockAction: record["exactUnblockAction"],
    };
}
function parseDiagnosticPublication(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    if ((record["host"] !== "github" && record["host"] !== "gitlab") ||
        typeof record["url"] !== "string" ||
        typeof record["number"] !== "string" ||
        typeof record["created"] !== "boolean" ||
        typeof record["updated"] !== "boolean" ||
        typeof record["publishResultArtifactId"] !== "string") {
        return null;
    }
    return {
        host: record["host"],
        url: record["url"],
        number: record["number"],
        created: record["created"],
        updated: record["updated"],
        publishResultArtifactId: record["publishResultArtifactId"],
    };
}
function parseResumeContext(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const goal = record["goal"];
    const evidencePaths = record["evidencePaths"];
    const submissions = record["submissions"];
    if (typeof goal !== "string" || !isStringArray(evidencePaths) || !Array.isArray(submissions)) {
        return null;
    }
    const parsedSubmissions = submissions.flatMap((submission) => {
        if (typeof submission !== "object" || submission === null || Array.isArray(submission)) {
            return [];
        }
        const candidate = submission;
        return typeof candidate["kind"] === "string" &&
            typeof candidate["summary"] === "string" &&
            typeof candidate["outcome"] === "string"
            ? [
                {
                    kind: candidate["kind"],
                    summary: candidate["summary"],
                    outcome: candidate["outcome"],
                },
            ]
            : [];
    });
    if (parsedSubmissions.length !== submissions.length)
        return null;
    return { goal, evidencePaths, submissions: parsedSubmissions };
}
function parseWorkload(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const size = record["size"];
    const confidence = record["confidence"];
    const source = record["source"];
    const tokenRange = record["tokenRange"];
    const budget = record["budget"];
    if (typeof size !== "string" ||
        !["XS", "S", "M", "L", "XL"].includes(size) ||
        typeof confidence !== "string" ||
        !["low", "medium", "high"].includes(confidence) ||
        typeof source !== "string" ||
        !["intake", "contracts", "calibrated"].includes(source) ||
        !isTokenRange(tokenRange) ||
        !isBudget(budget)) {
        return null;
    }
    return {
        size: size,
        confidence: confidence,
        source: source,
        tokenRange,
        budget,
    };
}
function isTokenRange(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof value["min"] === "number" &&
        typeof value["max"] === "number");
}
function isBudget(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const record = value;
    return (record["checkpointPercent"] === 80 &&
        typeof record["checkpointAtTokens"] === "number" &&
        typeof record["hardLimitTokens"] === "number");
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
