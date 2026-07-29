import os from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../application/intake-request-service.js";
import { OpenSpecArchiveService } from "../application/openspec-archive-service.js";
import { PublisherService } from "../application/publisher-service.js";
import { RunService } from "../application/run-service.js";
import { StageService } from "../application/stage-service.js";
import { WorkflowService } from "../application/workflow-service.js";
import { SourceSnapshotStore } from "../source-registry/snapshot-store.js";
import { SqliteRunStore } from "../store/sqlite-run-store.js";
import { RuntimeMetricsRecorder } from "../runtime/performance-instrumentation.js";

export type Services = {
  workflowService: WorkflowService;
  metrics: RuntimeMetricsRecorder;
};

export type ServicesProvider = () => Promise<Services>;

export function createLazyServicesProvider(): ServicesProvider {
  let services: Services | undefined;

  return async () => {
    if (services !== undefined) {
      return services;
    }

    const dataDirectory = resolveDataDirectory();
    const metrics = new RuntimeMetricsRecorder();
    const runStore = new SqliteRunStore(path.join(dataDirectory, "runs.sqlite3"), metrics);
    const artifactStore = new ArtifactBlobStore(path.join(dataDirectory, "artifacts"), metrics);
    const runService = new RunService(runStore, { pluginVersion: packageJson.version });
    const intakeRequestService = new IntakeRequestService(
      runStore,
      new SourceSnapshotStore(path.join(dataDirectory, "source-snapshots")),
      artifactStore,
    );
    const stageService = new StageService(runStore, undefined, metrics);
    const publisherService = new PublisherService(
      runStore,
      artifactStore,
      undefined,
      undefined,
      undefined,
      metrics,
    );
    const archiveService = new OpenSpecArchiveService(runStore, artifactStore);

    services = {
      workflowService: new WorkflowService({
        runStore,
        artifactStore,
        runService,
        intakeRequestService,
        stageService,
        publisherService,
        archiveService,
        metrics,
      }),
      metrics,
    };

    return services;
  };
}

function resolveDataDirectory(): string {
  return process.env.SPEC_TO_PR_DATA_DIR ?? path.join(os.tmpdir(), "spec-to-pr-plugin-data");
}
