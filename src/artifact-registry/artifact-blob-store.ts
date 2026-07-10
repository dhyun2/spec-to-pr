import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Sha256DigestSchema, type Sha256Digest } from "../runtime/scalars.js";
import { digestPathSegments, sha256Digest } from "../source-registry/content-hash.js";

export type ArtifactBlobMetadata = {
  digest: Sha256Digest;
  mediaType: string;
  byteLength: number;
  storedAt: string;
  label?: string;
};

export type StoredArtifactBlob = {
  digest: Sha256Digest;
  uri: string;
  contentPath: string;
  metadataPath: string;
  metadata: ArtifactBlobMetadata;
};

export class ArtifactBlobStore {
  public constructor(private readonly rootDirectory: string) {}

  public async writeBlob(input: {
    content: Buffer;
    mediaType: string;
    storedAt: string;
    label?: string;
  }): Promise<StoredArtifactBlob> {
    const digest = sha256Digest(input.content);
    const { prefix, hex } = digestPathSegments(digest);
    const directory = path.join(this.rootDirectory, "sha256", prefix, hex);
    const contentPath = path.join(directory, "content");
    const metadataPath = path.join(directory, "metadata.json");

    await mkdir(directory, {
      recursive: true,
      mode: 0o700,
    });

    await writeIfMissing(contentPath, input.content);

    const metadata: ArtifactBlobMetadata = {
      digest,
      mediaType: input.mediaType,
      byteLength: input.content.byteLength,
      storedAt: input.storedAt,
      ...(input.label === undefined ? {} : { label: input.label }),
    };

    await writeIfMissing(
      metadataPath,
      Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    );

    return {
      digest,
      uri: `artifact://sha256/${hex}`,
      contentPath,
      metadataPath,
      metadata,
    };
  }

  public async readMetadata(rawDigest: Sha256Digest): Promise<ArtifactBlobMetadata> {
    const digest = Sha256DigestSchema.parse(rawDigest);
    const { prefix, hex } = digestPathSegments(digest);
    const metadataPath = path.join(this.rootDirectory, "sha256", prefix, hex, "metadata.json");

    return JSON.parse(await readFile(metadataPath, "utf8")) as ArtifactBlobMetadata;
  }

  public async readContent(rawDigest: Sha256Digest): Promise<Buffer> {
    const digest = Sha256DigestSchema.parse(rawDigest);
    const { prefix, hex } = digestPathSegments(digest);
    const contentPath = path.join(this.rootDirectory, "sha256", prefix, hex, "content");

    return readFile(contentPath);
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
