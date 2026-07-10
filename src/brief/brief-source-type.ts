import path from "node:path";

import { z } from "zod";

import type { SourceRef } from "../runtime/source.js";
import { NormalizedBriefFormatSchema, type NormalizedBriefFormat } from "./normalized-brief.js";

export const BriefSourceTypeSchema = NormalizedBriefFormatSchema;

export type BriefSourceType = z.infer<typeof BriefSourceTypeSchema>;

export function detectBriefSourceType(source: SourceRef): BriefSourceType {
  const locator = source.locator;

  if (locator.type === "ticket") {
    return "ticket";
  }

  if (locator.type === "url") {
    return isHtmlMediaType(locator.mediaType) ? "html" : "unknown";
  }

  if (locator.type !== "file") {
    return "unknown";
  }

  const extension = path.extname(locator.path).toLowerCase();
  const mediaType = locator.mediaType?.toLowerCase();

  if (mediaType === "application/pdf" || extension === ".pdf") {
    return "pdf";
  }

  if (
    mediaType === "text/markdown" ||
    mediaType === "text/x-markdown" ||
    extension === ".md" ||
    extension === ".mdx"
  ) {
    return "markdown";
  }

  if (mediaType === "text/plain" || extension === ".txt") {
    return "plaintext";
  }

  if (isHtmlMediaType(mediaType) || extension === ".html" || extension === ".htm") {
    return "html";
  }

  return "unknown";
}

function isHtmlMediaType(mediaType: string | undefined): boolean {
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}
