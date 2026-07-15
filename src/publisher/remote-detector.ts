import { z } from "zod";

import { PublishTargetSchema } from "./publish-contracts.js";
import type { PublishTarget } from "./publish-contracts.js";

export const GitRemoteInfoSchema = z
  .object({
    name: z.string().trim().min(1),
    url: z.string().trim().min(1),
  })
  .strict();

export type GitRemoteInfo = z.infer<typeof GitRemoteInfoSchema>;

export function detectPublishTargetFromRemote(remote: GitRemoteInfo): PublishTarget {
  const normalized = normalizeGitRemoteUrl(remote.url);
  const kind = resolveHostKind(normalized.host);

  if (kind === "github") {
    const [owner, repo] = normalized.pathParts;

    if (owner === undefined || repo === undefined) {
      throw new Error(`Cannot parse GitHub remote URL: ${remote.url}`);
    }

    const enterprise = normalized.host !== "github.com";

    return PublishTargetSchema.parse({
      host: "github",
      webBaseUrl: envUrl("SPEC_TO_PR_WEB_BASE_URL") ?? `https://${normalized.host}`,
      // github.com uses api.github.com; GitHub Enterprise uses https://<host>/api/v3.
      apiBaseUrl:
        envUrl("SPEC_TO_PR_API_BASE_URL") ??
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
      webBaseUrl: envUrl("SPEC_TO_PR_WEB_BASE_URL") ?? `https://${normalized.host}`,
      apiBaseUrl: envUrl("SPEC_TO_PR_API_BASE_URL") ?? `https://${normalized.host}/api/v4`,
      projectPath: normalized.pathParts.join("/"),
    });
  }

  throw new Error(
    `Unsupported Git remote host: ${normalized.host}. ` +
      `Set SPEC_TO_PR_GIT_HOST=github|gitlab (optionally with SPEC_TO_PR_API_BASE_URL and ` +
      `SPEC_TO_PR_WEB_BASE_URL) to publish to a self-hosted instance.`,
  );
}

/**
 * Decide whether a remote host is GitHub or GitLab. Resolution order:
 * 1. explicit SPEC_TO_PR_GIT_HOST override (for self-hosted instances),
 * 2. exact known SaaS hosts.
 */
function resolveHostKind(host: string): "github" | "gitlab" | undefined {
  const override = process.env["SPEC_TO_PR_GIT_HOST"]?.trim().toLowerCase();

  if (override === "github" || override === "gitlab") {
    return override;
  }

  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";

  return undefined;
}

function envUrl(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value !== undefined && value.length > 0 ? value : undefined;
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
