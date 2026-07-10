import { NormalizedBriefDocumentSchema, type NormalizedBriefDocument } from "./normalized-brief.js";
import type { Sha256Digest } from "../runtime/scalars.js";
import type { SourceRef } from "../runtime/source.js";

type ParagraphDraft = {
  lineStart: number;
  lineEnd: number;
  lines: string[];
};

export function parsePlainTextBrief(input: {
  source: SourceRef;
  sourceDigest: Sha256Digest;
  content: string;
}): NormalizedBriefDocument {
  const locator = input.source.locator;

  if (locator.type !== "file") {
    throw new Error("Plain-text brief parser requires a file source");
  }

  const paragraphs = parseParagraphs(input.content);

  return NormalizedBriefDocumentSchema.parse({
    sourceId: input.source.id,
    sourceDigest: input.sourceDigest,
    format: "plaintext",
    blocks: paragraphs.map((paragraph, index) => ({
      blockId: `txt-${index + 1}`,
      kind: "paragraph",
      text: paragraph.lines.join(" ").trim(),
      location: {
        type: "file-lines",
        path: locator.path,
        startLine: paragraph.lineStart,
        endLine: paragraph.lineEnd,
      },
      headingPath: [],
    })),
    metadata: {
      lineCount: input.content.split("\n").length,
    },
  });
}

function parseParagraphs(content: string): ParagraphDraft[] {
  const paragraphs: ParagraphDraft[] = [];
  let current: ParagraphDraft | undefined;

  content.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      if (current !== undefined) {
        paragraphs.push(current);
        current = undefined;
      }

      return;
    }

    if (current === undefined) {
      current = {
        lineStart: lineNumber,
        lineEnd: lineNumber,
        lines: [trimmed],
      };
      return;
    }

    current.lineEnd = lineNumber;
    current.lines.push(trimmed);
  });

  if (current !== undefined) {
    paragraphs.push(current);
  }

  return paragraphs;
}
