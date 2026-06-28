import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { ApiPipelineService } from "../../src/application/api-pipeline-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let service: ApiPipelineService;

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const sourceDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-api-pipeline-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(dataRoot, "artifacts"));
  service = new ApiPipelineService(store, artifactStore, () => now);
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("ApiPipelineService", () => {
  it("writes fallback generated files and records report artifacts", async () => {
    const run = createInitialRun(
      { sources: [] },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot,
        now,
      },
    );

    const normalizedBlob = await artifactStore.writeBlob({
      content: Buffer.from(
        `${JSON.stringify(
          {
            openapi: "3.1.0",
            components: {
              schemas: {
                Reservation: {
                  type: "object",
                  required: ["reserveNo"],
                  properties: {
                    reserveNo: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      mediaType: "application/json",
      storedAt: now,
      label: "openapi-normalized-document",
    });

    const inventory = {
      version: "3.1.0",
      versionKind: "openapi",
      operationCount: 1,
      schemaCount: 1,
      securitySchemeCount: 0,
      refCount: 0,
      operations: [
        {
          method: "get",
          path: "/reservations",
          pointer: "/paths/~1reservations/get",
          operationId: "fetchReservations",
          tags: [],
          requestContentTypes: [],
          responseStatuses: ["200"],
          responseContentTypes: ["application/json"],
          securitySchemeNames: [],
        },
      ],
      schemas: [
        {
          name: "Reservation",
          pointer: "/components/schemas/Reservation",
          type: "object",
          hasRef: false,
        },
      ],
      securitySchemes: [],
      refs: [],
    };

    const inventoryBlob = await artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: now,
      label: "openapi-intake-report",
    });

    const normalizedArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "openapi-normalized-document",
      uri: normalizedBlob.uri,
      mediaType: "application/json",
      digest: normalizedBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: now,
      metadata: {
        adapter: "openapi-intake-v1",
        sourceDigest,
      },
    });

    const inventoryArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "openapi-intake-report",
      uri: inventoryBlob.uri,
      mediaType: "application/json",
      digest: inventoryBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: now,
      metadata: {
        adapter: "openapi-intake-v1",
        sourceDigest,
        inventory,
      },
    });

    await store.create({
      ...run,
      artifacts: [normalizedArtifact, inventoryArtifact],
    });

    const result = await service.generate({
      runId: run.id,
      openApiIntakeArtifactId: inventoryArtifact.id,
      sourceKey: "staff",
    });

    expect(result.duplicate).toBe(false);
    expect(result.mode).toBe("fallback-generator");
    expect(result.generatedFiles).toContain("src/shared/api/generated/staff/types.ts");
    expect(result.generatedFiles).toContain("src/features/reservations/api/fetch-reservations.ts");

    const schemaContent = await readFile(
      path.join(projectRoot, "src", "shared", "api", "generated", "staff", "schemas.ts"),
      "utf8",
    );

    expect(schemaContent).toContain("ReservationSchema");

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "api-contract-report")).toBe(true);
    expect(loaded.artifacts.some((artifact) => artifact.kind === "generated-code")).toBe(true);
  });
});
