import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  figmaKindToArtifactKind,
  FigmaIntakeResultSchema,
  FigmaRecordedArtifactKindSchema,
  type FigmaRecordedArtifactKind,
} from "../figma/figma-intake-contracts.js";
import { parseFigmaUrl } from "../figma/figma-url.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId, createEvidenceId, createSourceId } from "../runtime/id-factory.js";
import { RunIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import {
  EvidenceRefSchema,
  SourceRefSchema,
  type EvidenceRef,
  type SourceRef,
} from "../runtime/source.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RunStore } from "../store/run-store.js";

export const RegisterFigmaSourceInputSchema = z
  .object({
    runId: RunIdSchema,
    url: z.string().url(),
    label: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const BaseRecordFigmaInputSchema = z
  .object({
    runId: RunIdSchema,
    sourceId: SourceIdSchema,
    providerId: z.string().trim().min(1).optional(),
  })
  .strict();

export const RecordFigmaTextArtifactInputSchema = BaseRecordFigmaInputSchema.extend({
  kind: FigmaRecordedArtifactKindSchema.exclude(["screenshot"]),
  content: z.string().min(1),
  mediaType: z.string().trim().min(1).default("text/plain"),
}).strict();

export const RecordFigmaScreenshotInputSchema = BaseRecordFigmaInputSchema.extend({
  imageBase64: z.string().min(1),
  mediaType: z.string().trim().min(1).default("image/png"),
}).strict();

const FIGMA_INTAKE_ADAPTER = "figma-intake-v1" as const;

export class FigmaIntakeService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async registerFigmaSource(rawInput: unknown) {
    const input = RegisterFigmaSourceInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const parsed = parseFigmaUrl(input.url);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const locatorDigest = sha256Digest(
      Buffer.from(
        JSON.stringify({
          type: "figma",
          fileKey: parsed.fileKey,
          nodeId: parsed.nodeId,
          canonicalUrl: parsed.canonicalUrl,
        }),
        "utf8",
      ),
    );

    const existing = run.sources.find(
      (source) =>
        source.kind === "figma" &&
        source.locator.type === "figma" &&
        source.locator.fileKey === parsed.fileKey &&
        source.locator.nodeId === parsed.nodeId &&
        source.digest === locatorDigest,
    );

    if (existing !== undefined) {
      return {
        duplicate: true,
        run: summarizeRun(run),
        source: existing,
      };
    }

    const source = SourceRefSchema.parse({
      id: createSourceId(),
      kind: "figma",
      locator: {
        type: "figma",
        url: parsed.canonicalUrl,
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
      },
      digest: locatorDigest,
      capturedAt: timestamp,
      metadata: {
        adapter: FIGMA_INTAKE_ADAPTER,
        rawUrl: parsed.rawUrl,
        canonicalUrl: parsed.canonicalUrl,
        figmaKind: parsed.kind,
        ...(input.label === undefined ? {} : { label: input.label }),
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      sources: [...run.sources, source],
    });

    await this.runStore.save(nextRun, run.revision);

    return {
      duplicate: false,
      run: summarizeRun(nextRun),
      source,
    };
  }

  public async recordTextArtifact(rawInput: unknown) {
    const input = RecordFigmaTextArtifactInputSchema.parse(rawInput);

    return this.recordArtifact({
      runId: input.runId,
      sourceId: input.sourceId,
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      kind: input.kind,
      content: Buffer.from(input.content, "utf8"),
      mediaType: input.mediaType,
      label: `figma-${input.kind}`,
    });
  }

  public async recordScreenshot(rawInput: unknown) {
    const input = RecordFigmaScreenshotInputSchema.parse(rawInput);

    return this.recordArtifact({
      runId: input.runId,
      sourceId: input.sourceId,
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      kind: "screenshot",
      content: decodeBase64(input.imageBase64),
      mediaType: input.mediaType,
      label: "figma-screenshot",
    });
  }

  private async recordArtifact(input: {
    runId: string;
    sourceId: string;
    providerId?: string;
    kind: FigmaRecordedArtifactKind;
    content: Buffer;
    mediaType: string;
    label: string;
  }) {
    const run = await this.runStore.get(RunIdSchema.parse(input.runId));
    const source = findFigmaSource(run.sources, input.sourceId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const providerId = input.providerId ?? "unknown";
    const contentDigest = sha256Digest(input.content);

    const duplicate = run.artifacts.find(
      (artifact) =>
        artifact.digest === contentDigest &&
        artifact.metadata["adapter"] === FIGMA_INTAKE_ADAPTER &&
        artifact.metadata["sourceId"] === source.id &&
        artifact.metadata["figmaArtifactKind"] === input.kind &&
        artifact.metadata["providerId"] === providerId,
    );

    if (duplicate !== undefined) {
      return FigmaIntakeResultSchema.parse({
        duplicate: true,
        sourceId: source.id,
        artifactId: duplicate.id,
        artifactDigest: duplicate.digest,
        kind: input.kind,
      });
    }

    const blob = await this.artifactStore.writeBlob({
      content: input.content,
      mediaType: input.mediaType,
      storedAt: timestamp,
      label: input.label,
    });

    const evidence = createFigmaEvidence({
      source,
      kind: input.kind,
      digest: contentDigest,
      timestamp,
      providerId,
    });

    const artifact = createFigmaArtifact({
      kind: input.kind,
      blobUri: blob.uri,
      mediaType: input.mediaType,
      digest: blob.digest,
      evidenceId: evidence.id,
      timestamp,
      source,
      providerId,
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      evidence: [...run.evidence, evidence],
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return FigmaIntakeResultSchema.parse({
      duplicate: false,
      sourceId: source.id,
      evidenceId: evidence.id,
      artifactId: artifact.id,
      artifactDigest: artifact.digest,
      kind: input.kind,
    });
  }
}

function findFigmaSource(sources: SourceRef[], sourceId: string): SourceRef {
  const source = sources.find((item) => item.id === sourceId);

  if (source === undefined) throw new Error(`Source not found: ${sourceId}`);
  if (source.kind !== "figma" || source.locator.type !== "figma") {
    throw new Error(`Source is not a Figma source: ${sourceId}`);
  }
  if (source.locator.fileKey === undefined || source.locator.nodeId === undefined) {
    throw new Error(`Figma source is missing fileKey or nodeId: ${sourceId}`);
  }

  return source;
}

function createFigmaEvidence(input: {
  source: SourceRef;
  kind: string;
  digest: string;
  timestamp: string;
  providerId: string;
}): EvidenceRef {
  if (input.source.locator.type !== "figma") throw new Error("Expected figma source locator");

  return EvidenceRefSchema.parse({
    id: createEvidenceId(),
    sourceId: input.source.id,
    location: {
      type: "figma-node",
      fileKey: input.source.locator.fileKey,
      nodeId: input.source.locator.nodeId,
    },
    summary: `Figma ${input.kind} evidence for node ${input.source.locator.nodeId}`,
    digest: input.digest,
    capturedAt: input.timestamp,
    metadata: {
      adapter: FIGMA_INTAKE_ADAPTER,
      providerId: input.providerId,
      sourceDigest: input.source.digest,
      figmaArtifactKind: input.kind,
      fileKey: input.source.locator.fileKey,
      nodeId: input.source.locator.nodeId,
    },
  });
}

function createFigmaArtifact(input: {
  kind: FigmaRecordedArtifactKind;
  blobUri: string;
  mediaType: string;
  digest: string;
  evidenceId: string;
  timestamp: string;
  source: SourceRef;
  providerId: string;
}): ArtifactRef {
  return ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: figmaKindToArtifactKind(input.kind),
    uri: input.blobUri,
    mediaType: input.mediaType,
    digest: input.digest,
    producedBy: "orchestrator",
    evidenceIds: [input.evidenceId],
    createdAt: input.timestamp,
    metadata: {
      adapter: FIGMA_INTAKE_ADAPTER,
      providerId: input.providerId,
      sourceId: input.source.id,
      sourceDigest: input.source.digest,
      figmaArtifactKind: input.kind,
    },
  });
}

function decodeBase64(value: string): Buffer {
  const buffer = Buffer.from(value, "base64");

  if (buffer.byteLength === 0) throw new Error("Decoded screenshot is empty");

  return buffer;
}
