import type { RunManifest, RunStatus, RunSummary } from "../run/index.js";
import type { RunId } from "../runtime/ids.js";

export type ListRunsFilter = {
  status?: RunStatus;
  limit?: number;
};

export interface RunStore {
  create(run: RunManifest): Promise<void>;

  get(runId: RunId): Promise<RunManifest>;

  save(run: RunManifest, expectedRevision: number): Promise<void>;

  list(filter?: ListRunsFilter): Promise<RunSummary[]>;

  close(): Promise<void>;
}
