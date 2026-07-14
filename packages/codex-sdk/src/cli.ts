#!/usr/bin/env node
import process from "node:process";

import { runSpecToPrWithCodex, type SpecToPrCodexRunInput } from "./spec-to-pr-runner.js";

type ParsedArgs = {
  cwd?: string;
  prompt?: string;
  brief?: string;
  docs?: string;
  figma?: string;
  openapi?: string;
  resume?: string;
  model?: string;
  mode?: SpecToPrCodexRunInput["deliveryMode"];
  changeKind?: SpecToPrCodexRunInput["changeKind"];
  publication?: SpecToPrCodexRunInput["publication"];
  noReviewAgents?: boolean;
  tokenBudget?: number;
  maxTurns?: number;
  usageHistory?: string;
  noUsageCalibration?: boolean;
};

const args = parseArgs(process.argv.slice(2));

if (args.cwd === undefined) {
  printUsage();
  process.exit(2);
}

const input: SpecToPrCodexRunInput = {
  workingDirectory: args.cwd,
};

if (args.prompt !== undefined) {
  input.prompt = args.prompt;
}
if (args.brief !== undefined) {
  input.briefPath = args.brief;
}
if (args.docs !== undefined) {
  input.docsPath = args.docs;
}
if (args.figma !== undefined) {
  input.figmaUrl = args.figma;
}
if (args.openapi !== undefined) {
  input.openApiPath = args.openapi;
}
if (args.resume !== undefined) {
  input.resumeThreadId = args.resume;
}
if (args.model !== undefined) {
  input.model = args.model;
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
if (args.tokenBudget !== undefined) {
  input.tokenBudget = args.tokenBudget;
}
if (args.maxTurns !== undefined) {
  input.maxTurns = args.maxTurns;
}
if (args.usageHistory !== undefined) {
  input.usageHistoryPath = args.usageHistory;
}
if (args.noUsageCalibration !== undefined) {
  input.usageCalibration = false;
}
const result = await runSpecToPrWithCodex(input);

console.log(
  JSON.stringify(
    {
      threadId: result.threadId,
      finalResponse: result.finalResponse,
      usage: result.usage,
      workload: result.workload,
      budget: result.budget,
      turnCount: result.turnCount,
      outputFormatting: result.outputFormatting,
      usageCalibration: result.usageCalibration,
    },
    null,
    2,
  ),
);

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

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
      case "--brief":
        parsed.brief = value;
        break;
      case "--docs":
        parsed.docs = value;
        break;
      case "--figma":
        parsed.figma = value;
        break;
      case "--openapi":
        parsed.openapi = value;
        break;
      case "--resume":
        parsed.resume = value;
        break;
      case "--model":
        parsed.model = value;
        break;
      case "--token-budget":
        parsed.tokenBudget = parsePositiveInteger(value, arg);
        break;
      case "--max-turns":
        parsed.maxTurns = parsePositiveInteger(value, arg);
        break;
      case "--usage-history":
        parsed.usageHistory = value;
        break;
      case "--mode":
        if (!["auto", "brief", "legacy", "feature", "figma"].includes(value)) {
          throw new Error(`Invalid delivery mode: ${value}`);
        }
        parsed.mode = value as NonNullable<SpecToPrCodexRunInput["deliveryMode"]>;
        break;
      case "--change-kind":
        if (
          !["auto", "feature", "fix", "refactor", "migration", "design", "docs"].includes(value)
        ) {
          throw new Error(`Invalid change kind: ${value}`);
        }
        parsed.changeKind = value as NonNullable<SpecToPrCodexRunInput["changeKind"]>;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parsePositiveInteger(value: string, argument: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${argument} requires a positive integer`);
  }
  return parsed;
}

function printUsage(): void {
  console.error(`Usage: spec-to-pr-codex --cwd <repo> [options]

Options:
  --prompt <text>       Additional user request
  --brief <path>        Brief or plan path
  --docs <path>         Docs directory or file
  --figma <url>         Figma file or node URL
  --openapi <path>      OpenAPI file path
  --resume <thread-id>  Resume an existing Codex thread
  --model <model>       Optional Codex model override
  --token-budget <n>    Approved hard token limit for this invocation
  --max-turns <n>       Maximum workflow boundary turns (default: 12)
  --usage-history <p>   Numeric-only calibration JSONL path
  --no-usage-calibration  Disable calibration reads and writes
  --mode <mode>         auto, brief, legacy, feature, or figma
  --change-kind <kind>  feature, fix, refactor, migration, design, docs, or auto
  --publish             Publish a draft PR/MR when ready
  --no-publish          Finish after evidence-backed implementation and review
  --no-review-agents    Disable review subagent instructions`);
}
