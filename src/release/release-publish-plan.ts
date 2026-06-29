export type ReleaseLocalTarget = "all" | "claude" | "codex";

export type ReleaseCommandStep = {
  id: string;
  title: string;
  command: string;
  args: string[];
};

export type ReleasePublishOptions = {
  version: string;
  branch?: string;
  claudeMarketplace?: string;
  claudePlugin?: string;
  codexMarketplace?: string;
  verifyOnly?: boolean;
  localTarget?: ReleaseLocalTarget;
  skipVerify?: boolean;
  skipPush?: boolean;
  skipTag?: boolean;
  skipLocalUpdates?: boolean;
};

export type ParsedReleasePublishArgs = Omit<Partial<ReleasePublishOptions>, "version"> & {
  version?: string;
  dryRun?: boolean;
  help?: boolean;
};

export function buildReleasePublishPlan(input: ReleasePublishOptions): ReleaseCommandStep[] {
  const version = input.version.trim();

  if (version.length === 0) {
    throw new Error("Release version is required");
  }

  const branch = input.branch ?? "main";
  const claudeMarketplace = input.claudeMarketplace ?? "spec-to-pr";
  const claudePlugin = input.claudePlugin ?? "spec-to-pr@spec-to-pr";
  const codexMarketplace = input.codexMarketplace ?? "spec-to-pr-local";
  const steps: ReleaseCommandStep[] = [];

  if (!input.skipVerify) {
    steps.push(
      {
        id: "check",
        title: "Run repository checks",
        command: "pnpm",
        args: ["check"],
      },
      {
        id: "plugin-validate",
        title: "Validate Claude and Codex plugin manifests",
        command: "pnpm",
        args: ["plugin:validate"],
      },
      {
        id: "release-build",
        title: "Build and verify release package",
        command: "pnpm",
        args: ["release:build", version, "--dry-run"],
      },
    );
  }

  if (input.verifyOnly) {
    return steps;
  }

  if (!input.skipPush) {
    steps.push({
      id: "git-push",
      title: `Push ${branch} to origin`,
      command: "git",
      args: ["push", "origin", branch],
    });
  }

  if (!input.skipTag) {
    steps.push({
      id: "claude-tag",
      title: "Create and push Claude plugin release tag",
      command: "claude",
      args: ["plugin", "tag", ".", "--push"],
    });
  }

  if (!input.skipLocalUpdates) {
    const localTarget = input.localTarget ?? "all";

    if (localTarget === "all" || localTarget === "claude") {
      steps.push(
        {
          id: "claude-marketplace-update",
          title: `Update Claude marketplace ${claudeMarketplace}`,
          command: "claude",
          args: ["plugin", "marketplace", "update", claudeMarketplace],
        },
        {
          id: "claude-plugin-update",
          title: `Update local Claude plugin ${claudePlugin}`,
          command: "claude",
          args: ["plugin", "update", claudePlugin],
        },
      );
    }

    if (localTarget === "all" || localTarget === "codex") {
      steps.push({
        id: "codex-marketplace-upgrade",
        title: `Upgrade Codex marketplace ${codexMarketplace}`,
        command: "codex",
        args: ["plugin", "marketplace", "upgrade", codexMarketplace],
      });
    }
  }

  return steps;
}

export function parseReleasePublishArgs(args: string[]): ParsedReleasePublishArgs {
  const parsed: ParsedReleasePublishArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--version":
      case "-v":
        parsed.version = readValue(args, index, arg);
        index += 1;
        break;
      case "--branch":
        parsed.branch = readValue(args, index, arg);
        index += 1;
        break;
      case "--claude-marketplace":
        parsed.claudeMarketplace = readValue(args, index, arg);
        index += 1;
        break;
      case "--claude-plugin":
        parsed.claudePlugin = readValue(args, index, arg);
        index += 1;
        break;
      case "--codex-marketplace":
        parsed.codexMarketplace = readValue(args, index, arg);
        index += 1;
        break;
      case "--local-target":
        parsed.localTarget = parseLocalTarget(readValue(args, index, arg));
        index += 1;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--verify-only":
        parsed.verifyOnly = true;
        break;
      case "--skip-verify":
        parsed.skipVerify = true;
        break;
      case "--skip-push":
        parsed.skipPush = true;
        break;
      case "--skip-tag":
        parsed.skipTag = true;
        break;
      case "--skip-local-updates":
        parsed.skipLocalUpdates = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown release publish option: ${arg ?? ""}`);
    }
  }

  return parsed;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parseLocalTarget(value: string): ReleaseLocalTarget {
  if (value === "all" || value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--local-target must be one of: all, claude, codex");
}
