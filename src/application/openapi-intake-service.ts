import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { OpenApiAnalysisResultSchema } from "../openapi/openapi-analysis.js";
import { detectOpenApiGapCandidates } from "../openapi/openapi-gaps.js";
import { buildOpenApiInventory } from "../openapi/openapi-inventory.js";
import { parseOpenApiDocument } from "../openapi/openapi-parser.js";
import { RunManifestSchema } from "../run/index.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { GapSchema, type Gap } from "../runtime/gap.js";
import { createArtifactId, createEvidenceId, createGapId } from "../runtime/id-factory.js";
import { RunIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema, type Sha256Digest } from "../runtime/scalars.js";
import { EvidenceRefSchema, type EvidenceRef, type SourceRef } from "../runtime/source.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { SourceSnapshotStore } from "../source-registry/snapshot-store.js";
import type { RunStore } from "../store/run-store.js";

export const AnalyzeOpenApiSourceInputSchema = z
  .object({
    runId: RunIdSchema,
    sourceId: SourceIdSchema,
  })
  .strict();

const OPENAPI_INTAKE_ADAPTER = "openapi-intake-v1" as const;

export class OpenApiIntakeService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly sourceSnapshotStore: SourceSnapshotStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async analyzeOpenApiSource(rawInput: unknown) {
    const input = AnalyzeOpenApiSourceInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const source = findOpenApiSource(run.sources, input.sourceId);
    const sourceDigest = requireSourceDigest(source);

    const existingArtifact = run.artifacts.find(
      (artifact) =>
        artifact.metadata["adapter"] === OPENAPI_INTAKE_ADAPTER &&
        artifact.metadata["sourceId"] === source.id &&
        artifact.metadata["sourceDigest"] === sourceDigest &&
        artifact.kind === "openapi-intake-report",
    );

    if (existingArtifact !== undefined) {
      const inventory = existingArtifact.metadata["inventory"];

      if (typeof inventory === "object" && inventory !== null) {
        return OpenApiAnalysisResultSchema.parse({
          duplicate: true,
          sourceId: source.id,
          sourceDigest,
          versionKind: String(existingArtifact.metadata["versionKind"] ?? "unknown"),
          ...optionalMetadataString(existingArtifact.metadata["version"], "version"),
          operationCount: Number(existingArtifact.metadata["operationCount"] ?? 0),
          schemaCount: Number(existingArtifact.metadata["schemaCount"] ?? 0),
          securitySchemeCount: Number(existingArtifact.metadata["securitySchemeCount"] ?? 0),
          refCount: Number(existingArtifact.metadata["refCount"] ?? 0),
          evidenceAdded: 0,
          gapsAdded: 0,
          artifactIds: [existingArtifact.id],
          evidenceIds: [],
          gapIds: [],
          inventory,
        });
      }
    }

    if (source.locator.type !== "file") {
      throw new Error("Task 12 only supports file-based OpenAPI sources");
    }

    const sourcePath = source.locator.path;
    const sourceMediaType = source.locator.mediaType;
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const snapshotContent = await this.sourceSnapshotStore.readContent(sourceDigest);

    const parsed = parseOpenApiDocument({
      content: snapshotContent,
      path: sourcePath,
      ...(sourceMediaType === undefined ? {} : { mediaType: sourceMediaType }),
    });

    const inventory = buildOpenApiInventory(parsed);
    const gapCandidates = detectOpenApiGapCandidates({ parsed, inventory });

    const normalizedDocumentBuffer = Buffer.from(
      `${JSON.stringify(parsed.document, null, 2)}\n`,
      "utf8",
    );
    const inventoryBuffer = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`, "utf8");

    const normalizedBlob = await this.artifactStore.writeBlob({
      content: normalizedDocumentBuffer,
      mediaType: "application/json",
      storedAt: timestamp,
      label: "openapi-normalized-document",
    });

    const inventoryBlob = await this.artifactStore.writeBlob({
      content: inventoryBuffer,
      mediaType: "application/json",
      storedAt: timestamp,
      label: "openapi-intake-report",
    });

    const operationEvidence = inventory.operations.map((operation) =>
      EvidenceRefSchema.parse({
        id: createEvidenceId(),
        sourceId: source.id,
        location: {
          type: "json-pointer",
          document: sourcePath,
          pointer: operation.pointer,
        },
        summary: `${operation.method.toUpperCase()} ${operation.path}${
          operation.operationId === undefined ? "" : ` (${operation.operationId})`
        }`,
        digest: sha256Digest(Buffer.from(JSON.stringify(operation), "utf8")),
        capturedAt: timestamp,
        metadata: {
          adapter: OPENAPI_INTAKE_ADAPTER,
          sourceDigest,
          evidenceType: "openapi-operation",
          method: operation.method,
          path: operation.path,
          pointer: operation.pointer,
          ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
        },
      }),
    );

    const schemaEvidence = inventory.schemas.map((schema) =>
      EvidenceRefSchema.parse({
        id: createEvidenceId(),
        sourceId: source.id,
        location: {
          type: "json-pointer",
          document: sourcePath,
          pointer: schema.pointer,
        },
        summary: `Schema ${schema.name}`,
        digest: sha256Digest(Buffer.from(JSON.stringify(schema), "utf8")),
        capturedAt: timestamp,
        metadata: {
          adapter: OPENAPI_INTAKE_ADAPTER,
          sourceDigest,
          evidenceType: "openapi-schema",
          schemaName: schema.name,
          pointer: schema.pointer,
        },
      }),
    );

    const evidenceToAdd: EvidenceRef[] = [...operationEvidence, ...schemaEvidence];

    const gapsToAdd: Gap[] = gapCandidates.map((candidate) => {
      const matchingEvidence =
        candidate.operationPointer === undefined
          ? undefined
          : operationEvidence.find(
              (evidence) => evidence.metadata["pointer"] === candidate.operationPointer,
            );

      return GapSchema.parse({
        id: createGapId(),
        category: candidate.category,
        severity: candidate.severity,
        status: "open",
        title: candidate.title,
        expected: candidate.expected,
        observed: candidate.observed,
        impact: candidate.impact,
        sourceEvidenceIds: matchingEvidence === undefined ? [] : [matchingEvidence.id],
        owner: candidate.category === "security" ? "evidence-verifier" : "api-contract",
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
          adapter: OPENAPI_INTAKE_ADAPTER,
          sourceId: source.id,
          sourceDigest,
          code: candidate.code,
          ...(candidate.pointer === undefined ? {} : { pointer: candidate.pointer }),
        },
      });
    });

    const normalizedArtifact = createOpenApiArtifact({
      kind: "openapi-normalized-document",
      uri: normalizedBlob.uri,
      digest: normalizedBlob.digest,
      timestamp,
      source,
      sourceDigest,
    });

    const inventoryArtifact = createOpenApiArtifact({
      kind: "openapi-intake-report",
      uri: inventoryBlob.uri,
      digest: inventoryBlob.digest,
      timestamp,
      source,
      sourceDigest,
      metadata: {
        inventory,
        versionKind: parsed.versionKind,
        ...(parsed.version === undefined ? {} : { version: parsed.version }),
        operationCount: inventory.operationCount,
        schemaCount: inventory.schemaCount,
        securitySchemeCount: inventory.securitySchemeCount,
        refCount: inventory.refCount,
      },
    });

    const artifactsToAdd: ArtifactRef[] = [normalizedArtifact, inventoryArtifact];

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      evidence: [...run.evidence, ...evidenceToAdd],
      artifacts: [...run.artifacts, ...artifactsToAdd],
      gaps: [...run.gaps, ...gapsToAdd],
    });

    await this.runStore.save(nextRun, run.revision);

    return OpenApiAnalysisResultSchema.parse({
      duplicate: false,
      sourceId: source.id,
      sourceDigest,
      versionKind: parsed.versionKind,
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      operationCount: inventory.operationCount,
      schemaCount: inventory.schemaCount,
      securitySchemeCount: inventory.securitySchemeCount,
      refCount: inventory.refCount,
      evidenceAdded: evidenceToAdd.length,
      gapsAdded: gapsToAdd.length,
      artifactIds: artifactsToAdd.map((artifact) => artifact.id),
      evidenceIds: evidenceToAdd.map((evidence) => evidence.id),
      gapIds: gapsToAdd.map((gap) => gap.id),
      inventory,
    });
  }
}

function findOpenApiSource(sources: SourceRef[], sourceId: string): SourceRef {
  const source = sources.find((item) => item.id === sourceId);

  if (source === undefined) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  if (source.kind !== "openapi") {
    throw new Error(`Source is not an OpenAPI source: ${sourceId}`);
  }

  return source;
}

function requireSourceDigest(source: SourceRef): Sha256Digest {
  if (source.digest === undefined) {
    throw new Error(`OpenAPI source has no digest: ${source.id}`);
  }

  return source.digest;
}

function createOpenApiArtifact(input: {
  kind: "openapi-normalized-document" | "openapi-intake-report";
  uri: string;
  digest: string;
  timestamp: string;
  source: SourceRef;
  sourceDigest: string;
  metadata?: Record<string, unknown>;
}): ArtifactRef {
  return ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: input.kind,
    uri: input.uri,
    mediaType: "application/json",
    digest: input.digest,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: input.timestamp,
    metadata: {
      adapter: OPENAPI_INTAKE_ADAPTER,
      sourceId: input.source.id,
      sourceDigest: input.sourceDigest,
      ...input.metadata,
    },
  });
}

function optionalMetadataString(value: unknown, key: string): Record<string, string> {
  return typeof value === "string" ? { [key]: value } : {};
}
