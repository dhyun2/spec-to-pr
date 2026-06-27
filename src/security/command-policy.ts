import path from "node:path";

import { z } from "zod";

import { allow, deny, requireApproval, type PolicyDecision } from "./policy.js";

export const CommandIntentSchema = z.enum([
  "inspect",
  "install",
  "generate",
  "lint",
  "typecheck",
  "test",
  "build",
  "format",
  "git-read",
  "git-write",
  "publish",
  "unknown",
]);

export const CommandInvocationSchema = z
  .object({
    command: z.string().trim().min(1).max(200),
    args: z.array(z.string().max(1_000)).default([]),
    cwd: z.string().trim().min(1).optional(),
    intent: CommandIntentSchema.default("unknown"),
  })
  .strict();

export const CommandClassificationSchema = z
  .object({
    command: CommandInvocationSchema,
    normalizedCommand: z.string().trim().min(1),
    decision: z.unknown(),
  })
  .strict();

export type CommandIntent = z.infer<typeof CommandIntentSchema>;
export type CommandInvocation = z.infer<typeof CommandInvocationSchema>;

export type CommandClassification = {
  command: CommandInvocation;
  normalizedCommand: string;
  decision: PolicyDecision;
};

const FORBIDDEN_EXECUTABLES = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "rm",
  "rmdir",
  "del",
  "sudo",
  "su",
  "chmod",
  "chown",
  "curl",
  "wget",
  "ssh",
  "scp",
  "sftp",
  "ftp",
  "nc",
  "netcat",
  "docker",
  "podman",
  "kubectl",
]);

const ALLOWED_EXECUTABLES = new Set([
  "node",
  "npm",
  "pnpm",
  "yarn",
  "git",
  "npx",
  "tsx",
  "tsc",
  "vitest",
  "eslint",
  "prettier",
  "playwright",
  "openspec",
]);

const SHELL_METACHARACTER_PATTERNS = [/;/, /&&/, /\|\|/, /\|/, />/, /</, /`/, /\$\(/, /\$\{/];

export function classifyCommand(rawCommand: CommandInvocation): CommandClassification {
  const command = CommandInvocationSchema.parse(rawCommand);
  const normalizedCommand = normalizeExecutable(command.command);

  const shellCharacters = findShellCharacters([command.command, ...command.args]);

  if (shellCharacters.length > 0) {
    return {
      command,
      normalizedCommand,
      decision: deny(
        "SHELL_SYNTAX_FORBIDDEN",
        `Shell syntax is not allowed in command arguments: ${shellCharacters.join(", ")}`,
        "critical",
        ["command", "shell"],
      ),
    };
  }

  if (FORBIDDEN_EXECUTABLES.has(normalizedCommand)) {
    return {
      command,
      normalizedCommand,
      decision: deny(
        "EXECUTABLE_FORBIDDEN",
        `Executable ${normalizedCommand} is forbidden by policy.`,
        "critical",
        ["command", "forbidden-executable"],
      ),
    };
  }

  if (!ALLOWED_EXECUTABLES.has(normalizedCommand)) {
    return {
      command,
      normalizedCommand,
      decision: requireApproval(
        "EXECUTABLE_NOT_ALLOWLISTED",
        `Executable ${normalizedCommand} is not in the allowlist.`,
        "high",
        ["command", "unknown-executable"],
      ),
    };
  }

  return classifyAllowlistedCommand(command, normalizedCommand);
}

function classifyAllowlistedCommand(
  command: CommandInvocation,
  normalizedCommand: string,
): CommandClassification {
  if (normalizedCommand === "git") {
    return {
      command,
      normalizedCommand,
      decision: classifyGit(command.args),
    };
  }

  if (["npm", "pnpm", "yarn"].includes(normalizedCommand)) {
    return {
      command,
      normalizedCommand,
      decision: classifyPackageManager(normalizedCommand, command.args, command.intent),
    };
  }

  if (normalizedCommand === "npx") {
    return {
      command,
      normalizedCommand,
      decision: requireApproval(
        "NPX_REQUIRES_APPROVAL",
        "npx may download and execute packages, so it requires approval.",
        "high",
        ["command", "package-execution"],
      ),
    };
  }

  if (
    ["tsc", "vitest", "eslint", "prettier", "tsx", "playwright", "openspec"].includes(
      normalizedCommand,
    )
  ) {
    return {
      command,
      normalizedCommand,
      decision: allow(
        "KNOWN_TOOL_ALLOWED",
        `${normalizedCommand} is allowed as a known local tool.`,
        ["command", "known-tool"],
      ),
    };
  }

  if (normalizedCommand === "node") {
    return {
      command,
      normalizedCommand,
      decision: requireApproval(
        "NODE_SCRIPT_REQUIRES_APPROVAL",
        "Direct node execution can run arbitrary scripts and requires approval until command runner policy is more specific.",
        "medium",
        ["command", "node"],
      ),
    };
  }

  return {
    command,
    normalizedCommand,
    decision: requireApproval(
      "ALLOWLISTED_BUT_UNCLASSIFIED",
      `${normalizedCommand} is allowlisted but does not have a specific policy.`,
      "medium",
      ["command"],
    ),
  };
}

function classifyGit(args: string[]): PolicyDecision {
  const subcommand = args[0];

  if (subcommand === undefined) {
    return requireApproval(
      "GIT_NO_SUBCOMMAND",
      "git without a subcommand requires approval.",
      "medium",
      ["command", "git"],
    );
  }

  const readOnlySubcommands = new Set([
    "status",
    "diff",
    "log",
    "show",
    "rev-parse",
    "cat-file",
    "ls-files",
    "branch",
    "remote",
  ]);

  const writeSubcommands = new Set([
    "add",
    "commit",
    "checkout",
    "switch",
    "merge",
    "rebase",
    "reset",
    "clean",
    "push",
    "pull",
    "fetch",
    "tag",
  ]);

  if (readOnlySubcommands.has(subcommand)) {
    return allow("GIT_READ_ALLOWED", `git ${subcommand} is allowed as read-only.`, [
      "command",
      "git-read",
    ]);
  }

  if (writeSubcommands.has(subcommand)) {
    return requireApproval(
      "GIT_WRITE_REQUIRES_APPROVAL",
      `git ${subcommand} can mutate repository state or network state and requires approval.`,
      "high",
      ["command", "git-write"],
    );
  }

  return requireApproval(
    "GIT_UNKNOWN_SUBCOMMAND",
    `git ${subcommand} is not classified.`,
    "medium",
    ["command", "git"],
  );
}

function classifyPackageManager(
  manager: string,
  args: string[],
  intent: CommandIntent,
): PolicyDecision {
  const subcommand = args[0];

  if (subcommand === undefined) {
    return requireApproval(
      "PACKAGE_MANAGER_NO_SUBCOMMAND",
      `${manager} without a subcommand requires approval.`,
      "medium",
      ["command", "package-manager"],
    );
  }

  if (["test", "build", "lint", "typecheck", "format", "exec"].includes(subcommand)) {
    return allow("PACKAGE_SCRIPT_ALLOWED", `${manager} ${subcommand} is allowed for ${intent}.`, [
      "command",
      "package-manager",
    ]);
  }

  if (["install", "add", "remove", "update", "dlx", "create"].includes(subcommand)) {
    return requireApproval(
      "PACKAGE_MANAGER_MUTATION_REQUIRES_APPROVAL",
      `${manager} ${subcommand} can mutate dependencies or execute downloaded code and requires approval.`,
      "high",
      ["command", "package-manager", "dependency"],
    );
  }

  return requireApproval(
    "PACKAGE_MANAGER_UNKNOWN_SUBCOMMAND",
    `${manager} ${subcommand} is not classified.`,
    "medium",
    ["command", "package-manager"],
  );
}

function normalizeExecutable(command: string): string {
  return path.basename(command).toLowerCase();
}

function findShellCharacters(parts: string[]): string[] {
  const found = new Set<string>();

  parts.forEach((part) => {
    SHELL_METACHARACTER_PATTERNS.forEach((pattern) => {
      if (pattern.test(part)) {
        found.add(pattern.source);
      }
    });
  });

  return [...found];
}
