import type { ReviewHost } from "./publish-contracts.js";

export type PublisherToken = {
  token: string;
  source: string;
};

export function readPublisherToken(host: ReviewHost): PublisherToken {
  if (host === "github") {
    return readRequiredEnv(["GITHUB_TOKEN", "GH_TOKEN"], "GitHub");
  }

  return readRequiredEnv(["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"], "GitLab");
}

function readRequiredEnv(names: string[], label: string): PublisherToken {
  for (const name of names) {
    const value = process.env[name];

    if (value !== undefined && value.trim().length > 0) {
      return {
        token: value,
        source: name,
      };
    }
  }

  throw new Error(`${label} token is not configured. Expected one of: ${names.join(", ")}`);
}
