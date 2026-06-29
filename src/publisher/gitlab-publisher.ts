import {
  PublishedReviewAssetSchema,
  PublishedReviewRequestSchema,
  type PublishedReviewAsset,
  type PublishedReviewRequest,
  type PublishTarget,
  type ReviewRequestPayload,
} from "./publish-contracts.js";
import type { ReviewRequestAsset, ReviewRequestPublisher } from "./publisher-port.js";
import { encodeGitLabProjectId } from "./review-host.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class GitLabPublisherAdapter implements ReviewRequestPublisher {
  public constructor(private readonly fetchImpl: FetchLike = fetch) {}

  public async findExisting(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest | undefined> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const url = new URL(`${input.target.apiBaseUrl}/projects/${project}/merge_requests`);

    url.searchParams.set("source_branch", input.payload.sourceBranch);
    url.searchParams.set("target_branch", input.payload.targetBranch);
    url.searchParams.set("state", "opened");

    const response = await this.gitlabFetch(url.toString(), input.token, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`GitLab list MRs failed: ${response.status} ${await response.text()}`);
    }

    const mergeRequests = (await response.json()) as Array<Record<string, unknown>>;
    const first = mergeRequests[0];

    if (first === undefined) {
      return undefined;
    }

    return normalizeGitLabMr(first, false, true, input.payload);
  }

  public async create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const title =
      input.payload.mode === "draft" && !/^draft:/i.test(input.payload.title)
        ? `Draft: ${input.payload.title}`
        : input.payload.title;

    const response = await this.gitlabFetch(
      `${input.target.apiBaseUrl}/projects/${project}/merge_requests`,
      input.token,
      {
        method: "POST",
        body: JSON.stringify({
          source_branch: input.payload.sourceBranch,
          target_branch: input.payload.targetBranch,
          title,
          description: input.payload.body,
          labels: input.payload.labels.join(","),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitLab create MR failed: ${response.status} ${await response.text()}`);
    }

    const mr = (await response.json()) as Record<string, unknown>;

    return normalizeGitLabMr(mr, true, false, input.payload);
  }

  public async updateBody(input: {
    target: PublishTarget;
    requestNumber: string;
    body: string;
    token: string;
  }): Promise<PublishedReviewRequest> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const response = await this.gitlabFetch(
      `${input.target.apiBaseUrl}/projects/${project}/merge_requests/${input.requestNumber}`,
      input.token,
      {
        method: "PUT",
        body: JSON.stringify({
          description: input.body,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitLab update MR failed: ${response.status} ${await response.text()}`);
    }

    const mr = (await response.json()) as Record<string, unknown>;

    return normalizeGitLabMr(mr, false, true, {
      sourceBranch: String(mr["source_branch"] ?? ""),
      targetBranch: String(mr["target_branch"] ?? ""),
    });
  }

  public async publishAssets(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    assets: ReviewRequestAsset[];
  }): Promise<PublishedReviewAsset[]> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const published: PublishedReviewAsset[] = [];

    for (const asset of input.assets) {
      const form = new FormData();

      form.append("file", new Blob([asset.content], { type: asset.mediaType }), asset.filename);

      const response = await this.gitlabFetch(
        `${input.target.apiBaseUrl}/projects/${project}/uploads`,
        input.token,
        {
          method: "POST",
          body: form,
        },
      );

      if (!response.ok) {
        throw new Error(
          `GitLab upload visual asset failed: ${response.status} ${await response.text()}`,
        );
      }

      const uploaded = (await response.json()) as Record<string, unknown>;
      const rawUrl = String(uploaded["full_path"] ?? uploaded["url"] ?? "");

      published.push(
        PublishedReviewAssetSchema.parse({
          artifactId: asset.artifactId,
          targetId: asset.targetId,
          role: asset.role,
          label: asset.label,
          url: absoluteGitLabAssetUrl(input.target, rawUrl),
        }),
      );
    }

    return published;
  }

  private async gitlabFetch(url: string, token: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "PRIVATE-TOKEN": token,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers as Record<string, string> | undefined),
    };

    return this.fetchImpl(url, {
      ...init,
      headers,
    });
  }
}

function assertGitLab(target: PublishTarget): asserts target is PublishTarget & {
  projectPath: string;
} {
  if (
    target.host !== "gitlab" ||
    (target.projectPath === undefined && target.projectId === undefined)
  ) {
    throw new Error("Expected GitLab publish target");
  }
}

function normalizeGitLabMr(
  mr: Record<string, unknown>,
  created: boolean,
  updated: boolean,
  payload: Pick<ReviewRequestPayload, "sourceBranch" | "targetBranch">,
): PublishedReviewRequest {
  return PublishedReviewRequestSchema.parse({
    host: "gitlab",
    url: String(mr["web_url"]),
    number: String(mr["iid"]),
    id: String(mr["id"]),
    iid: String(mr["iid"]),
    draft: String(mr["title"] ?? "")
      .toLowerCase()
      .startsWith("draft:"),
    sourceBranch: payload.sourceBranch,
    targetBranch: payload.targetBranch,
    created,
    updated,
  });
}

function absoluteGitLabAssetUrl(target: PublishTarget, rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  return new URL(rawUrl, target.webBaseUrl).toString();
}
