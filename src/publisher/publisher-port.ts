import type {
  PublishedReviewRequest,
  PublishedReviewAsset,
  PublishTarget,
  ReviewRequestAssetRole,
  ReviewRequestPayload,
  ReviewRequestUpdate,
} from "./publish-contracts.js";

export type ReviewRequestAsset = {
  artifactId: string;
  artifactDigest: `sha256:${string}`;
  targetId: string;
  role: ReviewRequestAssetRole;
  label: string;
  filename: string;
  mediaType: string;
  content: Buffer;
  /**
   * Immutable on-branch source evidence used only when a GitLab project-upload
   * failure is eligible for the safe raw-file fallback. It is deliberately
   * absent for generated diffs and overlays.
   */
  evidence?: {
    projectRelativePath: string;
    digest: string;
    headSha?: string;
  };
};

export type ReviewAssetPublishOutcome =
  | { status: "published"; asset: PublishedReviewAsset }
  | {
      status: "failed";
      artifactId: string;
      failure: "transient" | "permanent" | "uncertain";
      message: string;
    };

export function classifyAssetUploadFailure(input: {
  status?: number;
  networkError?: boolean;
  responseMalformed?: boolean;
}): "transient" | "permanent" | "uncertain" {
  if (input.responseMalformed || input.networkError) return "uncertain";
  if (input.status === 408 || input.status === 429 || (input.status ?? 0) >= 500) {
    return "transient";
  }
  return "permanent";
}

export async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  requestedConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(
    1,
    Math.min(
      3,
      Number.isSafeInteger(requestedConcurrency) ? requestedConcurrency : 1,
      items.length,
    ),
  );
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]!, index);
      }
    }),
  );
  return results;
}

export type ReviewRequestSynchronizationPhase = "labels" | "reviewers";

export class ReviewRequestSynchronizationError extends Error {
  public override readonly name = "ReviewRequestSynchronizationError";

  public constructor(
    message: string,
    public readonly phase: ReviewRequestSynchronizationPhase,
    public readonly request: PublishedReviewRequest,
  ) {
    super(message);
  }
}

export interface ReviewRequestPublisher {
  findExisting(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    signal?: AbortSignal;
  }): Promise<PublishedReviewRequest | undefined>;

  create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    signal?: AbortSignal;
  }): Promise<PublishedReviewRequest>;

  update(input: {
    target: PublishTarget;
    requestNumber: string;
    update: ReviewRequestUpdate;
    token: string;
    signal?: AbortSignal;
  }): Promise<PublishedReviewRequest>;

  publishAssets(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    assets: ReviewRequestAsset[];
    maxConcurrency: number;
    signal?: AbortSignal;
  }): Promise<ReviewAssetPublishOutcome[]>;

  readBody?(input: {
    target: PublishTarget;
    requestNumber: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<string>;
}
