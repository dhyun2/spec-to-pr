import type { OpenApiOperationInventoryItem } from "../openapi/openapi-inventory.js";

export type WrapperGenerationInput = {
  sourceKey: string;
  wrapperRoot: string;
  operations: OpenApiOperationInventoryItem[];
};

export type GeneratedWrapperFile = {
  path: string;
  content: string;
  operationKey: string;
  wrapperName: string;
};

export function generateFeatureWrappers(input: WrapperGenerationInput): GeneratedWrapperFile[] {
  return input.operations
    .filter((operation) => operation.operationId !== undefined)
    .map((operation) => {
      const wrapperName = wrapperNameFor(operation);
      const featureName = featureNameFor(operation);
      const fileName = `${kebabCase(wrapperName)}.ts`;

      return {
        path: `${input.wrapperRoot}/${featureName}/api/${fileName}`,
        operationKey: operationKey(operation),
        wrapperName,
        content: renderWrapper({
          sourceKey: input.sourceKey,
          operation,
          wrapperName,
        }),
      };
    });
}

function renderWrapper(input: {
  sourceKey: string;
  operation: OpenApiOperationInventoryItem;
  wrapperName: string;
}): string {
  const method = input.operation.method.toUpperCase();
  const path = input.operation.path;

  return `// AUTO-GENERATED wrapper skeleton by spec-to-pr.
// Review and adapt the generated client import to the target project's actual API client.
// Do not import generated clients directly from UI components.

import { apiClient } from "@/shared/api/generated/${input.sourceKey}";

export type ${capitalize(input.wrapperName)}Input = {
  params?: Record<string, unknown>;
  body?: unknown;
};

export async function ${input.wrapperName}(input: ${capitalize(input.wrapperName)}Input = {}) {
  return apiClient.request({
    method: ${JSON.stringify(method)},
    path: ${JSON.stringify(path)},
    params: input.params,
    body: input.body,
  });
}
`;
}

function wrapperNameFor(operation: OpenApiOperationInventoryItem): string {
  if (operation.operationId !== undefined) {
    return operation.operationId;
  }

  return `${operation.method}${operation.path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map(capitalize)
    .join("")}`;
}

function featureNameFor(operation: OpenApiOperationInventoryItem): string {
  const parts = operation.path.split("/").filter(Boolean);
  const first = parts[0] ?? "api";

  return kebabCase(first);
}

function operationKey(operation: OpenApiOperationInventoryItem): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
