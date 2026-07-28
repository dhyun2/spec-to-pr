import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { PublishTargetSchema } from "./publish-contracts.js";
import type { PublishTarget } from "./publish-contracts.js";
import { credentialCommand, isCredentialOutputAvailable } from "./token-provider.js";

const execFileAsync = promisify(execFile);

export const GitRemoteInfoSchema = z
  .object({
    name: z.string().trim().min(1),
    url: z.string().trim().min(1),
  })
  .strict();

export type GitRemoteInfo = z.infer<typeof GitRemoteInfoSchema>;
export type PublishPreflightEnvironment = Record<string, string | undefined>;
export type PublishAuthProbe = (input: {
  provider: "github" | "gitlab";
  hostname: string;
}) => Promise<{ available: boolean; source: string }>;

export function detectPublishTargetFromRemote(
  remote: GitRemoteInfo,
  environment: PublishPreflightEnvironment = process.env,
): PublishTarget {
  const normalized = normalizeGitRemoteUrl(remote.url);
  const kind = resolveHostKind(normalized.host, environment);

  if (kind === "github") {
    const [owner, repo] = normalized.pathParts;

    if (owner === undefined || repo === undefined) {
      throw new Error(`Cannot parse GitHub remote URL: ${remote.url}`);
    }

    const enterprise = normalized.host !== "github.com";

    return PublishTargetSchema.parse({
      host: "github",
      webBaseUrl: envUrl(environment, "SPEC_TO_PR_WEB_BASE_URL") ?? `https://${normalized.host}`,
      // github.com uses api.github.com; GitHub Enterprise uses https://<host>/api/v3.
      apiBaseUrl:
        envUrl(environment, "SPEC_TO_PR_API_BASE_URL") ??
        (enterprise ? `https://${normalized.host}/api/v3` : "https://api.github.com"),
      owner,
      repo,
    });
  }

  if (kind === "gitlab") {
    if (normalized.pathParts.length < 2) {
      throw new Error(`Cannot parse GitLab remote URL: ${remote.url}`);
    }

    return PublishTargetSchema.parse({
      host: "gitlab",
      webBaseUrl: envUrl(environment, "SPEC_TO_PR_WEB_BASE_URL") ?? `https://${normalized.host}`,
      apiBaseUrl:
        envUrl(environment, "SPEC_TO_PR_API_BASE_URL") ?? `https://${normalized.host}/api/v4`,
      projectPath: normalized.pathParts.join("/"),
    });
  }

  throw new Error(
    `Unsupported Git remote host: ${normalized.host}. ` +
      `Set SPEC_TO_PR_GIT_HOST=github|gitlab (optionally with SPEC_TO_PR_API_BASE_URL and ` +
      `SPEC_TO_PR_WEB_BASE_URL) to publish to a self-hosted instance.`,
  );
}

export async function preflightPublishTarget(
  remote: GitRemoteInfo,
  environment: PublishPreflightEnvironment = process.env,
  authProbe: PublishAuthProbe = defaultAuthProbe,
): Promise<{
  public: PublishTarget;
  remoteHost: string;
  authVerified: boolean;
}> {
  const normalized = normalizeGitRemoteUrl(remote.url);
  const selfHosted = normalized.host !== "github.com" && normalized.host !== "gitlab.com";
  if (!selfHosted) {
    return {
      public: detectPublishTargetFromRemote(remote, environment),
      remoteHost: normalized.host,
      authVerified: false,
    };
  }

  const provider = environment["SPEC_TO_PR_GIT_HOST"]?.trim().toLowerCase();
  if (provider !== "github" && provider !== "gitlab") {
    throw preflightError("self-hosted remotes require SPEC_TO_PR_GIT_HOST=github|gitlab");
  }
  const webBaseUrl = requireCustomBaseUrl(environment, "SPEC_TO_PR_WEB_BASE_URL", normalized.host);
  const apiBaseUrl = requireCustomBaseUrl(environment, "SPEC_TO_PR_API_BASE_URL", normalized.host);
  const target = detectPublishTargetFromRemote(remote, {
    ...environment,
    SPEC_TO_PR_GIT_HOST: provider,
    SPEC_TO_PR_WEB_BASE_URL: webBaseUrl,
    SPEC_TO_PR_API_BASE_URL: apiBaseUrl,
  });

  let auth: { available: boolean; source: string };
  try {
    auth = await authProbe({ provider, hostname: normalized.host });
  } catch {
    throw preflightError(
      `${provider === "github" ? "gh" : "glab"} auth token probe failed for ${normalized.host}`,
    );
  }
  if (!auth.available) {
    throw preflightError("authentication must resolve the exact remote hostname");
  }
  return {
    public: target,
    remoteHost: normalized.host,
    authVerified: true,
  };
}

/**
 * Decide whether a remote host is GitHub or GitLab. Resolution order:
 * 1. explicit SPEC_TO_PR_GIT_HOST override (for self-hosted instances),
 * 2. exact known SaaS hosts.
 */
function resolveHostKind(
  host: string,
  environment: PublishPreflightEnvironment,
): "github" | "gitlab" | undefined {
  const override = environment["SPEC_TO_PR_GIT_HOST"]?.trim().toLowerCase();

  if (override === "github" || override === "gitlab") {
    return override;
  }

  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";

  return undefined;
}

function envUrl(environment: PublishPreflightEnvironment, name: string): string | undefined {
  const value = environment[name]?.trim();

  return value !== undefined && value.length > 0 ? value : undefined;
}

function requireCustomBaseUrl(
  environment: PublishPreflightEnvironment,
  name: "SPEC_TO_PR_WEB_BASE_URL" | "SPEC_TO_PR_API_BASE_URL",
  expectedHost: string,
): string {
  const value = envUrl(environment, name);
  if (value === undefined) {
    throw preflightError(`self-hosted remotes require ${name}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw preflightError(`${name} must be a valid HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname.toLowerCase() !== expectedHost
  ) {
    throw preflightError(`${name} must use HTTPS on the exact remote hostname`);
  }
  return parsed.toString().replace(/\/$/, "");
}

async function defaultAuthProbe(input: {
  provider: "github" | "gitlab";
  hostname: string;
}): Promise<{ available: boolean; source: string }> {
  const credential = credentialCommand(input.provider, input.hostname);
  const result = await execFileAsync(credential.command, credential.args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return {
    available: isCredentialOutputAvailable(result.stdout),
    source: `${credential.command} ${credential.args.join(" ")}`,
  };
}

function preflightError(message: string): Error {
  return new Error(`PUBLISH_TARGET_PREFLIGHT_FAILED: ${message}`);
}

export function normalizeGitRemoteUrl(rawUrl: string): {
  host: string;
  pathParts: string[];
} {
  const trimmed = rawUrl.trim();
  const sshMatch = /^git@([^:]+):(.+)$/.exec(trimmed);

  if (sshMatch !== null) {
    return {
      host: sshMatch[1]!.toLowerCase(),
      pathParts: splitRepoPath(sshMatch[2]!),
    };
  }

  const sshUrlMatch = /^ssh:\/\/git@([^/]+)\/(.+)$/.exec(trimmed);

  if (sshUrlMatch !== null) {
    return {
      host: sshUrlMatch[1]!.toLowerCase(),
      pathParts: splitRepoPath(sshUrlMatch[2]!),
    };
  }

  const url = new URL(trimmed);

  return {
    host: url.hostname.toLowerCase(),
    pathParts: splitRepoPath(url.pathname.replace(/^\/+/, "")),
  };
}

function splitRepoPath(value: string): string[] {
  return value
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
}
