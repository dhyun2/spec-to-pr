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

export function walkLegacyAst(
  node: LegacyAstNode,
  visit: (node: LegacyAstNode, parent?: LegacyAstNode) => void,
  parent?: LegacyAstNode,
): void {
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra", "errors", "comments", "tokens"].includes(key)) continue;
    if (isLegacyAstNode(value)) {
      walkLegacyAst(value, visit, node);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isLegacyAstNode(item)) walkLegacyAst(item, visit, node);
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

export function legacyAstNode(value: unknown): LegacyAstNode | undefined {
  return isLegacyAstNode(value) ? value : undefined;
}

export function legacyIdentifierName(value: unknown): string | undefined {
  return isLegacyAstNode(value) && value.type === "Identifier" && typeof value["name"] === "string"
    ? value["name"]
    : undefined;
}

export function legacyStringLiteralValue(node: LegacyAstNode | undefined): string | undefined {
  return node?.type === "StringLiteral" && typeof node["value"] === "string"
    ? node["value"]
    : undefined;
}

export function legacyProgramBody(root: LegacyAstNode): LegacyAstNode[] {
  return Array.isArray(root["body"]) ? root["body"].filter(isLegacyAstNode) : [];
}

export function legacyExportedSelection(
  root: LegacyAstNode,
  selector: string,
): LegacyAstNode | undefined {
  const [base, ...members] = selector.split(".");
  for (const statement of legacyProgramBody(root)) {
    if (statement.type === "ExportDefaultDeclaration" && base === "default") {
      const declaration = legacyAstNode(statement["declaration"]);
      if (declaration === undefined) return undefined;
      const localName = legacyIdentifierName(declaration);
      const selected =
        localName === undefined ? declaration : legacyLocalSelection(root, localName);
      return selected === undefined ? undefined : selectLegacyMembers(selected, members);
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = legacyAstNode(statement["declaration"]);
    const selected = legacyDeclarationSelection(declaration, base);
    if (selected !== undefined) return selectLegacyMembers(selected, members);
    if (statement["source"] !== null && statement["source"] !== undefined) continue;
    if (!Array.isArray(statement["specifiers"])) continue;
    for (const specifier of statement["specifiers"]) {
      if (!isLegacyAstNode(specifier)) continue;
      if (legacyPropertyName(legacyAstNode(specifier["exported"])) !== base) continue;
      const localName = legacyPropertyName(legacyAstNode(specifier["local"]));
      const local = localName === undefined ? undefined : legacyLocalSelection(root, localName);
      return local === undefined ? specifier : selectLegacyMembers(local, members);
    }
  }
  return undefined;
}

export function legacyLocalSelection(root: LegacyAstNode, name: string): LegacyAstNode | undefined {
  for (const statement of legacyProgramBody(root)) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? legacyAstNode(statement["declaration"])
        : statement.type === "ExportDefaultDeclaration"
          ? undefined
          : statement;
    const selected = legacyDeclarationSelection(declaration, name);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

function legacyDeclarationSelection(
  declaration: LegacyAstNode | undefined,
  name: string | undefined,
): LegacyAstNode | undefined {
  if (declaration === undefined || name === undefined) return undefined;
  if (["FunctionDeclaration", "ClassDeclaration"].includes(declaration.type)) {
    return legacyIdentifierName(declaration["id"]) === name ? declaration : undefined;
  }
  if (declaration.type !== "VariableDeclaration" || !Array.isArray(declaration["declarations"])) {
    return undefined;
  }
  for (const item of declaration["declarations"]) {
    if (!isLegacyAstNode(item) || legacyIdentifierName(item["id"]) !== name) continue;
    return legacyAstNode(item["init"]);
  }
  return undefined;
}

function selectLegacyMembers(node: LegacyAstNode, members: string[]): LegacyAstNode | undefined {
  let current: LegacyAstNode | undefined = node;
  for (const member of members) {
    const resolved: LegacyAstNode | undefined =
      current === undefined ? undefined : unwrapLegacyExpression(current);
    if (resolved?.type !== "ObjectExpression" || !Array.isArray(resolved["properties"])) {
      return undefined;
    }
    current = resolved["properties"].flatMap((property) => {
      if (
        !isLegacyAstNode(property) ||
        legacyPropertyName(legacyAstNode(property["key"])) !== member
      ) {
        return [];
      }
      return property.type === "ObjectMethod" ? [property] : [legacyAstNode(property["value"])];
    })[0];
  }
  return current;
}
