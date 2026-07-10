import type {
  FigmaAssetInventoryItem,
  FigmaComponentInventoryItem,
  FigmaTokenInventoryItem,
} from "./figma-design-inventory.js";

export function parseComponentsFromText(content: string): FigmaComponentInventoryItem[] {
  const components: FigmaComponentInventoryItem[] = [];
  const seen = new Set<string>();

  const xmlLikeNodePattern = /<[^>]*\bid=["'][^"']+["'][^>]*>/gi;

  for (const match of content.matchAll(xmlLikeNodePattern)) {
    const node = match[0];
    const nodeId = readXmlAttribute(node, "id");
    const type = readXmlAttribute(node, "type");

    if (nodeId === undefined || seen.has(nodeId)) continue;

    const name = readXmlAttribute(node, "name") ?? nodeId;
    const looksLikeComponent =
      /component|instance|button|input|chip|modal|sheet|card|navigation|tab/i.test(
        `${name} ${type ?? ""}`,
      );

    if (!looksLikeComponent) continue;

    seen.add(nodeId);

    components.push({
      nodeId,
      name,
      ...(type === undefined ? {} : { type }),
      variantProperties: {},
      mapped: false,
    });
  }

  return components;
}

export function parseTokensFromText(content: string): FigmaTokenInventoryItem[] {
  const tokens: FigmaTokenInventoryItem[] = [];
  const seen = new Set<string>();

  const variableNamePattern =
    /(?:variable|style|token|color|spacing|radius|typography)[\s:/_-]+([A-Za-z0-9_.\-/]+)/gi;

  for (const match of content.matchAll(variableNamePattern)) {
    const name = match[1];

    if (name === undefined || seen.has(name)) continue;

    seen.add(name);

    tokens.push({
      name,
      kind: inferTokenKind(name),
      source: "variable-defs",
    });
  }

  return tokens;
}

export function parseAssetsFromText(content: string): FigmaAssetInventoryItem[] {
  const assets: FigmaAssetInventoryItem[] = [];
  const seen = new Set<string>();

  const assetPattern = /<[^>]*\bid=["'][^"']+["'][^>]*>/gi;

  for (const match of content.matchAll(assetPattern)) {
    const node = match[0];
    const nodeId = readXmlAttribute(node, "id");
    const name = readXmlAttribute(node, "name");

    if (
      nodeId === undefined ||
      name === undefined ||
      !/icon|image|vector|svg/i.test(name) ||
      seen.has(nodeId)
    ) {
      continue;
    }

    seen.add(nodeId);

    assets.push({
      nodeId,
      name,
      kind: inferAssetKind(name),
      exportable: undefined,
    });
  }

  return assets;
}

export function parseCodeConnectMap(
  content: string,
): Map<string, { componentName?: string; source?: string }> {
  const result = new Map<string, { componentName?: string; source?: string }>();

  try {
    const parsed = JSON.parse(content) as unknown;

    collectMappings(parsed, result);
  } catch {
    const nodePattern =
      /([0-9]+:[0-9]+).*?(?:componentName|component)[:=]["']?([A-Za-z0-9_.$-]+)/gi;

    for (const match of content.matchAll(nodePattern)) {
      const nodeId = match[1];
      const componentName = match[2];

      if (nodeId !== undefined) {
        result.set(nodeId, compactMapping({ componentName }));
      }
    }
  }

  return result;
}

function collectMappings(
  value: unknown,
  result: Map<string, { componentName?: string; source?: string }>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMappings(item, result));
    return;
  }

  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  const nodeId =
    getString(record, "nodeId") ?? getString(record, "figmaNodeId") ?? getString(record, "id");

  if (nodeId !== undefined && /^\d+:\d+/.test(nodeId)) {
    result.set(
      nodeId,
      compactMapping({
        componentName: getString(record, "componentName") ?? getString(record, "component"),
        source: getString(record, "source") ?? getString(record, "importPath"),
      }),
    );
  }

  Object.values(record).forEach((child) => collectMappings(child, result));
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readXmlAttribute(node: string, attribute: string): string | undefined {
  const match = new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i").exec(node);

  return match?.[1];
}

function compactMapping(input: {
  componentName?: string | undefined;
  source?: string | undefined;
}): {
  componentName?: string;
  source?: string;
} {
  return {
    ...(input.componentName === undefined ? {} : { componentName: input.componentName }),
    ...(input.source === undefined ? {} : { source: input.source }),
  };
}

function inferTokenKind(name: string): FigmaTokenInventoryItem["kind"] {
  if (/color|fill|background|foreground|border/i.test(name)) return "color";
  if (/space|spacing|gap|padding|margin/i.test(name)) return "spacing";
  if (/radius|round/i.test(name)) return "radius";
  if (/font|text|typography|title|body|label/i.test(name)) return "typography";
  if (/shadow|blur|effect/i.test(name)) return "effect";

  return "unknown";
}

function inferAssetKind(name: string): FigmaAssetInventoryItem["kind"] {
  if (/icon|svg/i.test(name)) return "icon";
  if (/vector/i.test(name)) return "vector";
  if (/image|photo|png|jpg|jpeg/i.test(name)) return "image";

  return "unknown";
}
