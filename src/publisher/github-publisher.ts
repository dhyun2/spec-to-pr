import {
  PublishedReviewAssetSchema,
  PublishedReviewRequestSchema,
  ReviewRequestUpdateSchema,
  type PublishedReviewAsset,
  type PublishedReviewRequest,
  type PublishTarget,
  type ReviewRequestPayload,
  type ReviewRequestUpdate,
} from "./publish-contracts.js";
import {
  ReviewRequestSynchronizationError,
  type ReviewRequestAsset,
  type ReviewRequestPublisher,
} from "./publisher-port.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type AbortableRequestInit = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal | undefined;
};

export class GitHubPublisherAdapter implements ReviewRequestPublisher {
  public constructor(private readonly fetchImpl: FetchLike = fetch) {}

  public async findExisting(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    signal?: AbortSignal | undefined;
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
      signal: input.signal,
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
    signal?: AbortSignal | undefined;
  }): Promise<PublishedReviewRequest> {
    assertGitHub(input.target);

    const response = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls`,
      input.token,
      {
        method: "POST",
        signal: input.signal,
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
    const request = normalizeGitHubPr(pr, true, false, input.payload);

    await this.applyIssueMetadata({
      target: input.target,
      request,
      payload: input.payload,
      token: input.token,
      signal: input.signal,
    });

    return request;
  }

  public async update(input: {
    target: PublishTarget;
    requestNumber: string;
    update: ReviewRequestUpdate;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<PublishedReviewRequest> {
    assertGitHub(input.target);
    const update = ReviewRequestUpdateSchema.parse(input.update);

    const response = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls/${input.requestNumber}`,
      input.token,
      {
        method: "PATCH",
        signal: input.signal,
        body: JSON.stringify({
          title: update.title,
          body: update.body,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub update PR failed: ${response.status} ${await response.text()}`);
    }

    const pr = (await response.json()) as Record<string, unknown>;
    const request = normalizeGitHubPr(pr, false, true, {
      sourceBranch: String((pr["head"] as Record<string, unknown>)?.["ref"] ?? ""),
      targetBranch: String((pr["base"] as Record<string, unknown>)?.["ref"] ?? ""),
    });
    const labelsResponse = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/issues/${input.requestNumber}/labels`,
      input.token,
      {
        method: "PUT",
        signal: input.signal,
        body: JSON.stringify({ labels: update.labels }),
      },
    );
    if (!labelsResponse.ok) {
      throw new ReviewRequestSynchronizationError(
        `GitHub synchronize PR labels failed: ${labelsResponse.status} ${await labelsResponse.text()}`,
        "labels",
        request,
      );
    }

    return request;
  }

  public async publishAssets(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    assets: ReviewRequestAsset[];
    signal?: AbortSignal | undefined;
  }): Promise<PublishedReviewAsset[]> {
    assertGitHub(input.target);

    const published: PublishedReviewAsset[] = [];

    // Private repositories cannot render raw.githubusercontent.com images without
    // auth, so we detect visibility once and fall back to plain links for them.
    const isPrivate = await this.isPrivateRepo({
      target: input.target,
      token: input.token,
      signal: input.signal,
    });

    for (const asset of input.assets) {
      const assetPath = [
        ".spec-to-pr",
        asset.role === "e2e-video" ? "feature-evidence" : "visual-assets",
        input.payload.runId,
        safePathSegment(asset.targetId),
        asset.filename,
      ].join("/");
      const existingSha = await this.findContentSha({
        target: input.target,
        path: assetPath,
        branch: input.payload.sourceBranch,
        token: input.token,
        signal: input.signal,
      });
      const response = await this.githubFetch(
        `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/contents/${encodePath(assetPath)}`,
        input.token,
        {
          method: "PUT",
          signal: input.signal,
          body: JSON.stringify({
            message: `chore(spec-to-pr): publish review evidence ${asset.artifactId}`,
            content: asset.content.toString("base64"),
            branch: input.payload.sourceBranch,
            ...(existingSha === undefined ? {} : { sha: existingSha }),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `GitHub upload review asset failed: ${response.status} ${await response.text()}`,
        );
      }

      const uploaded = (await response.json()) as Record<string, unknown>;
      const content = uploaded["content"] as Record<string, unknown> | undefined;
      const commit = uploaded["commit"] as Record<string, unknown> | undefined;
      const commitSha = typeof commit?.["sha"] === "string" ? (commit["sha"] as string) : undefined;

      // Public repos: pin the raw URL to the commit SHA so it survives branch
      // deletion after merge. Private repos: raw URLs 404 for unauthenticated
      // camo fetches, so link to the viewable blob instead and mark it as
      // non-embeddable for the review-body renderer.
      const embeddable = !isPrivate && asset.role !== "e2e-video";
      const url = isPrivate
        ? String(content?.["html_url"] ?? content?.["download_url"] ?? "")
        : commitSha !== undefined
          ? `https://raw.githubusercontent.com/${input.target.owner}/${input.target.repo}/${commitSha}/${assetPath}`
          : String(content?.["download_url"] ?? content?.["html_url"] ?? "");

      published.push(
        PublishedReviewAssetSchema.parse({
          artifactId: asset.artifactId,
          targetId: asset.targetId,
          role: asset.role,
          label: asset.label,
          url,
          embeddable,
        }),
      );
    }

    return published;
  }

  private async isPrivateRepo(input: {
    target: PublishTarget & { owner: string; repo: string };
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<boolean> {
    const response = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}`,
      input.token,
      { method: "GET", signal: input.signal },
    );

    if (!response.ok) {
      // If we cannot determine visibility, assume private so we prefer the safe
      // link fallback over an image that might 404.
      return true;
    }

    const repo = (await response.json()) as Record<string, unknown>;

    return repo["private"] === true;
  }

  private async applyIssueMetadata(input: {
    target: PublishTarget & { owner: string; repo: string };
    request: PublishedReviewRequest;
    payload: ReviewRequestPayload;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<void> {
    if (input.payload.labels.length > 0) {
      const response = await this.githubFetch(
        `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/issues/${input.request.number}/labels`,
        input.token,
        {
          method: "POST",
          signal: input.signal,
          body: JSON.stringify({
            labels: input.payload.labels,
          }),
        },
      );
      if (!response.ok) {
        throw new ReviewRequestSynchronizationError(
          `GitHub synchronize PR labels failed: ${response.status} ${await response.text()}`,
          "labels",
          input.request,
        );
      }
    }

    if (input.payload.reviewers.length > 0) {
      const response = await this.githubFetch(
        `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/pulls/${input.request.number}/requested_reviewers`,
        input.token,
        {
          method: "POST",
          signal: input.signal,
          body: JSON.stringify({
            reviewers: input.payload.reviewers,
          }),
        },
      );
      if (!response.ok) {
        throw new ReviewRequestSynchronizationError(
          `GitHub synchronize PR reviewers failed: ${response.status} ${await response.text()}`,
          "reviewers",
          input.request,
        );
      }
    }
  }

  private async githubFetch(
    url: string,
    token: string,
    init: AbortableRequestInit,
  ): Promise<Response> {
    const { signal, ...requestInit } = init;
    return this.fetchImpl(url, {
      ...requestInit,
      ...(signal === undefined ? {} : { signal }),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...requestInit.headers,
      },
    });
  }

  private async findContentSha(input: {
    target: PublishTarget & { owner: string; repo: string };
    path: string;
    branch: string;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<string | undefined> {
    const url = new URL(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/contents/${encodePath(input.path)}`,
    );

    url.searchParams.set("ref", input.branch);

    const response = await this.githubFetch(url.toString(), input.token, {
      method: "GET",
      signal: input.signal,
    });

    if (response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error(
        `GitHub inspect visual asset failed: ${response.status} ${await response.text()}`,
      );
    }

    const body = (await response.json()) as Record<string, unknown>;
    const sha = body["sha"];

    return typeof sha === "string" && sha.length > 0 ? sha : undefined;
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

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

  return safe === "" ? "target" : safe;
}
