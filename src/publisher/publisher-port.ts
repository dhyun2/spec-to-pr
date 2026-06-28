import type {
  PublishedReviewRequest,
  PublishTarget,
  ReviewRequestPayload,
} from "./publish-contracts.js";

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
}
