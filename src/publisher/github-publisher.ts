import {
  PublishedReviewRequestSchema,
  type PublishedReviewRequest,
  type PublishTarget,
  type ReviewRequestPayload,
} from "./publish-contracts.js";
import type { ReviewRequestPublisher } from "./publisher-port.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class GitHubPublisherAdapter implements ReviewRequestPublisher {
  public constructor(private readonly fetchImpl: FetchLike = fetch) {}

  public async findExisting(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest | undefined> {
    assertGitHub(input.target);

    const url = new URL(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls`,
    );

    url.searchParams.set("head", `${input.target.owner}:${input.payload.sourceBranch}`);
    url.searchParams.set("base", input.payload.targetBranch);
    url.searchParams.set("state", "open");

    const response = await this.githubFetch(url.toString(), input.token, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`GitHub list PRs failed: ${response.status} ${await response.text()}`);
    }

    const pulls = (await response.json()) as Array<Record<string, unknown>>;
    const first = pulls[0];

    if (first === undefined) {
      return undefined;
    }

    return normalizeGitHubPr(first, false, true, input.payload);
  }

  public async create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest> {
    assertGitHub(input.target);

    const response = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls`,
      input.token,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.payload.title,
          head: input.payload.sourceBranch,
          base: input.payload.targetBranch,
          body: input.payload.body,
          draft: input.payload.mode === "draft",
          maintainer_can_modify: true,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub create PR failed: ${response.status} ${await response.text()}`);
    }

    const pr = (await response.json()) as Record<string, unknown>;

    await this.applyIssueMetadata({
      target: input.target,
      issueNumber: String(pr["number"]),
      payload: input.payload,
      token: input.token,
    });

    return normalizeGitHubPr(pr, true, false, input.payload);
  }

  public async updateBody(input: {
    target: PublishTarget;
    requestNumber: string;
    body: string;
    token: string;
  }): Promise<PublishedReviewRequest> {
    assertGitHub(input.target);

    const response = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls/${input.requestNumber}`,
      input.token,
      {
        method: "PATCH",
        body: JSON.stringify({
          body: input.body,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub update PR body failed: ${response.status} ${await response.text()}`);
    }

    const pr = (await response.json()) as Record<string, unknown>;

    return normalizeGitHubPr(pr, false, true, {
      sourceBranch: String((pr["head"] as Record<string, unknown>)?.["ref"] ?? ""),
      targetBranch: String((pr["base"] as Record<string, unknown>)?.["ref"] ?? ""),
    });
  }

  private async applyIssueMetadata(input: {
    target: PublishTarget & { owner: string; repo: string };
    issueNumber: string;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<void> {
    if (input.payload.labels.length > 0) {
      await this.githubFetch(
        `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/issues/${input.issueNumber}/labels`,
        input.token,
        {
          method: "POST",
          body: JSON.stringify({
            labels: input.payload.labels,
          }),
        },
      );
    }

    if (input.payload.reviewers.length > 0) {
      await this.githubFetch(
        `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls/${input.issueNumber}/requested_reviewers`,
        input.token,
        {
          method: "POST",
          body: JSON.stringify({
            reviewers: input.payload.reviewers,
          }),
        },
      );
    }
  }

  private async githubFetch(url: string, token: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  }
}

function assertGitHub(target: PublishTarget): asserts target is PublishTarget & {
  owner: string;
  repo: string;
} {
  if (target.host !== "github" || target.owner === undefined || target.repo === undefined) {
    throw new Error("Expected GitHub publish target");
  }
}

function normalizeGitHubPr(
  pr: Record<string, unknown>,
  created: boolean,
  updated: boolean,
  payload: Pick<ReviewRequestPayload, "sourceBranch" | "targetBranch">,
): PublishedReviewRequest {
  return PublishedReviewRequestSchema.parse({
    host: "github",
    url: String(pr["html_url"]),
    number: String(pr["number"]),
    id: String(pr["id"]),
    draft: pr["draft"] === true,
    sourceBranch: payload.sourceBranch,
    targetBranch: payload.targetBranch,
    created,
    updated,
  });
}
