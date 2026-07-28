import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { IsoDateTimeSchema, Sha256DigestSchema, type Sha256Digest } from "../runtime/scalars.js";
import {
  NoopRuntimeMetrics,
  type RuntimeMetricsSink,
} from "../runtime/performance-instrumentation.js";
import { digestPathSegments, sha256Digest } from "../source-registry/content-hash.js";

export type ArtifactBlobMetadata = {
  digest: Sha256Digest;
  mediaType: string;
  byteLength: number;
  storedAt: string;
  label?: string;
};

export const ArtifactBlobMetadataSchema = z
  .object({
    digest: Sha256DigestSchema,
    mediaType: z.string().trim().min(1),
    byteLength: z.number().int().nonnegative(),
    storedAt: IsoDateTimeSchema,
    label: z.string().optional(),
  })
  .strict();

export type StoredArtifactBlob = {
  digest: Sha256Digest;
  uri: string;
  contentPath: string;
  metadataPath: string;
  metadata: ArtifactBlobMetadata;
};

export class ArtifactBlobStore {
  public constructor(
    private readonly rootDirectory: string,
    private readonly metrics: RuntimeMetricsSink = new NoopRuntimeMetrics(),
  ) {}

  public async writeBlob(input: {
    content: Buffer;
    mediaType: string;
    storedAt: string;
    label?: string;
  }): Promise<StoredArtifactBlob> {
    const digest = sha256Digest(input.content);
    this.metrics.increment("artifact.hash_count");
    this.metrics.increment("artifact.write_count");
    this.metrics.increment("artifact.write_bytes", input.content.byteLength);
    const { prefix, hex } = digestPathSegments(digest);
    const directory = path.join(this.rootDirectory, "sha256", prefix, hex);
    const contentPath = path.join(directory, "content");
    const metadataPath = path.join(directory, "metadata.json");

    await mkdir(directory, {
      recursive: true,
      mode: 0o700,
    });

    await atomicCreateFile(contentPath, input.content, (existing) => {
      const existingDigest = sha256Digest(existing);
      this.metrics.increment("artifact.hash_count");
      if (!existing.equals(input.content) || existingDigest !== digest) {
        throw integrityFailure("existing blob file does not match content");
      }
    });

    const metadata: ArtifactBlobMetadata = {
      digest,
      mediaType: input.mediaType,
      byteLength: input.content.byteLength,
      storedAt: input.storedAt,
      ...(input.label === undefined ? {} : { label: input.label }),
    };

    let existingMetadata: ArtifactBlobMetadata | undefined;
    const metadataDisposition = await atomicCreateFile(
      metadataPath,
      Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
      (existing) => {
        existingMetadata = parseExistingMetadata(existing, digest, input.content.byteLength);
      },
    );

    return {
      digest,
      uri: `artifact://sha256/${hex}`,
      contentPath,
      metadataPath,
      metadata: metadataDisposition === "created" ? metadata : existingMetadata!,
    };
  }

  public async readMetadata(rawDigest: Sha256Digest): Promise<ArtifactBlobMetadata> {
    const digest = Sha256DigestSchema.parse(rawDigest);
    const { prefix, hex } = digestPathSegments(digest);
    const metadataPath = path.join(this.rootDirectory, "sha256", prefix, hex, "metadata.json");

    const contentPath = path.join(this.rootDirectory, "sha256", prefix, hex, "content");
    const metadata = await readMetadataFile(metadataPath, digest);
    const content = await readVerifiedContentFile(contentPath, digest);
    this.metrics.increment("artifact.read_count");
    this.metrics.increment("artifact.read_bytes", content.byteLength);
    this.metrics.increment("artifact.hash_count");
    if (metadata.byteLength !== content.byteLength) {
      throw integrityFailure(
        `metadata byteLength ${metadata.byteLength} does not match content ${content.byteLength}`,
      );
    }
    return {
      digest: metadata.digest,
      mediaType: metadata.mediaType,
      byteLength: metadata.byteLength,
      storedAt: metadata.storedAt,
      ...(metadata.label === undefined ? {} : { label: metadata.label }),
    };
  }

  public async readContent(rawDigest: Sha256Digest): Promise<Buffer> {
    const digest = Sha256DigestSchema.parse(rawDigest);
    const { prefix, hex } = digestPathSegments(digest);
    const contentPath = path.join(this.rootDirectory, "sha256", prefix, hex, "content");

    const metadataPath = path.join(this.rootDirectory, "sha256", prefix, hex, "metadata.json");
    const content = await readVerifiedContentFile(contentPath, digest);
    this.metrics.increment("artifact.read_count");
    this.metrics.increment("artifact.read_bytes", content.byteLength);
    this.metrics.increment("artifact.hash_count");
    const metadata = await readMetadataFile(metadataPath, digest);
    if (metadata.byteLength !== content.byteLength) {
      throw integrityFailure(
        `metadata byteLength ${metadata.byteLength} does not match content ${content.byteLength}`,
      );
    }
    return content;
  }
}

type AtomicCreateDisposition = "created" | "verified-existing";

async function atomicCreateFile(
  filePath: string,
  content: Buffer,
  validateExisting?: (existing: Buffer) => void,
): Promise<AtomicCreateDisposition> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    try {
      await link(temporaryPath, filePath);
      return "created";
    } catch (error: unknown) {
      if (!isAlreadyExistsError(error)) throw error;
      const existing = await readRegularFileNoFollow(filePath);
      if (validateExisting === undefined) {
        if (!existing.equals(content)) {
          throw integrityFailure(`existing blob file does not match ${path.basename(filePath)}`);
        }
      } else {
        validateExisting(existing);
      }
      return "verified-existing";
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function parseExistingMetadata(
  content: Buffer,
  digest: Sha256Digest,
  byteLength: number,
): ArtifactBlobMetadata {
  try {
    const parsed = ArtifactBlobMetadataSchema.safeParse(JSON.parse(content.toString("utf8")));
    if (!parsed.success || parsed.data.digest !== digest || parsed.data.byteLength !== byteLength) {
      throw integrityFailure("existing metadata does not match the content digest and length");
    }
    return {
      digest: parsed.data.digest,
      mediaType: parsed.data.mediaType,
      byteLength: parsed.data.byteLength,
      storedAt: parsed.data.storedAt,
      ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("ARTIFACT_INTEGRITY_FAILED")) {
      throw error;
    }
    throw integrityFailure(`invalid existing metadata: ${errorMessage(error)}`);
  }
}

async function readMetadataFile(
  metadataPath: string,
  digest: Sha256Digest,
): Promise<ArtifactBlobMetadata> {
  try {
    const content = await readRegularFileNoFollow(metadataPath);
    const metadata = ArtifactBlobMetadataSchema.parse(JSON.parse(content.toString("utf8")));
    if (metadata.digest !== digest) {
      throw integrityFailure(`metadata digest does not match ${digest}`);
    }
    return {
      digest: metadata.digest,
      mediaType: metadata.mediaType,
      byteLength: metadata.byteLength,
      storedAt: metadata.storedAt,
      ...(metadata.label === undefined ? {} : { label: metadata.label }),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("ARTIFACT_INTEGRITY_FAILED")) {
      throw error;
    }
    throw integrityFailure(`invalid metadata: ${errorMessage(error)}`);
  }
}

async function readVerifiedContentFile(contentPath: string, digest: Sha256Digest): Promise<Buffer> {
  try {
    const content = await readRegularFileNoFollow(contentPath);
    if (sha256Digest(content) !== digest) {
      throw integrityFailure(`content digest does not match ${digest}`);
    }
    return content;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("ARTIFACT_INTEGRITY_FAILED")) {
      throw error;
    }
    throw integrityFailure(`invalid content: ${errorMessage(error)}`);
  }
}

async function readRegularFileNoFollow(filePath: string): Promise<Buffer> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const descriptorDetails = await handle.stat();
    const pathDetails = await lstat(filePath);
    if (
      pathDetails.isSymbolicLink() ||
      !pathDetails.isFile() ||
      !descriptorDetails.isFile() ||
      pathDetails.dev !== descriptorDetails.dev ||
      pathDetails.ino !== descriptorDetails.ino
    ) {
      throw integrityFailure(`${filePath} must be one stable regular non-symlink file`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function integrityFailure(detail: string): Error {
  return new Error(`ARTIFACT_INTEGRITY_FAILED: ${detail}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as { code?: unknown }).code === "EEXIST"
  );
}
