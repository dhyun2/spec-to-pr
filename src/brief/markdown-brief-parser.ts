import { NormalizedBriefDocumentSchema, type NormalizedBriefDocument } from "./normalized-brief.js";
import { parseMarkdownLines } from "./markdown-lines.js";
import type { SourceRef } from "../runtime/source.js";
import type { Sha256Digest } from "../runtime/scalars.js";

export function parseMarkdownBrief(input: {
  source: SourceRef;
  sourceDigest: Sha256Digest;
  content: string;
}): NormalizedBriefDocument {
  const locator = input.source.locator;

  if (locator.type !== "file") {
    throw new Error("Markdown brief parser requires a file source");
  }

  const parsed = parseMarkdownLines(input.content);

  return NormalizedBriefDocumentSchema.parse({
    sourceId: input.source.id,
    sourceDigest: input.sourceDigest,
    format: "markdown",
    title: parsed.headings[0]?.text,
    blocks: parsed.blocks.map((block, index) => ({
      blockId: `md-${index + 1}`,
      kind: block.kind,
      text: block.text,
      location: {
        type: "file-lines",
        path: locator.path,
        startLine: block.lineStart,
        endLine: block.lineEnd,
      },
      headingPath: block.headingPath,
      metadata: {
        ...(block.headingLevel === undefined ? {} : { headingLevel: block.headingLevel }),
      },
    })),
    metadata: {
      lineCount: parsed.lineCount,
    },
  });
}
