import type { Sha256Digest } from "../runtime/scalars.js";
import { sha256Digest } from "./content-hash.js";

export type CanonicalizationMode = "text" | "binary";

export type CanonicalContent = {
  mode: CanonicalizationMode;
  rawDigest: Sha256Digest;
  canonicalDigest: Sha256Digest;
  rawByteLength: number;
  canonicalByteLength: number;
  lineCount?: number;
  canonicalContent: Buffer;
};

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".scss",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".feature",
]);

export function canonicalizeFileContent(input: {
  path: string;
  mediaType?: string;
  rawContent: Buffer;
}): CanonicalContent {
  const mode = isTextLike(input.path, input.mediaType) ? "text" : "binary";
  const rawDigest = sha256Digest(input.rawContent);

  if (mode === "binary") {
    return {
      mode,
      rawDigest,
      canonicalDigest: rawDigest,
      rawByteLength: input.rawContent.byteLength,
      canonicalByteLength: input.rawContent.byteLength,
      canonicalContent: input.rawContent,
    };
  }

  const rawText = input.rawContent.toString("utf8");
  const canonicalText = rawText.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const canonicalContent = Buffer.from(canonicalText, "utf8");

  return {
    mode,
    rawDigest,
    canonicalDigest: sha256Digest(canonicalContent),
    rawByteLength: input.rawContent.byteLength,
    canonicalByteLength: canonicalContent.byteLength,
    lineCount: canonicalText.length === 0 ? 0 : canonicalText.split("\n").length,
    canonicalContent,
  };
}

function isTextLike(filePath: string, mediaType?: string): boolean {
  if (mediaType !== undefined) {
    if (mediaType.startsWith("text/")) {
      return true;
    }

    if (
      mediaType === "application/json" ||
      mediaType === "application/yaml" ||
      mediaType === "application/x-yaml" ||
      mediaType === "application/xml"
    ) {
      return true;
    }
  }

  const lowerPath = filePath.toLowerCase();

  for (const extension of TEXT_EXTENSIONS) {
    if (lowerPath.endsWith(extension)) {
      return true;
    }
  }

  return false;
}
