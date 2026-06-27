import type { RunId } from "../runtime/ids.js";

export class RunStoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class RunAlreadyExistsError extends RunStoreError {
  public constructor(runId: RunId) {
    super(`Run already exists: ${runId}`);
  }
}

export class RunNotFoundError extends RunStoreError {
  public constructor(runId: RunId) {
    super(`Run not found: ${runId}`);
  }
}

export class RevisionConflictError extends RunStoreError {
  public constructor(
    runId: RunId,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`Revision conflict for ${runId}: expected ${expectedRevision}, actual ${actualRevision}`);
  }
}
