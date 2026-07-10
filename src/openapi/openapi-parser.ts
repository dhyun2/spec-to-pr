import { z } from "zod";
import { parse as parseYaml } from "yaml";

export const OpenApiDocumentFormatSchema = z.enum(["json", "yaml"]);

export const OpenApiVersionKindSchema = z.enum([
  "openapi-3.0",
  "openapi-3.1",
  "swagger-2.0",
  "unknown",
]);

export const ParsedOpenApiDocumentSchema = z
  .object({
    format: OpenApiDocumentFormatSchema,
    versionKind: OpenApiVersionKindSchema,
    version: z.string().optional(),
    document: z.record(z.string(), z.unknown()),
  })
  .strict();

export type OpenApiDocumentFormat = z.infer<typeof OpenApiDocumentFormatSchema>;
export type OpenApiVersionKind = z.infer<typeof OpenApiVersionKindSchema>;
export type ParsedOpenApiDocument = z.infer<typeof ParsedOpenApiDocumentSchema>;

export function parseOpenApiDocument(input: {
  content: Buffer;
  path?: string;
  mediaType?: string;
}): ParsedOpenApiDocument {
  const text = input.content.toString("utf8");
  const format = detectOpenApiFormat({
    text,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
  });

  const parsed = format === "json" ? JSON.parse(text) : parseYaml(text);

  if (!isRecord(parsed)) {
    throw new Error("OpenAPI document must parse to an object");
  }

  const version =
    typeof parsed["openapi"] === "string"
      ? parsed["openapi"]
      : typeof parsed["swagger"] === "string"
        ? parsed["swagger"]
        : undefined;

  return ParsedOpenApiDocumentSchema.parse({
    format,
    versionKind: detectVersionKind(parsed),
    ...(version === undefined ? {} : { version }),
    document: parsed,
  });
}

export function detectOpenApiFormat(input: {
  text: string;
  path?: string;
  mediaType?: string;
}): OpenApiDocumentFormat {
  const mediaType = input.mediaType?.toLowerCase();
  const filePath = input.path?.toLowerCase();

  if (mediaType === "application/json" || filePath?.endsWith(".json")) {
    return "json";
  }

  if (
    mediaType === "application/yaml" ||
    mediaType === "application/x-yaml" ||
    filePath?.endsWith(".yaml") ||
    filePath?.endsWith(".yml")
  ) {
    return "yaml";
  }

  const trimmed = input.text.trimStart();

  if (trimmed.startsWith("{")) {
    return "json";
  }

  return "yaml";
}

export function detectVersionKind(document: Record<string, unknown>): OpenApiVersionKind {
  const openapi = document["openapi"];

  if (typeof openapi === "string") {
    if (openapi.startsWith("3.0.")) {
      return "openapi-3.0";
    }

    if (openapi.startsWith("3.1.")) {
      return "openapi-3.1";
    }

    return "unknown";
  }

  const swagger = document["swagger"];

  if (swagger === "2.0") {
    return "swagger-2.0";
  }

  return "unknown";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
