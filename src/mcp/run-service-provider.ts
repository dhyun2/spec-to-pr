import os from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { BriefAdapterService } from "../application/brief-adapter-service.js";
import { PolicyService } from "../application/policy-service.js";
import { ProjectProfileService } from "../application/profile-service.js";
import { RunService } from "../application/run-service.js";
import { SourceRegistryService } from "../application/source-registry-service.js";
import { StageService } from "../application/stage-service.js";
import { JsonProfileStore } from "../profile/profile-store.js";
import { SourceSnapshotStore } from "../source-registry/snapshot-store.js";
import type { RunStore } from "../store/run-store.js";

export type Services = {
  runService: RunService;
  stageService: StageService;
  policyService: PolicyService;
  profileService: ProjectProfileService;
  sourceRegistryService: SourceRegistryService;
  briefAdapterService: BriefAdapterService;
};

export type ServicesProvider = () => Promise<Services>;

export function createLazyServicesProvider(): ServicesProvider {
  let services: Services | undefined;

  return async () => {
    if (services !== undefined) {
      return services;
    }

    const { SqliteRunStore } = await import("../store/sqlite-run-store.js");

    const dataDirectory = resolveDataDirectory();
    const store: RunStore = new SqliteRunStore(path.join(dataDirectory, "runs.sqlite3"));
    const snapshotStore = new SourceSnapshotStore(path.join(dataDirectory, "source-snapshots"));

    services = {
      runService: new RunService(store, {
        pluginVersion: packageJson.version,
      }),
      stageService: new StageService(store),
      policyService: new PolicyService(),
      profileService: new ProjectProfileService(
        new JsonProfileStore(path.join(dataDirectory, "profiles")),
      ),
      sourceRegistryService: new SourceRegistryService(store, snapshotStore),
      briefAdapterService: new BriefAdapterService(store, snapshotStore),
    };

    return services;
  };
}

function resolveDataDirectory(): string {
  return process.env.SPEC_TO_PR_DATA_DIR ?? path.join(os.tmpdir(), "spec-to-pr-plugin-data");
}
