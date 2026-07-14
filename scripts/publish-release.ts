import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import {
  buildReleasePublishPlan,
  parseReleasePublishArgs,
  type ReleasePublishOptions,
} from "../src/release/release-publish-plan.js";
import {
  verifyReleaseVersionDeclarations,
  verifyReviewerProfileParity,
} from "../src/release/release-verifier.js";

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

const performsRemoteMutation =
  args.verifyOnly !== true && (args.skipPush !== true || args.skipTag !== true);
runReleasePreflight({
  version,
  branch: planOptions.branch ?? "main",
  requireClean: performsRemoteMutation,
  requireTagAvailable: performsRemoteMutation && args.skipTag !== true,
  requireBranchBinding: performsRemoteMutation,
});

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

function runReleasePreflight(input: {
  version: string;
  branch: string;
  requireClean: boolean;
  requireTagAvailable: boolean;
  requireBranchBinding: boolean;
}): void {
  const failures = [
    ...verifyReleaseVersionDeclarations(readVersionFiles(), input.version),
    ...verifyReviewerProfileParity(readReviewerFiles()),
  ];

  if (input.requireClean) {
    const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.length > 0) {
      failures.push(`Release publication requires a clean worktree:\n${status}`);
    }
  }

  if (input.requireBranchBinding) {
    const currentBranch = runGit(["branch", "--show-current"]);
    const head = runGit(["rev-parse", "HEAD"]);
    const branchHead = runGit(["rev-parse", input.branch]);

    if (currentBranch !== input.branch) {
      failures.push(
        `Release source branch mismatch: checked out ${currentBranch || "detached HEAD"}; expected ${input.branch}.`,
      );
    }
    if (head !== branchHead) {
      failures.push(`Release source branch ${input.branch} does not point at checked-out HEAD.`);
    }
  }

  if (input.requireTagAvailable) {
    const tag = `spec-to-pr--v${input.version}`;
    if (runGitOptional(["tag", "--list", tag]).length > 0) {
      failures.push(`Release tag already exists locally: ${tag}.`);
    }

    const origin = runGitOptional(["remote", "get-url", "origin"]);
    if (origin.length === 0) {
      failures.push("Release publication requires an origin remote.");
    } else {
      const remoteTag = spawnSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: false,
      });
      if (remoteTag.error !== undefined || remoteTag.status !== 0) {
        failures.push(`Unable to verify remote release tag availability for ${tag}.`);
      } else if ((remoteTag.stdout ?? "").trim().length > 0) {
        failures.push(`Release tag already exists on origin: ${tag}.`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Release preflight failed:\n- ${failures.join("\n- ")}`);
  }
}

function readVersionFiles(): Map<string, Buffer> {
  return readFiles([
    "package.json",
    "packages/codex-sdk/package.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
  ]);
}

function readReviewerFiles(): Map<string, Buffer> {
  return readFiles([
    "agents/design-reviewer.md",
    "agents/functional-reviewer.md",
    ".codex/agents/spec-to-pr-design-reviewer.toml",
    ".codex/agents/spec-to-pr-functional-reviewer.toml",
  ]);
}

function readFiles(files: string[]): Map<string, Buffer> {
  return new Map(files.map((file) => [file, readFileSync(file)]));
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `git ${args[0] ?? "command"} failed: ${(result.stderr ?? result.error?.message ?? "").trim()}`,
    );
  }

  return (result.stdout ?? "").trim();
}

function runGitOptional(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
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
  --codex-marketplace <name>    Codex marketplace name. Defaults to spec-to-pr.
`);
}
