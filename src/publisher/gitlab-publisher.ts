import {
  PublishedReviewRequestSchema,
  type PublishedReviewRequest,
  type PublishTarget,
  type ReviewRequestPayload,
} from "./publish-contracts.js";
import type { ReviewRequestPublisher } from "./publisher-port.js";
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

  private async gitlabFetch(url: string, token: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        ...init.headers,
      },
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
