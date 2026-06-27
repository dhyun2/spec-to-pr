import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { Sha256DigestSchema, type Sha256Digest } from "../runtime/scalars.js";
import { SourceRefSchema, type SourceRef } from "../runtime/source.js";
import type { CanonicalContent } from "./canonical-content.js";
import { digestPathSegments } from "./content-hash.js";

export const SourceSnapshotMetadataSchema = z
  .object({
    source: SourceRefSchema,
    rawDigest: Sha256DigestSchema,
    canonicalDigest: Sha256DigestSchema,
    mode: z.enum(["text", "binary"]),
    rawByteLength: z.number().int().nonnegative(),
    canonicalByteLength: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative().optional(),
    storedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SourceSnapshotMetadata = z.infer<typeof SourceSnapshotMetadataSchema>;

export type StoredSourceSnapshot = {
  digest: Sha256Digest;
  contentPath: string;
  metadataPath: string;
  metadata: SourceSnapshotMetadata;
};

export class SourceSnapshotStore {
  public constructor(private readonly rootDirectory: string) {}

  public async writeSnapshot(input: {
    source: SourceRef;
    canonical: CanonicalContent;
    storedAt: string;
  }): Promise<StoredSourceSnapshot> {
    const digest = input.canonical.canonicalDigest;
    const { prefix, hex } = digestPathSegments(digest);

    const directory = path.join(this.rootDirectory, "sha256", prefix, hex);
    const contentPath = path.join(directory, "content");
    const metadataPath = path.join(directory, "metadata.json");

    await mkdir(directory, {
      recursive: true,
      mode: 0o700,
    });

    await writeIfMissing(contentPath, input.canonical.canonicalContent);

    const metadata = SourceSnapshotMetadataSchema.parse({
      source: input.source,
      rawDigest: input.canonical.rawDigest,
      canonicalDigest: input.canonical.canonicalDigest,
      mode: input.canonical.mode,
      rawByteLength: input.canonical.rawByteLength,
      canonicalByteLength: input.canonical.canonicalByteLength,
      ...(input.canonical.lineCount === undefined ? {} : { lineCount: input.canonical.lineCount }),
      storedAt: input.storedAt,
    });

    await writeIfMissing(
      metadataPath,
      Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    );

    return {
      digest,
      contentPath,
      metadataPath,
      metadata,
    };
  }

  public async readMetadata(rawDigest: Sha256Digest): Promise<SourceSnapshotMetadata> {
    const digest = Sha256DigestSchema.parse(rawDigest);
    const { prefix, hex } = digestPathSegments(digest);
    const metadataPath = path.join(this.rootDirectory, "sha256", prefix, hex, "metadata.json");

    return SourceSnapshotMetadataSchema.parse(JSON.parse(await readFile(metadataPath, "utf8")));
  }
}

async function writeIfMissing(filePath: string, content: Buffer): Promise<void> {
  try {
    await writeFile(filePath, content, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error: unknown) {
    if (isAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as { code?: unknown }).code === "EEXIST"
  );
}
