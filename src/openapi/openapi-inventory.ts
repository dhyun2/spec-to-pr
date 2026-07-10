import { z } from "zod";

import { asRecord, isRecord, type ParsedOpenApiDocument } from "./openapi-parser.js";

export const HttpMethodSchema = z.enum([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

export const OpenApiOperationInventoryItemSchema = z
  .object({
    method: HttpMethodSchema,
    path: z.string().min(1),
    pointer: z.string().min(1),
    operationId: z.string().min(1).optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    requestContentTypes: z.array(z.string()).default([]),
    responseStatuses: z.array(z.string()).default([]),
    responseContentTypes: z.array(z.string()).default([]),
    securitySchemeNames: z.array(z.string()).default([]),
  })
  .strict();

export const OpenApiSchemaInventoryItemSchema = z
  .object({
    name: z.string().min(1),
    pointer: z.string().min(1),
    type: z.string().optional(),
    hasRef: z.boolean(),
  })
  .strict();

export const OpenApiSecuritySchemeInventoryItemSchema = z
  .object({
    name: z.string().min(1),
    pointer: z.string().min(1),
    type: z.string().optional(),
    scheme: z.string().optional(),
    bearerFormat: z.string().optional(),
    in: z.string().optional(),
    nameField: z.string().optional(),
  })
  .strict();

export const OpenApiRefInventoryItemSchema = z
  .object({
    pointer: z.string().min(1),
    ref: z.string().min(1),
  })
  .strict();

export const OpenApiInventorySchema = z
  .object({
    version: z.string().optional(),
    versionKind: z.string(),
    operationCount: z.number().int().nonnegative(),
    schemaCount: z.number().int().nonnegative(),
    securitySchemeCount: z.number().int().nonnegative(),
    refCount: z.number().int().nonnegative(),
    operations: z.array(OpenApiOperationInventoryItemSchema),
    schemas: z.array(OpenApiSchemaInventoryItemSchema),
    securitySchemes: z.array(OpenApiSecuritySchemeInventoryItemSchema),
    refs: z.array(OpenApiRefInventoryItemSchema),
  })
  .strict();

export type OpenApiOperationInventoryItem = z.infer<typeof OpenApiOperationInventoryItemSchema>;
export type OpenApiInventory = z.infer<typeof OpenApiInventorySchema>;

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export function buildOpenApiInventory(parsed: ParsedOpenApiDocument): OpenApiInventory {
  const document = parsed.document;
  const operations = collectOperations(document);
  const schemas = collectSchemas(document);
  const securitySchemes = collectSecuritySchemes(document);
  const refs = collectRefs(document);

  return OpenApiInventorySchema.parse({
    ...(parsed.version === undefined ? {} : { version: parsed.version }),
    versionKind: parsed.versionKind,
    operationCount: operations.length,
    schemaCount: schemas.length,
    securitySchemeCount: securitySchemes.length,
    refCount: refs.length,
    operations,
    schemas,
    securitySchemes,
    refs,
  });
}

function collectOperations(document: Record<string, unknown>): OpenApiOperationInventoryItem[] {
  const paths = asRecord(document["paths"]);

  if (paths === undefined) {
    return [];
  }

  const operations: OpenApiOperationInventoryItem[] = [];

  for (const [pathName, pathItemValue] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemValue);

    if (pathItem === undefined) {
      continue;
    }

    for (const [methodName, operationValue] of Object.entries(pathItem)) {
      const method = methodName.toLowerCase();

      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      const operation = asRecord(operationValue);

      if (operation === undefined) {
        continue;
      }

      const pointer = `/paths/${escapeJsonPointer(pathName)}/${method}`;
      const operationId = asString(operation["operationId"]);
      const summary = asString(operation["summary"]);

      operations.push(
        OpenApiOperationInventoryItemSchema.parse({
          method,
          path: pathName,
          pointer,
          ...(operationId === undefined ? {} : { operationId }),
          ...(summary === undefined ? {} : { summary }),
          tags: asStringArray(operation["tags"]),
          requestContentTypes: collectRequestContentTypes(operation),
          responseStatuses: collectResponseStatuses(operation),
          responseContentTypes: collectResponseContentTypes(operation),
          securitySchemeNames: collectOperationSecuritySchemeNames(document, operation),
        }),
      );
    }
  }

  return operations;
}

function collectSchemas(document: Record<string, unknown>) {
  const schemas = asRecord(asRecord(document["components"])?.["schemas"]);

  if (schemas === undefined) {
    return [];
  }

  return Object.entries(schemas).map(([name, schemaValue]) => {
    const schema = asRecord(schemaValue) ?? {};
    const type = asString(schema["type"]);

    return OpenApiSchemaInventoryItemSchema.parse({
      name,
      pointer: `/components/schemas/${escapeJsonPointer(name)}`,
      ...(type === undefined ? {} : { type }),
      hasRef: hasRef(schema),
    });
  });
}

function collectSecuritySchemes(document: Record<string, unknown>) {
  const schemes = asRecord(asRecord(document["components"])?.["securitySchemes"]);

  if (schemes === undefined) {
    return [];
  }

  return Object.entries(schemes).map(([name, schemeValue]) => {
    const scheme = asRecord(schemeValue) ?? {};
    const type = asString(scheme["type"]);
    const schemeName = asString(scheme["scheme"]);
    const bearerFormat = asString(scheme["bearerFormat"]);
    const inValue = asString(scheme["in"]);
    const nameField = asString(scheme["name"]);

    return OpenApiSecuritySchemeInventoryItemSchema.parse({
      name,
      pointer: `/components/securitySchemes/${escapeJsonPointer(name)}`,
      ...(type === undefined ? {} : { type }),
      ...(schemeName === undefined ? {} : { scheme: schemeName }),
      ...(bearerFormat === undefined ? {} : { bearerFormat }),
      ...(inValue === undefined ? {} : { in: inValue }),
      ...(nameField === undefined ? {} : { nameField }),
    });
  });
}

function collectRefs(document: Record<string, unknown>) {
  const refs: Array<{ pointer: string; ref: string }> = [];

  walk(document, "", (pointer, value) => {
    if (!isRecord(value)) {
      return;
    }

    const ref = value["$ref"];

    if (typeof ref === "string") {
      refs.push(
        OpenApiRefInventoryItemSchema.parse({
          pointer: pointer.length === 0 ? "/" : pointer,
          ref,
        }),
      );
    }
  });

  return refs;
}

function collectRequestContentTypes(operation: Record<string, unknown>): string[] {
  const requestBody = asRecord(operation["requestBody"]);
  const content = asRecord(requestBody?.["content"]);

  return content === undefined ? [] : Object.keys(content).sort();
}

function collectResponseStatuses(operation: Record<string, unknown>): string[] {
  const responses = asRecord(operation["responses"]);

  return responses === undefined ? [] : Object.keys(responses).sort();
}

function collectResponseContentTypes(operation: Record<string, unknown>): string[] {
  const responses = asRecord(operation["responses"]);

  if (responses === undefined) {
    return [];
  }

  const contentTypes = new Set<string>();

  for (const responseValue of Object.values(responses)) {
    const response = asRecord(responseValue);
    const content = asRecord(response?.["content"]);

    if (content === undefined) {
      continue;
    }

    Object.keys(content).forEach((contentType) => contentTypes.add(contentType));
  }

  return [...contentTypes].sort();
}

function collectOperationSecuritySchemeNames(
  document: Record<string, unknown>,
  operation: Record<string, unknown>,
): string[] {
  const operationSecurity = Array.isArray(operation["security"])
    ? operation["security"]
    : Array.isArray(document["security"])
      ? document["security"]
      : [];

  const names = new Set<string>();

  for (const requirement of operationSecurity) {
    if (!isRecord(requirement)) {
      continue;
    }

    Object.keys(requirement).forEach((name) => names.add(name));
  }

  return [...names].sort();
}

function hasRef(value: unknown): boolean {
  let found = false;

  walk(value, "", (_pointer, current) => {
    if (isRecord(current) && typeof current["$ref"] === "string") {
      found = true;
    }
  });

  return found;
}

function walk(
  value: unknown,
  pointer: string,
  visitor: (pointer: string, value: unknown) => void,
): void {
  visitor(pointer, value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${pointer}/${index}`, visitor);
    });
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, `${pointer}/${escapeJsonPointer(key)}`, visitor);
    }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
