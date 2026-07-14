import { accumulateUsage, decideBudgetAction, } from "./workload-budget.js";
export async function executeBudgetedBoundaryTurns(input) {
    if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) {
        throw new Error("maxTurns must be a positive integer");
    }
    let thread = input.resumeThreadId === undefined
        ? input.client.startThread()
        : input.client.resumeThread(input.resumeThreadId);
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
    const items = [];
    for (let index = 0; index < input.maxTurns; index += 1) {
        const turn = await thread.run(prompt);
        turnCount += 1;
        finalResponse = turn.finalResponse;
        items.push(...turn.items);
        usage = accumulateUsage(usage, turn.usage);
        const currentStatus = extractWorkflowStatus(turn.items);
        if (currentStatus === null) {
            state = "status-unavailable";
            break;
        }
        workflowStatus = currentStatus;
        if (input.budgetLocked === false) {
            activeHardLimitTokens =
                input.workloadHardLimits?.[currentStatus.workload.size] ??
                    currentStatus.workload.budget.hardLimitTokens;
        }
        activeWorkloadSize = currentStatus.workload.size;
        activeRequiredValidations = [...currentStatus.requiredValidations];
        if (workflowStatus.status === "completed") {
            state = "completed";
            break;
        }
        if (workflowStatus.status === "blocked") {
            state = "blocked";
            break;
        }
        if (turn.usage === null) {
            state = "usage-unavailable";
            break;
        }
        const decision = decideBudgetAction({
            usedTokens: usage.totalTokens,
            hardLimitTokens: activeHardLimitTokens,
            checkpointed,
            workloadSize: activeWorkloadSize,
            requiredValidations: activeRequiredValidations,
        });
        if (decision.action === "approval-required" || decision.action === "split-required") {
            state = decision.action;
            break;
        }
        if (decision.action === "checkpoint") {
            if (index + 1 >= input.maxTurns) {
                state = "turn-limit";
                break;
            }
            checkpointed = true;
            checkpointCount += 1;
            thread = input.client.startThread();
            prompt = buildCompactCheckpointPrompt(workflowStatus, activeRequiredValidations);
            continue;
        }
        prompt = buildBoundaryContinuationPrompt(workflowStatus, activeRequiredValidations);
    }
    if (input.outputSchema !== undefined && (state === "completed" || state === "blocked")) {
        if (usage?.availability !== "complete") {
            outputFormatting = "usage-unavailable";
        }
        else if (usage.totalTokens >= activeHardLimitTokens) {
            outputFormatting = "budget-skipped";
        }
        else {
            try {
                const formatted = await thread.run(buildFinalResponsePrompt(workflowStatus), {
                    outputSchema: input.outputSchema,
                });
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
    return {
        threadId: thread.id,
        finalResponse,
        items,
        usage: usage ?? accumulateUsage(null, null),
        state,
        outputFormatting,
        turnCount,
        checkpointCount,
        workflowStatus,
        requiredValidations: activeRequiredValidations,
        workloadSize: activeWorkloadSize,
        hardLimitTokens: activeHardLimitTokens,
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
export function buildCompactCheckpointPrompt(status, requiredValidations) {
    return [
        "Resume the installed spec-to-pr workflow from this compact context checkpoint.",
        "Call workflow_status with the recorded runId first; durable workflow state and project files are authoritative.",
        "Complete only the next external action group, then stop after the returned workflow status. Independent functional and design reviews in the same action group may run in parallel.",
        "Do not waive, skip, or reduce required validation because of token pressure. Keep API and UI implementation in one context.",
        `Checkpoint: ${JSON.stringify(compactStatus(status, requiredValidations))}`,
    ].join("\n");
}
export function buildBoundaryContinuationPrompt(status, requiredValidations) {
    return [
        `Continue spec-to-pr Run ${status.runId}.`,
        "Call workflow_status first, complete only the next external action group, and stop after its returned status. Independent functional and design reviews in the same group may run in parallel.",
        "Preserve every required validation; budget pressure never authorizes a waiver.",
        `Boundary: ${JSON.stringify(compactStatus(status, requiredValidations))}`,
    ].join("\n");
}
export function buildFinalResponsePrompt(status) {
    return [
        `Format the final result for terminal spec-to-pr Run ${status.runId}.`,
        "Do not perform another workflow action or modify files. Use the durable status and evidence already produced in this thread.",
        `Terminal status: ${JSON.stringify(compactStatus(status, status.requiredValidations))}`,
    ].join("\n");
}
function compactStatus(status, requiredValidations) {
    return {
        runId: status.runId,
        status: status.status,
        ...(status.currentStage === undefined ? {} : { currentStage: status.currentStage }),
        stages: status.stages,
        nextActions: status.nextActions,
        blockers: status.blockers,
        resumeContext: status.resumeContext,
        workload: status.workload,
        requiredValidations: [...requiredValidations],
    };
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
    const status = record["status"];
    const allowedStatuses = new Set([
        "running",
        "needs-external-action",
        "blocked",
        "publish-ready",
        "completed",
    ]);
    if (typeof runId !== "string" || typeof status !== "string" || !allowedStatuses.has(status)) {
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
    if (workload === null || resumeContext === null)
        return null;
    return {
        runId,
        status: status,
        ...(currentStage === undefined ? {} : { currentStage }),
        stages: record["stages"],
        nextActions: record["nextActions"],
        blockers: record["blockers"],
        resumeContext,
        requiredValidations: record["requiredValidations"],
        workload,
    };
}
function parseResumeContext(value) {
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
