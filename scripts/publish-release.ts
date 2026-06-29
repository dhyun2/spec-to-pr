import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import {
  buildReleasePublishPlan,
  parseReleasePublishArgs,
  type ReleasePublishOptions,
} from "../src/release/release-publish-plan.js";

const args = parseReleasePublishArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

const packageVersion = readPackageVersion();
const version = args.version ?? packageVersion;
const planOptions = stripRuntimeOptions({
  ...args,
  version,
});
const plan = buildReleasePublishPlan(planOptions);

if (args.dryRun) {
  console.log(`Release publish dry-run for ${version}`);
  for (const step of plan) {
    console.log(`${step.id}: ${formatCommand(step.command, step.args)}`);
  }
  process.exit(0);
}

console.log(`Release publish for ${version}`);
for (const step of plan) {
  console.log(`\n> ${step.title}`);
  console.log(`$ ${formatCommand(step.command, step.args)}`);

  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
  });

  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nRelease publish workflow completed.");

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("package.json version is required");
  }

  return packageJson.version;
}

function stripRuntimeOptions(
  options: ReleasePublishOptions & {
    dryRun?: boolean;
    help?: boolean;
  },
): ReleasePublishOptions {
  const { dryRun: _dryRun, help: _help, ...planOptions } = options;
  return planOptions;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map(quoteShellArg)].join(" ");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function printUsage(): void {
  console.log(`Usage: pnpm release:publish -- [options]

Options:
  --version, -v <version>       Release version. Defaults to package.json version.
  --branch <branch>             Branch to push before tagging. Defaults to main.
  --dry-run                     Print the command plan without executing it.
  --verify-only                 Run check, plugin validation, and release dry-run only.
  --skip-verify                 Skip pnpm check/plugin validation/release build.
  --skip-push                   Skip git push.
  --skip-tag                    Skip Claude plugin tag creation.
  --skip-local-updates          Skip local Claude/Codex marketplace updates.
  --local-target <target>       Local update target: all, claude, or codex.
  --claude-marketplace <name>   Claude marketplace name. Defaults to spec-to-pr.
  --claude-plugin <name>        Claude plugin install name. Defaults to spec-to-pr@spec-to-pr.
  --codex-marketplace <name>    Codex marketplace name. Defaults to spec-to-pr-local.
`);
}
