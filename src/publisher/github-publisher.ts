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
import { GitObjectIdSchema } from "../runtime/scalars.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type AbortableRequestInit = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal | undefined;
};

export const GITHUB_EVIDENCE_BRANCH = "spec-to-pr/evidence" as const;
const GITHUB_EVIDENCE_REF = `refs/heads/${GITHUB_EVIDENCE_BRANCH}` as const;
const MAX_EVIDENCE_UPLOAD_ATTEMPTS = 3;

type ValidatedEvidenceRef = {
  ref: typeof GITHUB_EVIDENCE_REF;
  sha: string;
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
    if (input.payload.headSha === undefined || input.payload.reviewPacketId === undefined) {
      throw new Error(
        "EVIDENCE_REF_CONFLICT: review assets require a packet-bound head SHA and packet ID",
      );
    }

    const published: PublishedReviewAsset[] = [];

    // Private repositories cannot render raw.githubusercontent.com images without
    // auth, so we detect visibility once and fall back to plain links for them.
    const isPrivate = await this.isPrivateRepo({
      target: input.target,
      token: input.token,
      signal: input.signal,
    });
    const assetBranch = await this.ensureEvidenceBranch({
      target: input.target,
      payload: input.payload,
      token: input.token,
      signal: input.signal,
    });

    for (const asset of input.assets) {
      const assetPath = [
        ".spec-to-pr",
        asset.role === "e2e-video" ? "feature-evidence" : "visual-assets",
        input.payload.runId,
        input.payload.reviewPacketId,
        safePathSegment(asset.targetId),
        asset.artifactId,
        asset.filename,
      ].join("/");
      const response = await this.uploadEvidenceAsset({
        target: input.target,
        asset,
        assetPath,
        assetBranch,
        token: input.token,
        signal: input.signal,
      });

      const uploaded = (await response.json()) as Record<string, unknown>;
      const content = uploaded["content"] as Record<string, unknown> | undefined;
      const commit = uploaded["commit"] as Record<string, unknown> | undefined;
      const commitSha = GitObjectIdSchema.safeParse(commit?.["sha"]);
      if (!commitSha.success) {
        throw new Error("GitHub upload review asset did not return a valid commit SHA");
      }

      // Public repos: pin the raw URL to the commit SHA so it survives branch
      // deletion after merge. Private repos: raw URLs 404 for unauthenticated
      // camo fetches, so link to the viewable blob instead and mark it as
      // non-embeddable for the review-body renderer.
      const embeddable = !isPrivate && asset.role !== "e2e-video";
      const url = isPrivate
        ? `${input.target.webBaseUrl}/${input.target.owner}/${input.target.repo}/blob/${commitSha.data}/${assetPath}`
        : `https://raw.githubusercontent.com/${input.target.owner}/${input.target.repo}/${commitSha.data}/${assetPath}`;
      void content;

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

  private async ensureEvidenceBranch(input: {
    target: PublishTarget & { owner: string; repo: string };
    payload: ReviewRequestPayload;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<typeof GITHUB_EVIDENCE_BRANCH> {
    if (input.payload.headSha === undefined) {
      throw new Error("EVIDENCE_REF_CONFLICT: evidence branch requires a reviewed head SHA");
    }
    const existing = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/git/ref/heads/${encodePath(GITHUB_EVIDENCE_BRANCH)}`,
      input.token,
      { method: "GET", signal: input.signal },
    );
    if (existing.ok) {
      validateEvidenceRef(await existing.json());
      return GITHUB_EVIDENCE_BRANCH;
    }
    if (existing.status !== 404) {
      throw new Error(
        `GitHub inspect evidence ref failed: ${existing.status} ${await existing.text()}`,
      );
    }
    const created = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/git/refs`,
      input.token,
      {
        method: "POST",
        signal: input.signal,
        body: JSON.stringify({
          ref: GITHUB_EVIDENCE_REF,
          sha: input.payload.headSha,
        }),
      },
    );
    if (created.ok) {
      validateEvidenceRef(await created.json());
      return GITHUB_EVIDENCE_BRANCH;
    }
    if (created.status !== 422) {
      throw new Error(
        `GitHub create evidence ref failed: ${created.status} ${await created.text()}`,
      );
    }
    const winner = await this.githubFetch(
      `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/git/ref/heads/${encodePath(GITHUB_EVIDENCE_BRANCH)}`,
      input.token,
      { method: "GET", signal: input.signal },
    );
    if (!winner.ok) {
      throw new Error(
        `EVIDENCE_REF_CONFLICT: create raced but the managed ref is unavailable (${winner.status})`,
      );
    }
    validateEvidenceRef(await winner.json());
    return GITHUB_EVIDENCE_BRANCH;
  }

  private async uploadEvidenceAsset(input: {
    target: PublishTarget & { owner: string; repo: string };
    asset: ReviewRequestAsset;
    assetPath: string;
    assetBranch: typeof GITHUB_EVIDENCE_BRANCH;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_EVIDENCE_UPLOAD_ATTEMPTS; attempt += 1) {
      const existingSha = await this.findContentSha({
        target: input.target,
        path: input.assetPath,
        branch: input.assetBranch,
        token: input.token,
        signal: input.signal,
      });
      const response = await this.githubFetch(
        `${input.target.apiBaseUrl}/repos/${input.target.owner}/${input.target.repo}/contents/${encodePath(input.assetPath)}`,
        input.token,
        {
          method: "PUT",
          signal: input.signal,
          body: JSON.stringify({
            message: `chore(spec-to-pr): publish review evidence ${input.asset.artifactId}`,
            content: input.asset.content.toString("base64"),
            branch: input.assetBranch,
            ...(existingSha === undefined ? {} : { sha: existingSha }),
          }),
        },
      );
      if (response.ok) return response;
      if (response.status === 409 && attempt < MAX_EVIDENCE_UPLOAD_ATTEMPTS) continue;
      throw new Error(
        `GitHub upload review asset failed: ${response.status} ${await response.text()}`,
      );
    }
    throw new Error("GitHub upload review asset failed after bounded conflict retries");
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

function validateEvidenceRef(raw: unknown): ValidatedEvidenceRef {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("EVIDENCE_REF_CONFLICT: managed evidence ref response is malformed");
  }
  const ref = raw as Record<string, unknown>;
  const object = ref["object"];
  if (typeof object !== "object" || object === null) {
    throw new Error("EVIDENCE_REF_CONFLICT: managed evidence ref has no Git object");
  }
  const gitObject = object as Record<string, unknown>;
  const sha = GitObjectIdSchema.safeParse(gitObject["sha"]);
  if (ref["ref"] !== GITHUB_EVIDENCE_REF || gitObject["type"] !== "commit" || !sha.success) {
    throw new Error("EVIDENCE_REF_CONFLICT: managed evidence ref is not the expected commit ref");
  }
  return { ref: GITHUB_EVIDENCE_REF, sha: sha.data };
}
