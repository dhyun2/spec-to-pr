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
  targetId: string;
  role: ReviewRequestAssetRole;
  label: string;
  filename: string;
  mediaType: string;
  content: Buffer;
};

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
    signal?: AbortSignal;
  }): Promise<PublishedReviewAsset[]>;
}
