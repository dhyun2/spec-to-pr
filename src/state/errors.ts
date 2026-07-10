import type { RunStageName } from "../run/stages.js";

export class StageStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class StageNotFoundError extends StageStateError {
  public constructor(stageName: RunStageName) {
    super(`Stage not found: ${stageName}`);
  }
}

export class InvalidStageTransitionError extends StageStateError {
  public constructor(
    public readonly stageName: RunStageName,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid transition for ${stageName}: ${from} -> ${to}`);
  }
}

export class StageLeaseMismatchError extends StageStateError {
  public constructor(stageName: RunStageName) {
    super(`Lease mismatch for stage ${stageName}`);
  }
}

export class StageLeaseExpiredError extends StageStateError {
  public constructor(stageName: RunStageName) {
    super(`Lease expired for stage ${stageName}`);
  }
}

export class StageRetryExhaustedError extends StageStateError {
  public constructor(stageName: RunStageName) {
    super(`Retry attempts exhausted for stage ${stageName}`);
  }
}
