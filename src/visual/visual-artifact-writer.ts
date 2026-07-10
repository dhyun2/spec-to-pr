import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import type { ArtifactKind, ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";

export async function writeVisualBlob(input: {
  artifactStore: ArtifactBlobStore;
  content: Buffer;
  mediaType: string;
  label: string;
  generatedAt: string;
  kind?: ArtifactKind;
  evidenceIds?: string[];
  metadata?: Record<string, unknown>;
}): Promise<ArtifactRef> {
  const blob = await input.artifactStore.writeBlob({
    content: input.content,
    mediaType: input.mediaType,
    storedAt: input.generatedAt,
    label: input.label,
  });
  const defaultKind: ArtifactKind = input.mediaType.startsWith("image/")
    ? "screenshot"
    : "visual-report";

  return ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: input.kind ?? defaultKind,
    uri: blob.uri,
    mediaType: input.mediaType,
    digest: blob.digest,
    producedBy: "orchestrator",
    evidenceIds: input.evidenceIds ?? [],
    createdAt: input.generatedAt,
    metadata: input.metadata ?? {},
  });
}
