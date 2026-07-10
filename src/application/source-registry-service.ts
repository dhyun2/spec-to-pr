import { readFile } from "node:fs/promises";

import { z } from "zod";

import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import type { RunSummary } from "../run/index.js";
import { createSourceId } from "../runtime/id-factory.js";
import { RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { SourceKindSchema, SourceRefSchema, type SourceRef } from "../runtime/source.js";
import {
  canonicalizeFileContent,
  resolveFileInsideRoot,
  SourceSnapshotMetadataSchema,
  SourceSnapshotStore,
  type StoredSourceSnapshot,
} from "../source-registry/index.js";
import type { RunStore } from "../store/run-store.js";

export const RegisterFileSourceInputSchema = z
  .object({
    runId: RunIdSchema,
    kind: SourceKindSchema,
    path: z.string().trim().min(1),
    mediaType: z.string().trim().min(1).optional(),
  })
  .strict();

export const GetSourceSnapshotInputSchema = z
  .object({
    digest: Sha256DigestSchema,
  })
  .strict();

export const SourceRegistrationResultSchema = z
  .object({
    run: RunSummarySchema,
    source: SourceRefSchema,
    snapshot: z.object({
      digest: Sha256DigestSchema,
      contentPath: z.string(),
      metadataPath: z.string(),
      metadata: SourceSnapshotMetadataSchema,
    }),
    duplicate: z.boolean(),
  })
  .strict();

export type RegisterFileSourceInput = z.infer<typeof RegisterFileSourceInputSchema>;

export type SourceRegistrationResult = {
  run: RunSummary;
  source: SourceRef;
  snapshot: StoredSourceSnapshot;
  duplicate: boolean;
};

export class SourceRegistryService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly snapshotStore: SourceSnapshotStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async registerFileSource(rawInput: unknown): Promise<SourceRegistrationResult> {
    const input = RegisterFileSourceInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);

    const scopedPath = await resolveFileInsideRoot({
      projectRoot: run.projectRoot,
      filePath: input.path,
    });

    const rawContent = await readFile(scopedPath.absolutePath);
    const canonical = canonicalizeFileContent({
      path: scopedPath.relativePath,
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      rawContent,
    });
    const capturedAt = IsoDateTimeSchema.parse(this.now());

    const existingSource = run.sources.find(
      (source) =>
        source.kind === input.kind &&
        source.locator.type === "file" &&
        source.locator.path === scopedPath.relativePath &&
        source.digest === canonical.canonicalDigest,
    );

    const source =
      existingSource ??
      SourceRefSchema.parse({
        id: createSourceId(),
        kind: input.kind,
        locator: {
          type: "file",
          path: scopedPath.relativePath,
          ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
        },
        digest: canonical.canonicalDigest,
        capturedAt,
        metadata: {
          rawDigest: canonical.rawDigest,
          mode: canonical.mode,
          rawByteLength: canonical.rawByteLength,
          canonicalByteLength: canonical.canonicalByteLength,
          ...(canonical.lineCount === undefined ? {} : { lineCount: canonical.lineCount }),
        },
      });

    const snapshot = await this.snapshotStore.writeSnapshot({
      source,
      canonical,
      storedAt: capturedAt,
    });

    if (existingSource !== undefined) {
      return parseSourceRegistrationResult({
        run: summarizeRun(run),
        source,
        snapshot,
        duplicate: true,
      });
    }

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: capturedAt,
      sources: [...run.sources, source],
    });

    await this.runStore.save(nextRun, run.revision);

    return parseSourceRegistrationResult({
      run: summarizeRun(nextRun),
      source,
      snapshot,
      duplicate: false,
    });
  }

  public async getSourceSnapshotMetadata(rawInput: unknown) {
    const input = GetSourceSnapshotInputSchema.parse(rawInput);

    return this.snapshotStore.readMetadata(input.digest);
  }
}

function parseSourceRegistrationResult(result: SourceRegistrationResult): SourceRegistrationResult {
  SourceRegistrationResultSchema.parse(result);

  return result;
}
