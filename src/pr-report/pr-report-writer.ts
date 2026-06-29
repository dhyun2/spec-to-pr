import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import type { PrReportViewModel } from "./pr-report-model.js";

export type PrReportWriteResult = {
  markdownArtifact: ArtifactRef;
  viewModelArtifact: ArtifactRef;
  viewModelJson: string;
};

export async function writePrReportArtifacts(input: {
  artifactStore: ArtifactBlobStore;
  markdown: string;
  viewModel: PrReportViewModel;
  generatedAt: string;
  markdownArtifactId?: string | undefined;
  viewModelArtifactId?: string | undefined;
}): Promise<PrReportWriteResult> {
  const viewModelJson = `${JSON.stringify(input.viewModel, null, 2)}\n`;
  const markdownArtifact = await writeArtifact({
    artifactStore: input.artifactStore,
    artifactId: input.markdownArtifactId,
    label: "pr-report.md",
    content: input.markdown,
    mediaType: "text/markdown",
    generatedAt: input.generatedAt,
    metadata: {
      reportKind: "pr-body-markdown",
      decision: input.viewModel.decision,
      locale: input.viewModel.locale,
    },
  });
  const viewModelArtifact = await writeArtifact({
    artifactStore: input.artifactStore,
    artifactId: input.viewModelArtifactId,
    label: "pr-report-view-model.json",
    content: viewModelJson,
    mediaType: "application/json",
    generatedAt: input.generatedAt,
    metadata: {
      reportKind: "pr-report-view-model",
      decision: input.viewModel.decision,
      locale: input.viewModel.locale,
      markdownArtifactId: markdownArtifact.id,
    },
  });

  return {
    markdownArtifact,
    viewModelArtifact,
    viewModelJson,
  };
}

async function writeArtifact(input: {
  artifactStore: ArtifactBlobStore;
  artifactId?: string | undefined;
  label: string;
  content: string;
  mediaType: string;
  generatedAt: string;
  metadata: Record<string, unknown>;
}): Promise<ArtifactRef> {
  const blob = await input.artifactStore.writeBlob({
    content: Buffer.from(input.content, "utf8"),
    mediaType: input.mediaType,
    storedAt: input.generatedAt,
    label: input.label,
  });

  return ArtifactRefSchema.parse({
    id: input.artifactId ?? createArtifactId(),
    kind: "pr-report",
    uri: blob.uri,
    mediaType: input.mediaType,
    digest: blob.digest,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: input.generatedAt,
    metadata: {
      adapter: "pr-report-v1",
      label: input.label,
      ...input.metadata,
    },
  });
}
