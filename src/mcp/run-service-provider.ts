import os from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { RunService } from "../application/run-service.js";
import type { RunStore } from "../store/run-store.js";

export type RunServiceProvider = () => Promise<RunService>;

export function createLazyRunServiceProvider(): RunServiceProvider {
  let service: RunService | undefined;
  let store: RunStore | undefined;

  return async () => {
    if (service !== undefined) {
      return service;
    }

    const { SqliteRunStore } = await import("../store/sqlite-run-store.js");

    store = new SqliteRunStore(resolveDatabasePath());

    service = new RunService(store, {
      pluginVersion: packageJson.version,
    });

    return service;
  };
}

function resolveDatabasePath(): string {
  const dataDirectory =
    process.env.SPEC_TO_PR_DATA_DIR ?? path.join(os.tmpdir(), "spec-to-pr-plugin-data");

  return path.join(dataDirectory, "runs.sqlite3");
}
