import { NormalizedBriefDocumentSchema, type NormalizedBriefDocument } from "./normalized-brief.js";
import type { NormalizedBriefFormat } from "./normalized-brief.js";
import type { Sha256Digest } from "../runtime/scalars.js";
import type { EvidenceLocation, SourceRef } from "../runtime/source.js";

export function createUnsupportedBriefDocument(input: {
  source: SourceRef;
  sourceDigest: Sha256Digest;
  format: NormalizedBriefFormat;
  reason: string;
}): NormalizedBriefDocument {
  return NormalizedBriefDocumentSchema.parse({
    sourceId: input.source.id,
    sourceDigest: input.sourceDigest,
    format: input.format,
    blocks: [
      {
        blockId: "unsupported-1",
        kind: "unsupported",
        text: input.reason,
        location: unsupportedLocation(input.source, input.format),
        headingPath: [],
        metadata: {
          unsupported: true,
          reason: input.reason,
        },
      },
    ],
    metadata: {
      unsupported: true,
      reason: input.reason,
    },
  });
}

function unsupportedLocation(source: SourceRef, format: NormalizedBriefFormat): EvidenceLocation {
  const locator = source.locator;

  if (locator.type === "file") {
    if (format === "pdf") {
      return {
        type: "pdf-page",
        path: locator.path,
        page: 1,
      };
    }

    return {
      type: "file-lines",
      path: locator.path,
      startLine: 1,
      endLine: 1,
    };
  }

  if (locator.type === "ticket") {
    return {
      type: "ticket-field",
      provider: locator.provider,
      url: locator.url,
      field: "source",
    };
  }

  if (locator.type === "url") {
    return {
      type: "url-fragment",
      url: locator.url,
      fragment: "source",
    };
  }

  return {
    type: "json-pointer",
    document: "source.json",
    pointer: "/locator",
  };
}
