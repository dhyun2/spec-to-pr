import { execFileSync } from "node:child_process";

import type { ReviewHost } from "./publish-contracts.js";

export type PublisherToken = {
  token: string;
  source: string;
};

export type PublisherCredentialAvailability = {
  available: boolean;
  source: string;
};

type HostTokenConfig = {
  label: string;
  envNames: string[];
};

const HOST_CONFIG: Record<ReviewHost, HostTokenConfig> = {
  github: {
    label: "GitHub",
    envNames: ["GITHUB_TOKEN", "GH_TOKEN"],
  },
  gitlab: {
    label: "GitLab",
    envNames: ["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"],
  },
};

export function readPublisherToken(host: ReviewHost, hostname?: string): PublisherToken {
  const config = HOST_CONFIG[host];
  const cli = credentialCommand(host, hostname?.trim() || defaultHostname(host));

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

export function credentialCommand(
  provider: "github" | "gitlab",
  hostname: string,
): { command: string; args: string[] } {
  return provider === "github"
    ? { command: "gh", args: ["auth", "token", "--hostname", hostname] }
    : { command: "glab", args: ["config", "get", "token", "--host", hostname] };
}

export function environmentCredentialAvailability(
  host: ReviewHost,
  environment: Record<string, string | undefined>,
): PublisherCredentialAvailability | undefined {
  for (const name of HOST_CONFIG[host].envNames) {
    if ((environment[name]?.trim().length ?? 0) > 0) {
      return { available: true, source: name };
    }
  }

  return undefined;
}

export function isCredentialOutputAvailable(output: string): boolean {
  const normalized = output.trim();
  return normalized.length > 0 && !/^usage:/im.test(normalized) && !/^help:/im.test(normalized);
}

function defaultHostname(host: ReviewHost): string {
  return host === "github" ? "github.com" : "gitlab.com";
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

    if (isCredentialOutputAvailable(output)) {
      return { token: output, source: `${cli.command} ${cli.args.join(" ")}` };
    }
  } catch {
    // CLI missing or not authenticated: fall through to the configuration error.
  }

  return undefined;
}
