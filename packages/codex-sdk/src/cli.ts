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
  minVisualScore?: number;
  maxRepairAttempts?: number;
  noReviewAgents?: boolean;
  noVisualRepairLoop?: boolean;
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
if (args.noReviewAgents !== undefined) {
  input.enableReviewAgents = false;
}
if (args.noVisualRepairLoop !== undefined) {
  input.enableVisualRepairLoop = false;
}
if (args.minVisualScore !== undefined || args.maxRepairAttempts !== undefined) {
  input.visualRepairPolicy = {};
  if (args.minVisualScore !== undefined) {
    input.visualRepairPolicy.minPassingScore = args.minVisualScore;
  }
  if (args.maxRepairAttempts !== undefined) {
    input.visualRepairPolicy.maxAttempts = args.maxRepairAttempts;
  }
}

const result = await runSpecToPrWithCodex(input);

console.log(
  JSON.stringify(
    {
      threadId: result.threadId,
      finalResponse: result.finalResponse,
      usage: result.usage,
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
      if (arg === "--no-visual-repair-loop") {
        parsed.noVisualRepairLoop = true;
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
      case "--min-visual-score":
        parsed.minVisualScore = Number.parseFloat(value);
        break;
      case "--max-repair-attempts":
        parsed.maxRepairAttempts = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
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
  --min-visual-score <n>        Visual repair pass threshold, default 0.9
  --max-repair-attempts <n>     Visual repair attempt cap, default 3
  --no-review-agents           Disable review subagent instructions
  --no-visual-repair-loop      Disable visual repair loop instructions`);
}
