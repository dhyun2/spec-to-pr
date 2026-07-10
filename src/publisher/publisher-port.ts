import type {
  PublishedReviewRequest,
  PublishedReviewAsset,
  PublishTarget,
  ReviewRequestAssetRole,
  ReviewRequestPayload,
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

export interface ReviewRequestPublisher {
  findExisting(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest | undefined>;

  create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest>;

  updateBody(input: {
    target: PublishTarget;
    requestNumber: string;
    body: string;
    token: string;
  }): Promise<PublishedReviewRequest>;

  publishAssets(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
    assets: ReviewRequestAsset[];
  }): Promise<PublishedReviewAsset[]>;
}
