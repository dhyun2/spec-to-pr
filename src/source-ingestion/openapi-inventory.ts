export type OpenApiInventorySource = { path: string; text: string };

export type OpenApiInventoryOperation = {
  operationKey: string;
  method: "GET" | "PUT" | "POST" | "DELETE" | "OPTIONS" | "HEAD" | "PATCH" | "TRACE";
  path: string;
  operationId?: string;
  sourceLocator: string;
  serverOrigins?: string[];
};

export function inventoryOpenApiOperations(
  files: readonly OpenApiInventorySource[],
): OpenApiInventoryOperation[] {
  const operations: OpenApiInventoryOperation[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let document: unknown;
    try {
      document = parseYaml(file.text);
    } catch {
      throw new Error(`OpenAPI source could not be parsed: ${file.path}`);
    }
    const root = objectValue(document, `OpenAPI source must be an object: ${file.path}`);
    const paths = objectValue(root["paths"], `OpenAPI source has no paths object: ${file.path}`);
    for (const [operationPath, rawPathItem] of Object.entries(paths)) {
      if (!operationPath.startsWith("/") || !isObject(rawPathItem)) continue;
      const pathItem = resolvePathItem(root, rawPathItem, new Set(), 0);
      for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
        if (!/^(?:get|put|post|delete|options|head|patch|trace)$/i.test(rawMethod)) continue;
        const method = rawMethod.toUpperCase() as OpenApiInventoryOperation["method"];
        const operationKey = `${method} ${operationPath}`;
        if (seen.has(operationKey)) throw new Error(`Duplicate OpenAPI operation ${operationKey}`);
        const operationId =
          isObject(rawOperation) &&
          typeof rawOperation["operationId"] === "string" &&
          rawOperation["operationId"].trim() !== ""
            ? rawOperation["operationId"]
            : undefined;
        const serverOrigins = safeServerOrigins(
          isObject(rawOperation) ? rawOperation["servers"] : undefined,
          pathItem["servers"],
          root["servers"],
        );
        operations.push({
          operationKey,
          method,
          path: operationPath,
          ...(operationId === undefined ? {} : { operationId }),
          ...(serverOrigins.length === 0 ? {} : { serverOrigins }),
          sourceLocator: file.path,
        });
        seen.add(operationKey);
        if (operations.length > 1_000) {
          throw new Error("OpenAPI operation inventory exceeds 1000");
        }
      }
    }
  }
  if (files.length > 0 && operations.length === 0) {
    throw new Error("OpenAPI sources must declare at least one operation");
  }
  return operations;
}

function safeServerOrigins(...candidates: unknown[]): string[] {
  const selected = candidates.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(selected)) return [];
  const origins = new Set<string>();
  for (const server of selected) {
    if (!isObject(server) || typeof server["url"] !== "string" || server["url"].includes("{")) {
      continue;
    }
    try {
      const parsed = new URL(server["url"]);
      if (!/^https?:$/u.test(parsed.protocol)) continue;
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      origins.add(parsed.toString());
    } catch {
      continue;
    }
  }
  return [...origins].sort();
}

function resolvePathItem(
  root: Record<string, unknown>,
  candidate: Record<string, unknown>,
  visited: Set<string>,
  depth: number,
): Record<string, unknown> {
  if (depth > 32) throw new Error("OpenAPI Path Item ref depth exceeds 32");
  const reference = candidate["$ref"];
  if (reference === undefined) return candidate;
  if (typeof reference !== "string" || !reference.startsWith("#/")) {
    throw new Error("OpenAPI external Path Item ref is not supported");
  }
  if (visited.has(reference)) throw new Error(`OpenAPI Path Item ref cycle: ${reference}`);
  const nextVisited = new Set(visited).add(reference);
  const resolved = resolveJsonPointer(root, reference);
  const base = resolvePathItem(
    root,
    objectValue(resolved, `OpenAPI Path Item ref is broken: ${reference}`),
    nextVisited,
    depth + 1,
  );
  const siblings = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "$ref"));
  return { ...base, ...siblings };
}

function resolveJsonPointer(root: Record<string, unknown>, reference: string): unknown {
  let current: unknown = root;
  for (const rawToken of reference.slice(2).split("/")) {
    const token = decodeURIComponent(rawToken).replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) || !(token in current)) {
      throw new Error(`OpenAPI Path Item ref is broken: ${reference}`);
    }
    current = current[token];
  }
  return current;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(message);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import { parse as parseYaml } from "yaml";
