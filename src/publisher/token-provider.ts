import { execFileSync } from "node:child_process";

import type { ReviewHost } from "./publish-contracts.js";

export type PublisherToken = {
  token: string;
  source: string;
};

type HostTokenConfig = {
  label: string;
  envNames: string[];
  cli: { command: string; args: string[] };
};

const HOST_CONFIG: Record<ReviewHost, HostTokenConfig> = {
  github: {
    label: "GitHub",
    envNames: ["GITHUB_TOKEN", "GH_TOKEN"],
    cli: { command: "gh", args: ["auth", "token"] },
  },
  gitlab: {
    label: "GitLab",
    envNames: ["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"],
    cli: { command: "glab", args: ["config", "get", "token", "--host"] },
  },
};

export function readPublisherToken(host: ReviewHost, hostname?: string): PublisherToken {
  const config = HOST_CONFIG[host];
  const cli = cliForHost(config.cli, host, hostname);

  // 1. Environment variables take precedence (explicit, CI-friendly).
  const fromEnv = readEnvToken(config.envNames);

  if (fromEnv !== undefined) {
    return fromEnv;
  }

  // 2. Fall back to the host CLI if it is installed and authenticated.
  const fromCli = readCliToken(cli);

  if (fromCli !== undefined) {
    return fromCli;
  }

  throw new Error(
    `${config.label} token is not configured. Set one of: ${config.envNames.join(", ")}, ` +
      `or authenticate the ${cli.command} CLI (${cli.command} ${cli.args.join(" ")}).`,
  );
}

function cliForHost(
  cli: { command: string; args: string[] },
  host: ReviewHost,
  hostname: string | undefined,
): { command: string; args: string[] } {
  if (host !== "gitlab") return cli;

  return {
    command: cli.command,
    args: [...cli.args, hostname?.trim() || "gitlab.com"],
  };
}

function readEnvToken(names: string[]): PublisherToken | undefined {
  for (const name of names) {
    const value = process.env[name];

    if (value !== undefined && value.trim().length > 0) {
      return { token: value, source: name };
    }
  }

  return undefined;
}

function readCliToken(cli: { command: string; args: string[] }): PublisherToken | undefined {
  try {
    const output = execFileSync(cli.command, cli.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();

    if (output.length > 0) {
      return { token: output, source: `${cli.command} ${cli.args.join(" ")}` };
    }
  } catch {
    // CLI missing or not authenticated: fall through to the configuration error.
  }

  return undefined;
}
