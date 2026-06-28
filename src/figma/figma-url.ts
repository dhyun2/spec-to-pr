import { z } from "zod";

export const FigmaFileKindSchema = z.enum(["design", "file", "proto"]);

export const FigmaNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^\d+:\d+(?::\d+)*$/, "Expected normalized Figma node id such as 238:941");

export const FigmaFileKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, "Expected Figma file key");

export const ParsedFigmaUrlSchema = z
  .object({
    rawUrl: z.string().url(),
    canonicalUrl: z.string().url(),
    kind: FigmaFileKindSchema,
    fileKey: FigmaFileKeySchema,
    nodeId: FigmaNodeIdSchema,
  })
  .strict();

export type FigmaFileKind = z.infer<typeof FigmaFileKindSchema>;
export type FigmaNodeId = z.infer<typeof FigmaNodeIdSchema>;
export type FigmaFileKey = z.infer<typeof FigmaFileKeySchema>;
export type ParsedFigmaUrl = z.infer<typeof ParsedFigmaUrlSchema>;

export function parseFigmaUrl(rawUrl: string): ParsedFigmaUrl {
  const url = new URL(rawUrl);

  if (!isFigmaHost(url.hostname)) {
    throw new Error(`Expected a figma.com URL, received ${url.hostname}`);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];

  if (kind !== "design" && kind !== "file" && kind !== "proto") {
    throw new Error(`Unsupported Figma URL kind: ${kind ?? "<missing>"}`);
  }

  const fileKey = parts[1];

  if (fileKey === undefined || fileKey.trim().length === 0) {
    throw new Error("Figma URL is missing file key");
  }

  const nodeIdParam = url.searchParams.get("node-id");

  if (nodeIdParam === null || nodeIdParam.trim().length === 0) {
    throw new Error("Figma URL must include node-id for design evidence");
  }

  const nodeId = normalizeFigmaNodeId(nodeIdParam);

  const canonical = new URL(`https://www.figma.com/${kind}/${fileKey}`);
  canonical.searchParams.set("node-id", nodeId.replaceAll(":", "-"));

  return ParsedFigmaUrlSchema.parse({
    rawUrl,
    canonicalUrl: canonical.toString(),
    kind,
    fileKey,
    nodeId,
  });
}

export function normalizeFigmaNodeId(rawNodeId: string): FigmaNodeId {
  const trimmed = rawNodeId.trim();
  const normalized = trimmed.includes(":") ? trimmed : trimmed.replaceAll("-", ":");

  return FigmaNodeIdSchema.parse(normalized);
}

function isFigmaHost(hostname: string): boolean {
  return hostname === "figma.com" || hostname === "www.figma.com";
}
