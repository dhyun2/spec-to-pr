import {
  PublishedReviewAssetSchema,
  PublishedReviewRequestSchema,
  ReviewRequestUpdateSchema,
  type PublishedReviewRequest,
  type PublishTarget,
  type ReviewRequestPayload,
  type ReviewRequestUpdate,
} from "./publish-contracts.js";
import {
  classifyAssetUploadFailure,
  mapWithBoundedConcurrency,
  type ReviewAssetPublishOutcome,
  type ReviewRequestAsset,
  type ReviewRequestPublisher,
} from "./publisher-port.js";
import { encodeGitLabProjectId } from "./review-host.js";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type AbortableRequestInit = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal | undefined;
};

/**
 * An upload-only failure. The application layer uses this type to distinguish
 * a project-upload outage from a create/update MR failure; only the former can
 * fall back to already-committed, digest-verified evidence files.
 */
export class GitLabAssetUploadError extends Error {
  public override readonly name = "GitLabAssetUploadError";

  public constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export function canUseGitLabRawEvidenceFallback(error: unknown): boolean {
  if (!(error instanceof GitLabAssetUploadError)) return false;
  if (error.status === undefined) return true;

  return (
    error.status === 401 ||
    error.status === 403 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export class GitLabPublisherAdapter implements ReviewRequestPublisher {
  public constructor(private readonly fetchImpl: FetchLike = fetch) {}

  public async findExisting(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<PublishedReviewRequest | undefined> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const url = new URL(`${input.target.apiBaseUrl}/projects/${project}/merge_requests`);

    url.searchParams.set("source_branch", input.payload.sourceBranch);
    url.searchParams.set("target_branch", input.payload.targetBranch);
    url.searchParams.set("state", "opened");

    const response = await this.gitlabFetch(url.toString(), input.token, {
      method: "GET",
      signal: input.signal,
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
    signal?: AbortSignal | undefined;
  }): Promise<PublishedReviewRequest> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const title = draftTitle(input.payload.title);

    const response = await this.gitlabFetch(
      `${input.target.apiBaseUrl}/projects/${project}/merge_requests`,
      input.token,
      {
        method: "POST",
        signal: input.signal,
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

  public async update(input: {
    target: PublishTarget;
    requestNumber: string;
    update: ReviewRequestUpdate;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<PublishedReviewRequest> {
    assertGitLab(input.target);
    const update = ReviewRequestUpdateSchema.parse(input.update);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const response = await this.gitlabFetch(
      `${input.target.apiBaseUrl}/projects/${project}/merge_requests/${input.requestNumber}`,
      input.token,
      {
        method: "PUT",
        signal: input.signal,
        body: JSON.stringify({
          title: draftTitle(update.title),
          description: update.body,
          labels: update.labels.join(","),
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
    maxConcurrency: number;
    signal?: AbortSignal | undefined;
  }): Promise<ReviewAssetPublishOutcome[]> {
    assertGitLab(input.target);

    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    return mapWithBoundedConcurrency(input.assets, input.maxConcurrency, async (asset) => {
      const form = new FormData();

      form.append("file", new Blob([asset.content], { type: asset.mediaType }), asset.filename);

      let response: Response;
      try {
        response = await this.gitlabFetch(
          `${input.target.apiBaseUrl}/projects/${project}/uploads`,
          input.token,
          {
            method: "POST",
            signal: input.signal,
            body: form,
          },
        );
      } catch {
        return {
          status: "failed",
          artifactId: asset.artifactId,
          failure: classifyAssetUploadFailure({ networkError: true }),
          message: "GitLab upload review asset network failure",
        };
      }

      if (!response.ok) {
        return {
          status: "failed",
          artifactId: asset.artifactId,
          failure: classifyAssetUploadFailure({ status: response.status }),
          message: `GitLab upload review asset failed with HTTP ${response.status}`,
        };
      }

      let uploaded: Record<string, unknown>;
      try {
        const body = await response.json();
        if (typeof body !== "object" || body === null) throw new Error("malformed");
        uploaded = body as Record<string, unknown>;
      } catch {
        return {
          status: "failed",
          artifactId: asset.artifactId,
          failure: classifyAssetUploadFailure({ responseMalformed: true }),
          message: "GitLab upload review asset returned a malformed response",
        };
      }
      // GitLab uploads are project-scoped. `full_path` already includes the
      // /{namespace}/{project}/uploads/... prefix; `url` is project-relative
      // (/uploads/...). Both render inside the MR description because GitLab
      // resolves them against the project. We keep the RELATIVE path and never
      // prefix the instance root, which would drop the project path and 404.
      const uploadPath =
        projectRelativeUploadPath(uploaded["full_path"]) ??
        projectRelativeUploadPath(uploaded["url"]);
      if (uploadPath === undefined) {
        return {
          status: "failed",
          artifactId: asset.artifactId,
          failure: classifyAssetUploadFailure({ responseMalformed: true }),
          message: "GitLab upload review asset returned a malformed response",
        };
      }

      return {
        status: "published",
        asset: PublishedReviewAssetSchema.parse({
          artifactId: asset.artifactId,
          artifactDigest: asset.artifactDigest,
          targetId: asset.targetId,
          role: asset.role,
          label: asset.label,
          url: uploadPath,
          embeddable: asset.role !== "e2e-video",
        }),
      } satisfies ReviewAssetPublishOutcome;
    });
  }

  public async readBody(input: {
    target: PublishTarget;
    requestNumber: string;
    token: string;
    signal?: AbortSignal | undefined;
  }): Promise<string> {
    assertGitLab(input.target);
    const project = encodeGitLabProjectId(input.target.projectId ?? input.target.projectPath);
    const response = await this.gitlabFetch(
      `${input.target.apiBaseUrl}/projects/${project}/merge_requests/${input.requestNumber}`,
      input.token,
      { method: "GET", signal: input.signal },
    );
    if (!response.ok) {
      throw new Error(`GitLab read MR body failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body["description"] !== "string") {
      throw new Error("GitLab read MR body returned a malformed response");
    }
    return body["description"];
  }

  private async gitlabFetch(
    url: string,
    token: string,
    init: AbortableRequestInit,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "PRIVATE-TOKEN": token,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers as Record<string, string> | undefined),
    };

    const { signal, ...requestInit } = init;
    return this.fetchImpl(url, {
      ...requestInit,
      ...(signal === undefined ? {} : { signal }),
      headers,
    });
  }
}

function draftTitle(title: string): string {
  return /^draft:/i.test(title) ? title : `Draft: ${title}`;
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

function projectRelativeUploadPath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f\s]/u.test(value)
  ) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  const segments = decoded.split("/");
  const uploadsIndex = segments.lastIndexOf("uploads");
  if (
    segments.some((segment) => segment === "..") ||
    uploadsIndex < 1 ||
    segments.slice(uploadsIndex + 1).filter((segment) => segment.length > 0).length < 2
  ) {
    return undefined;
  }
  return value;
}
