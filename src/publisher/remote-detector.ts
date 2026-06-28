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

  if (normalized.host === "github.com") {
    const [owner, repo] = normalized.pathParts;

    if (owner === undefined || repo === undefined) {
      throw new Error(`Cannot parse GitHub remote URL: ${remote.url}`);
    }

    return PublishTargetSchema.parse({
      host: "github",
      webBaseUrl: "https://github.com",
      apiBaseUrl: "https://api.github.com",
      owner,
      repo,
    });
  }

  if (normalized.host === "gitlab.com") {
    if (normalized.pathParts.length < 2) {
      throw new Error(`Cannot parse GitLab remote URL: ${remote.url}`);
    }

    return PublishTargetSchema.parse({
      host: "gitlab",
      webBaseUrl: "https://gitlab.com",
      apiBaseUrl: "https://gitlab.com/api/v4",
      projectPath: normalized.pathParts.join("/"),
    });
  }

  throw new Error(`Unsupported Git remote host: ${normalized.host}`);
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
