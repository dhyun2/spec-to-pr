import { parse } from "@babel/parser";

export type LegacyAstNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
  [key: string]: unknown;
};

export type ParsedLegacySource = {
  code: string;
  root: LegacyAstNode;
};

export function parseLegacySource(content: string, filePath: string): ParsedLegacySource {
  const code = /\.(?:vue|svelte)$/iu.test(filePath)
    ? [...content.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
        .map((match) => match[1] ?? "")
        .join("\n")
    : content;
  const parsed = parse(code, {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    plugins: [
      "typescript",
      "jsx",
      "decorators-legacy",
      "classProperties",
      "classPrivateProperties",
      "classPrivateMethods",
      "dynamicImport",
      "importMeta",
      "optionalChaining",
      "topLevelAwait",
    ],
  });
  return { code, root: parsed.program as unknown as LegacyAstNode };
}

export function walkLegacyAst(node: LegacyAstNode, visit: (node: LegacyAstNode) => void): void {
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra", "errors", "comments", "tokens"].includes(key)) continue;
    if (isLegacyAstNode(value)) {
      walkLegacyAst(value, visit);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isLegacyAstNode(item)) walkLegacyAst(item, visit);
      }
    }
  }
}

export function isLegacyAstNode(value: unknown): value is LegacyAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function legacyNodeText(node: LegacyAstNode, parsed: ParsedLegacySource): string {
  if (typeof node.start !== "number" || typeof node.end !== "number") return "";
  return parsed.code.slice(node.start, node.end).replace(/\s+/gu, "");
}

export function legacyPropertyName(node: LegacyAstNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (
    node.type === "Identifier" ||
    node.type === "StringLiteral" ||
    node.type === "NumericLiteral"
  ) {
    const value = node.type === "Identifier" ? node["name"] : node["value"];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  }
  return undefined;
}

export function legacyMemberProperty(node: LegacyAstNode): string | undefined {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")
    return undefined;
  return legacyPropertyName(node["property"] as LegacyAstNode | undefined);
}

export function legacyMemberObject(node: LegacyAstNode): LegacyAstNode | undefined {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")
    return undefined;
  return isLegacyAstNode(node["object"]) ? node["object"] : undefined;
}

export function unwrapLegacyExpression(node: LegacyAstNode): LegacyAstNode {
  if (
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSTypeAssertion",
      "TSNonNullExpression",
      "TypeCastExpression",
      "ChainExpression",
    ].includes(node.type) &&
    isLegacyAstNode(node["expression"])
  ) {
    return unwrapLegacyExpression(node["expression"]);
  }
  return node;
}
