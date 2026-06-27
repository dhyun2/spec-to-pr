import os from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { RunService } from "../application/run-service.js";
import { StageService } from "../application/stage-service.js";
import type { RunStore } from "../store/run-store.js";

export type Services = {
  runService: RunService;
  stageService: StageService;
};

export type ServicesProvider = () => Promise<Services>;

export function createLazyServicesProvider(): ServicesProvider {
  let services: Services | undefined;

  return async () => {
    if (services !== undefined) {
      return services;
    }

    const { SqliteRunStore } = await import("../store/sqlite-run-store.js");

    const store: RunStore = new SqliteRunStore(resolveDatabasePath());

    services = {
      runService: new RunService(store, {
        pluginVersion: packageJson.version,
      }),
      stageService: new StageService(store),
    };

    return services;
  };
}

function resolveDatabasePath(): string {
  const dataDirectory =
    process.env.SPEC_TO_PR_DATA_DIR ?? path.join(os.tmpdir(), "spec-to-pr-plugin-data");

  return path.join(dataDirectory, "runs.sqlite3");
}
