#!/usr/bin/env node
import process from "node:process";
import { runSpecToPrWithCodex } from "./spec-to-pr-runner.js";
const args = parseArgs(process.argv.slice(2));
if (args.cwd === undefined) {
    printUsage();
    process.exit(2);
}
const input = {
    workingDirectory: args.cwd,
};
if (args.prompt !== undefined) {
    input.prompt = args.prompt;
}
if (args.legacyProject !== undefined) {
    input.legacyProjectRoot = args.legacyProject;
}
if (args.legacyNetwork !== undefined) {
    input.legacyNetworkEvidencePath = args.legacyNetwork;
}
if (args.brief !== undefined) {
    input.briefPath = args.brief;
}
if (args.docs.length > 0) {
    input.docsPaths = args.docs;
}
if (args.figma.length > 0) {
    input.figmaUrls = args.figma;
}
if (args.openapi.length > 0) {
    input.openApiPaths = args.openapi;
}
if (args.openapiUrls.length > 0) {
    input.openApiUrls = args.openapiUrls;
}
if (args.guidance.length > 0) {
    input.guidancePaths = args.guidance;
}
if (args.skills.length > 0) {
    input.skillHints = args.skills;
}
if (args.resume !== undefined) {
    input.resumeThreadId = args.resume;
}
if (args.model !== undefined) {
    input.model = args.model;
}
if (args.modelRouting !== undefined ||
    args.pinnedModel !== undefined ||
    args.fastModel !== undefined ||
    args.buildModel !== undefined ||
    args.expertModel !== undefined) {
    const customValues = [args.fastModel, args.buildModel, args.expertModel];
    if (customValues.some((value) => value !== undefined) &&
        customValues.some((value) => value === undefined)) {
        throw new Error("--fast-model, --build-model, and --expert-model must be supplied together");
    }
    input.modelRouting = {
        ...(args.modelRouting === undefined
            ? {
                strategy: args.pinnedModel !== undefined
                    ? "pinned"
                    : args.fastModel !== undefined
                        ? "custom"
                        : "adaptive-verified",
            }
            : { strategy: args.modelRouting }),
        ...(args.pinnedModel === undefined ? {} : { pinnedModel: args.pinnedModel }),
        ...(args.fastModel === undefined ||
            args.buildModel === undefined ||
            args.expertModel === undefined
            ? {}
            : {
                customModels: {
                    fast: args.fastModel,
                    build: args.buildModel,
                    expert: args.expertModel,
                },
            }),
    };
}
if (args.mode !== undefined) {
    input.deliveryMode = args.mode;
}
if (args.changeKind !== undefined) {
    input.changeKind = args.changeKind;
}
if (args.publication !== undefined) {
    input.publication = args.publication;
}
if (args.noReviewAgents !== undefined) {
    input.enableReviewAgents = false;
}
if (args.maxTurns !== undefined) {
    input.maxTurns = args.maxTurns;
}
if (args.turnTimeoutSeconds !== undefined) {
    input.turnTimeoutMs = secondsToMilliseconds(args.turnTimeoutSeconds, "--turn-timeout-seconds");
}
if (args.runTimeoutSeconds !== undefined) {
    input.runTimeoutMs = secondsToMilliseconds(args.runTimeoutSeconds, "--run-timeout-seconds");
}
if (args.blockedDiagnosticTokenReserve !== undefined) {
    input.blockedDiagnosticTokenReserve = args.blockedDiagnosticTokenReserve;
}
if (args.usageHistory !== undefined) {
    input.usageHistoryPath = args.usageHistory;
}
if (args.noUsageCalibration !== undefined) {
    input.usageCalibration = false;
}
const result = await runSpecToPrWithCodex(input);
console.log(JSON.stringify({
    threadId: result.threadId,
    finalResponse: result.finalResponse,
    usage: result.usage,
    workload: result.workload,
    budget: result.budget,
    turnCount: result.turnCount,
    outputFormatting: result.outputFormatting,
    usageCalibration: result.usageCalibration,
    modelRouting: result.modelRouting,
}, null, 2));
function parseArgs(argv) {
    const parsed = {
        docs: [],
        figma: [],
        openapi: [],
        openapiUrls: [],
        guidance: [],
        skills: [],
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const value = argv[index + 1];
        if (arg === undefined) {
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        }
        if (!arg.startsWith("--") || value === undefined || value.startsWith("--")) {
            if (arg === "--no-review-agents") {
                parsed.noReviewAgents = true;
                continue;
            }
            if (arg === "--no-usage-calibration") {
                parsed.noUsageCalibration = true;
                continue;
            }
            if (arg === "--publish") {
                parsed.publication = "draft";
                continue;
            }
            if (arg === "--no-publish") {
                parsed.publication = "none";
                continue;
            }
            throw new Error(`Invalid or missing value for argument: ${arg}`);
        }
        index += 1;
        switch (arg) {
            case "--cwd":
                parsed.cwd = value;
                break;
            case "--prompt":
                parsed.prompt = value;
                break;
            case "--legacy-project":
                parsed.legacyProject = value;
                break;
            case "--legacy-network":
                parsed.legacyNetwork = value;
                break;
            case "--brief":
                parsed.brief = value;
                break;
            case "--docs":
                parsed.docs.push(value);
                break;
            case "--figma":
                parsed.figma.push(value);
                break;
            case "--openapi":
                parsed.openapi.push(value);
                break;
            case "--openapi-url":
                parsed.openapiUrls.push(value);
                break;
            case "--guidance":
                parsed.guidance.push(value);
                break;
            case "--skill":
                parsed.skills.push(value);
                break;
            case "--resume":
                parsed.resume = value;
                break;
            case "--model":
                parsed.model = value;
                break;
            case "--model-routing":
                if (!["adaptive-verified", "pinned", "custom"].includes(value)) {
                    throw new Error(`Invalid model routing strategy: ${value}`);
                }
                parsed.modelRouting = value;
                break;
            case "--pinned-model":
                parsed.pinnedModel = value;
                break;
            case "--fast-model":
                parsed.fastModel = value;
                break;
            case "--build-model":
                parsed.buildModel = value;
                break;
            case "--expert-model":
                parsed.expertModel = value;
                break;
            case "--max-turns":
                parsed.maxTurns = parsePositiveInteger(value, arg);
                break;
            case "--turn-timeout-seconds":
                parsed.turnTimeoutSeconds = parsePositiveInteger(value, arg);
                break;
            case "--run-timeout-seconds":
                parsed.runTimeoutSeconds = parsePositiveInteger(value, arg);
                break;
            case "--blocked-diagnostic-token-reserve":
                parsed.blockedDiagnosticTokenReserve = parsePositiveInteger(value, arg);
                break;
            case "--usage-history":
                parsed.usageHistory = value;
                break;
            case "--mode":
                if (!["auto", "brief", "legacy", "feature", "figma"].includes(value)) {
                    throw new Error(`Invalid delivery mode: ${value}`);
                }
                parsed.mode = value;
                break;
            case "--change-kind":
                if (!["auto", "feature", "fix", "refactor", "migration", "design", "docs"].includes(value)) {
                    throw new Error(`Invalid change kind: ${value}`);
                }
                parsed.changeKind = value;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return parsed;
}
function parsePositiveInteger(value, argument) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${argument} requires a positive integer`);
    }
    return parsed;
}
function secondsToMilliseconds(seconds, argument) {
    const milliseconds = seconds * 1_000;
    if (!Number.isSafeInteger(milliseconds)) {
        throw new Error(`${argument} is too large`);
    }
    return milliseconds;
}
function printUsage() {
    console.error(`Usage: spec-to-pr-codex --cwd <repo> [options]

Options:
  --prompt <text>       Additional user request
  --legacy-project <p> Separate read-only legacy project root
  --legacy-network <p> Project-local HAR/JSON for the scoped legacy flow
  --brief <path>        Brief or plan path
  --docs <path>         Supporting document path (repeatable)
  --figma <url>         Figma file or node URL
  --openapi <path>      OpenAPI file path (repeatable)
  --openapi-url <url>   HTTPS OpenAPI or Swagger UI URL (repeatable)
  --guidance <path>     Project guidance file path (repeatable)
  --skill <name>        Optional installed-skill hint (repeatable)
  --resume <thread-id>  Resume an existing Codex thread
  --model <model>       Compatibility alias for --model-routing pinned --pinned-model
  --model-routing <s>   adaptive-verified (default), pinned, or custom
  --pinned-model <m>    One exact model for every stage and independent review
  --fast-model <m>      Custom fast-role model (requires all three custom roles)
  --build-model <m>     Custom build-role model
  --expert-model <m>    Custom expert/reviewer model
  --max-turns <n>       Maximum workflow boundary turns (default: 12)
  --turn-timeout-seconds <n>
                        Stop and preserve a resumable thread when one turn exceeds n seconds
  --run-timeout-seconds <n>
                        Stop and preserve a resumable thread when the full Run exceeds n seconds
  --blocked-diagnostic-token-reserve <n>
                        Tokens held for finalizing a blocked draft (default: 24000)
  --usage-history <p>   Numeric-only calibration JSONL path
  --no-usage-calibration  Disable calibration reads and writes
  --mode <mode>         auto, brief, legacy, feature, or figma
  --change-kind <kind>  feature, fix, refactor, migration, design, docs, or auto
  --publish             Publish a draft PR/MR when ready
  --no-publish          Finish after evidence-backed implementation and review
  --no-review-agents    Keep mandatory review evidence in the current context instead of delegation`);
}
