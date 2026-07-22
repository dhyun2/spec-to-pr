import { createHash } from "node:crypto";

import ts from "typescript";

import {
  type LegacyApiCallSite,
  type LegacyApiCandidate,
  type LegacyOriginRef,
  stableEndpointKey,
} from "./legacy-api-contracts.js";
import type { LegacyGraphFile, LegacySourceGraph } from "./legacy-source-graph.js";

const HTTP_METHODS = new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH"]);

type EndpointExpression = {
  pathTemplate?: string;
  originRef?: LegacyOriginRef;
  confidence: LegacyApiCandidate["confidence"];
};

type TerminalCall = EndpointExpression & {
  method: LegacyApiCandidate["method"];
  receiver: string;
  transportRef?: string;
  terminalKind: LegacyApiCandidate["terminalKind"];
  node: ts.CallExpression;
  urlNode?: ts.Expression;
  optionsNode?: ts.Expression;
};

type FileBindings = {
  sourceFile: ts.SourceFile;
  variables: Map<string, ts.Expression>;
  receivers: Map<string, string>;
};

export function discoverLegacyApiCandidates(graph: LegacySourceGraph): LegacyApiCandidate[] {
  const candidates = new Map<string, LegacyApiCandidate>();
  for (const file of graph.ownedFiles) {
    if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/iu.test(file.absolutePath)) continue;
    const bindings = bindingsFor(file);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const terminal = terminalCall(node, bindings, graph);
        if (terminal !== undefined) mergeCandidate(candidates, file, bindings, terminal);
      }
      ts.forEachChild(node, visit);
    };
    visit(bindings.sourceFile);
  }
  return [...candidates.values()].sort((left, right) =>
    `${left.operationKey}:${left.endpointKey}`.localeCompare(
      `${right.operationKey}:${right.endpointKey}`,
    ),
  );
}

function bindingsFor(file: LegacyGraphFile): FileBindings {
  const sourceFile = sourceFileFor(file.content, file.absolutePath);
  const variables = new Map<string, ts.Expression>();
  const receivers = new Map<string, string>([["axios", "axios"]]);
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      variables.set(node.name.text, node.initializer);
      if (ts.isNewExpression(node.initializer)) {
        const constructorName = expressionText(node.initializer.expression, sourceFile);
        if (looksLikeHttpReceiver(constructorName)) {
          receivers.set(node.name.text, constructorName);
        }
      } else if (
        ts.isCallExpression(node.initializer) &&
        propertyName(node.initializer.expression) === "create" &&
        expressionText(propertyReceiver(node.initializer.expression)!, sourceFile) === "axios"
      ) {
        receivers.set(node.name.text, "axios");
      }
    }
    if (ts.isImportDeclaration(node) && node.importClause !== undefined) {
      const names: string[] = [];
      if (node.importClause.name !== undefined) names.push(node.importClause.name.text);
      const bindings = node.importClause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        names.push(...bindings.elements.map((element) => element.name.text));
      }
      for (const name of names) {
        if (looksLikeHttpReceiver(name)) receivers.set(name, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, variables, receivers };
}

function terminalCall(
  node: ts.CallExpression,
  bindings: FileBindings,
  graph: LegacySourceGraph,
): TerminalCall | undefined {
  if (isFetchExpression(node.expression, bindings.sourceFile)) {
    const first = node.arguments[0];
    if (first === undefined) return undefined;
    const request =
      ts.isNewExpression(first) &&
      expressionText(first.expression, bindings.sourceFile) === "Request";
    const urlNode = request ? first.arguments?.[0] : first;
    if (urlNode === undefined) return undefined;
    const requestOptions = request ? first.arguments?.[1] : undefined;
    const optionsNode = node.arguments[1] ?? requestOptions;
    return {
      ...endpointFromExpression(urlNode, bindings, graph),
      method: methodFromOptions(optionsNode, bindings) ?? "GET",
      receiver: "fetch",
      transportRef: "fetch",
      terminalKind: "fetch",
      node,
      urlNode,
      ...(optionsNode === undefined ? {} : { optionsNode }),
    };
  }

  if (isDirectAxiosExpression(node.expression, bindings.sourceFile)) {
    const first = node.arguments[0];
    if (first === undefined) return undefined;
    if (ts.isObjectLiteralExpression(resolveExpression(first, bindings))) {
      const config = resolveExpression(first, bindings) as ts.ObjectLiteralExpression;
      const urlNode = objectProperty(config, ["url", "path"]);
      if (urlNode === undefined) return undefined;
      return {
        ...endpointFromExpression(urlNode, bindings, graph),
        method: methodFromOptions(config, bindings) ?? "UNKNOWN",
        receiver: "axios",
        transportRef: "axios",
        terminalKind: "request-config",
        node,
        urlNode,
        optionsNode: config,
      };
    }
    return {
      ...endpointFromExpression(first, bindings, graph),
      method: methodFromOptions(node.arguments[1], bindings) ?? "GET",
      receiver: "axios",
      transportRef: "axios",
      terminalKind: "http-client",
      node,
      urlNode: first,
      ...(node.arguments[1] === undefined ? {} : { optionsNode: node.arguments[1] }),
    };
  }

  const methodName = propertyName(node.expression)?.toUpperCase();
  const receiverNode = propertyReceiver(node.expression);
  if (methodName === undefined || receiverNode === undefined || !HTTP_METHODS.has(methodName)) {
    if (methodName !== "REQUEST" || receiverNode === undefined) return undefined;
  }
  const receiver = expressionText(receiverNode, bindings.sourceFile);
  const transportRef = transportForReceiver(receiver, bindings);
  if (transportRef === undefined) return undefined;
  const first = node.arguments[0];
  if (first === undefined) return undefined;
  if (methodName === "REQUEST") {
    const resolvedFirst = resolveExpression(first, bindings);
    if (ts.isObjectLiteralExpression(resolvedFirst)) {
      const urlNode = objectProperty(resolvedFirst, ["url", "path"]);
      if (urlNode === undefined) return undefined;
      return {
        ...endpointFromExpression(urlNode, bindings, graph),
        method: methodFromOptions(resolvedFirst, bindings) ?? "UNKNOWN",
        receiver,
        transportRef,
        terminalKind: "request-config",
        node,
        urlNode,
        optionsNode: resolvedFirst,
      };
    }
    return {
      ...endpointFromExpression(first, bindings, graph),
      method: methodFromOptions(node.arguments[1], bindings) ?? "UNKNOWN",
      receiver,
      transportRef,
      terminalKind: "request-config",
      node,
      urlNode: first,
      ...(node.arguments[1] === undefined ? {} : { optionsNode: node.arguments[1] }),
    };
  }
  return {
    ...endpointFromExpression(first, bindings, graph),
    method: methodName as TerminalCall["method"],
    receiver,
    transportRef,
    terminalKind: "http-client",
    node,
    urlNode: first,
    ...(node.arguments[1] === undefined ? {} : { optionsNode: node.arguments[1] }),
  };
}

function endpointFromExpression(
  expression: ts.Expression,
  bindings: FileBindings,
  graph: LegacySourceGraph,
): EndpointExpression {
  const resolved = resolveExpression(expression, bindings);
  const fragments = endpointFragments(resolved, bindings);
  if (fragments === undefined) return { confidence: "low" };
  let rawPath = "";
  let originRef: LegacyOriginRef | undefined;
  let confidence: EndpointExpression["confidence"] = "high";
  for (const fragment of fragments) {
    if (fragment.kind === "text") {
      rawPath += fragment.value;
    } else if (fragment.kind === "parameter") {
      rawPath += `{${fragment.value}}`;
    } else {
      if (isSafeUrlEnvironmentName(fragment.value)) {
        const reference = graph.environmentRefs.find(
          (item) => item.runtime === fragment.runtime && item.name === fragment.value,
        );
        originRef = {
          kind: "environment",
          runtime: fragment.runtime,
          name: fragment.value,
          ...(reference?.sanitizedOrigin === undefined
            ? {}
            : { sanitizedOrigin: reference.sanitizedOrigin }),
          ...(reference?.sanitizedOrigins === undefined
            ? {}
            : { sanitizedOrigins: reference.sanitizedOrigins }),
        };
      } else {
        rawPath += "{dynamic}";
        confidence = "low";
      }
    }
  }
  const absolute = literalHttpUrl(rawPath);
  if (absolute !== undefined && originRef === undefined) {
    originRef = { kind: "literal", sanitizedOrigin: absolute.origin };
    rawPath = absolute.path;
  }
  if (originRef !== undefined && /^(?:https?:)?\/\//iu.test(rawPath)) {
    return { originRef, confidence: "low" };
  }
  if (rawPath.includes("{dynamic}")) confidence = "medium";
  const pathTemplate = normalizedPathTemplate(rawPath);
  return {
    ...(pathTemplate === undefined ? {} : { pathTemplate }),
    ...(originRef === undefined ? {} : { originRef }),
    confidence: pathTemplate === undefined ? "low" : confidence,
  };
}

type EndpointFragment =
  | { kind: "text"; value: string }
  | { kind: "parameter"; value: string }
  | { kind: "environment"; runtime: "process.env" | "import.meta.env"; value: string };

function endpointFragments(
  expression: ts.Expression,
  bindings: FileBindings,
): EndpointFragment[] | undefined {
  const resolved = resolveExpression(expression, bindings);
  if (ts.isStringLiteralLike(resolved)) return [{ kind: "text", value: resolved.text }];
  if (ts.isTemplateExpression(resolved)) {
    const result: EndpointFragment[] = [{ kind: "text", value: resolved.head.text }];
    for (const span of resolved.templateSpans) {
      result.push(fragmentForExpression(span.expression));
      result.push({ kind: "text", value: span.literal.text });
    }
    return result;
  }
  if (ts.isBinaryExpression(resolved) && resolved.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = endpointFragments(resolved.left, bindings);
    const right = endpointFragments(resolved.right, bindings);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  const environment = environmentExpression(resolved);
  if (environment !== undefined) return [{ kind: "environment", ...environment }];
  return undefined;
}

function fragmentForExpression(expression: ts.Expression): EndpointFragment {
  const environment = environmentExpression(expression);
  if (environment !== undefined) return { kind: "environment", ...environment };
  return { kind: "parameter", value: parameterName(expression) };
}

function environmentExpression(
  expression: ts.Expression,
): { runtime: "process.env" | "import.meta.env"; value: string } | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const env = expression.expression;
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== "env") return undefined;
  if (ts.isIdentifier(env.expression) && env.expression.text === "process") {
    return { runtime: "process.env", value: expression.name.text };
  }
  if (
    ts.isMetaProperty(env.expression) &&
    env.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  ) {
    return { runtime: "import.meta.env", value: expression.name.text };
  }
  return undefined;
}

function parameterName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return safeParameter(expression.text);
  if (ts.isPropertyAccessExpression(expression)) return safeParameter(expression.name.text);
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined) {
    if (ts.isStringLiteralLike(expression.argumentExpression)) {
      return safeParameter(expression.argumentExpression.text);
    }
  }
  return "dynamic";
}

function safeParameter(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) ? value : "dynamic";
}

function methodFromOptions(
  expression: ts.Expression | undefined,
  bindings: FileBindings,
): LegacyApiCandidate["method"] | undefined {
  if (expression === undefined) return undefined;
  const resolved = resolveExpression(expression, bindings);
  if (!ts.isObjectLiteralExpression(resolved)) return undefined;
  const method = objectProperty(resolved, ["method"]);
  if (method === undefined) return undefined;
  const value = resolveExpression(method, bindings);
  if (!ts.isStringLiteralLike(value)) return undefined;
  const normalized = value.text.toUpperCase();
  return HTTP_METHODS.has(normalized) ? (normalized as LegacyApiCandidate["method"]) : undefined;
}

function resolveExpression(expression: ts.Expression, bindings: FileBindings): ts.Expression {
  let current = unwrapExpression(expression);
  const visited = new Set<string>();
  while (
    ts.isIdentifier(current) &&
    bindings.variables.has(current.text) &&
    !visited.has(current.text)
  ) {
    visited.add(current.text);
    current = unwrapExpression(bindings.variables.get(current.text)!);
  }
  return current;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrapExpression(expression.expression);
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  names: string[],
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (name !== undefined && names.includes(name)) return property.initializer;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function transportForReceiver(receiver: string, bindings: FileBindings): string | undefined {
  const root = receiver.split(/[.[\]]/u)[0]!;
  if (bindings.receivers.has(receiver)) return bindings.receivers.get(receiver);
  if (bindings.receivers.has(root)) return bindings.receivers.get(root);
  return looksLikeHttpReceiver(root) ? root : undefined;
}

function looksLikeHttpReceiver(value: string): boolean {
  return (
    /^(?:axios|api|http|client|request)$/iu.test(value) ||
    /(?:api|http|axios|request|rest)(?:client|service|instance)?$/iu.test(value) ||
    /(?:client|service)(?:instance)?$/iu.test(value)
  );
}

function isSafeUrlEnvironmentName(name: string): boolean {
  return (
    !/(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|TOKEN)(?:_|$)/iu.test(name) &&
    /(?:^|_)(?:API|BASE|ENDPOINT|GATEWAY|GW|HOST|ORIGIN|URI|URL)(?:_|$)/iu.test(name)
  );
}

function isFetchExpression(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  const text = expressionText(expression, sourceFile).replace(/\?\./gu, ".");
  return text === "fetch" || text === "globalThis.fetch" || text === "window.fetch";
}

function isDirectAxiosExpression(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  return expressionText(expression, sourceFile).replace(/\?\./gu, ".") === "axios";
}

function propertyName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function propertyReceiver(expression: ts.Expression): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expression.expression;
  }
  return undefined;
}

function expressionText(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return expression.getText(sourceFile).replace(/\s+/gu, "");
}

function literalHttpUrl(value: string): { origin: string; path: string } | undefined {
  try {
    const parsed = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (!/^https?:$/u.test(parsed.protocol)) return undefined;
    parsed.username = "";
    parsed.password = "";
    return { origin: parsed.origin, path: parsed.pathname };
  } catch {
    return undefined;
  }
}

function normalizedPathTemplate(value: string): string | undefined {
  const withoutQuery = value.trim().split(/[?#]/u, 1)[0] ?? "";
  if (withoutQuery === "") return undefined;
  return `/${withoutQuery.replace(/^\/+/, "")}`.replace(/\/{2,}/gu, "/");
}

function mergeCandidate(
  candidates: Map<string, LegacyApiCandidate>,
  file: LegacyGraphFile,
  bindings: FileBindings,
  terminal: TerminalCall,
): void {
  const location = bindings.sourceFile.getLineAndCharacterOfPosition(
    terminal.node.getStart(bindings.sourceFile),
  );
  const locator = `${file.sourcePath}:${location.line + 1}:${location.character + 1}`;
  const endpointKey =
    terminal.pathTemplate === undefined
      ? `endpoint_${createHash("sha256")
          .update("dynamic")
          .update("\0")
          .update(locator)
          .digest("hex")
          .slice(0, 24)}`
      : stableEndpointKey(terminal);
  const wrapperChain = enclosingWrappers(terminal.node, bindings.sourceFile);
  const callSite: LegacyApiCallSite = {
    callSiteKey: `call_${createHash("sha256").update(locator).digest("hex").slice(0, 24)}`,
    ownerSourcePath: file.sourcePath,
    terminalSourcePath: file.sourcePath,
    line: location.line + 1,
    column: location.character + 1,
    receiver: terminal.receiver,
    ...(terminal.transportRef === undefined ? {} : { transportRef: terminal.transportRef }),
    wrapperChain,
  };
  const existing = candidates.get(endpointKey);
  if (existing !== undefined) {
    if (!existing.callSites.some((site) => site.callSiteKey === callSite.callSiteKey)) {
      existing.callSites.push(callSite);
      existing.callSites.sort((left, right) => left.callSiteKey.localeCompare(right.callSiteKey));
      existing.witnesses.push({ kind: "source", locator });
      existing.witnesses.sort((left, right) => left.locator.localeCompare(right.locator));
    }
    return;
  }
  candidates.set(endpointKey, {
    candidateKey: `candidate_${endpointKey.slice("endpoint_".length)}`,
    endpointKey,
    operationKey: `${terminal.method} ${terminal.pathTemplate ?? "path:unknown"}`,
    method: terminal.method,
    pathTemplate: terminal.pathTemplate,
    ...(terminal.originRef === undefined ? {} : { originRef: terminal.originRef }),
    confidence: terminal.confidence,
    terminalKind: terminal.terminalKind,
    callSites: [callSite],
    requestEvidence: requestEvidence(terminal, bindings),
    responseEvidence: { selectors: [] },
    witnesses: [{ kind: "source", locator }],
  });
}

function requestEvidence(
  terminal: TerminalCall,
  bindings: FileBindings,
): LegacyApiCandidate["requestEvidence"] {
  const queryKeys: string[] = [];
  const bodySymbols: string[] = [];
  const headerKeys: string[] = [];
  if (terminal.optionsNode !== undefined) {
    const options = resolveExpression(terminal.optionsNode, bindings);
    if (ts.isObjectLiteralExpression(options)) {
      const params = objectProperty(options, ["params", "query"]);
      const body = objectProperty(options, ["body", "data"]);
      const headers = objectProperty(options, ["headers"]);
      if (params !== undefined) queryKeys.push(...objectKeysOrSymbol(params, bindings));
      if (body !== undefined) bodySymbols.push(...objectKeysOrSymbol(body, bindings));
      if (headers !== undefined) headerKeys.push(...objectKeysOrSymbol(headers, bindings));
    }
  }
  return {
    queryKeys: [...new Set(queryKeys)].sort(),
    bodySymbols: [...new Set(bodySymbols)].sort(),
    headerKeys: [...new Set(headerKeys)].sort(),
  };
}

function objectKeysOrSymbol(expression: ts.Expression, bindings: FileBindings): string[] {
  const resolved = resolveExpression(expression, bindings);
  if (ts.isObjectLiteralExpression(resolved)) {
    return resolved.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
        return [];
      const name = propertyNameText(property.name);
      return name === undefined ? [] : [name];
    });
  }
  return ts.isIdentifier(resolved) ? [resolved.text] : [];
}

function enclosingWrappers(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const wrappers: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      (ts.isMethodDeclaration(current) || ts.isPropertyAssignment(current)) &&
      current.name !== undefined
    ) {
      const name = propertyNameText(current.name);
      if (name !== undefined) wrappers.unshift(`${sourceFile.fileName}#${name}`);
    } else if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      wrappers.unshift(`${sourceFile.fileName}#${current.name.text}`);
    } else if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      wrappers.unshift(`${sourceFile.fileName}#${current.parent.name.text}`);
    }
    current = current.parent;
  }
  return wrappers.slice(-32);
}

function sourceFileFor(content: string, filePath: string): ts.SourceFile {
  const script = /\.(?:vue|svelte)$/iu.test(filePath)
    ? [...content.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
        .map((match) => match[1] ?? "")
        .join("\n")
    : content;
  const kind = /\.tsx$/iu.test(filePath)
    ? ts.ScriptKind.TSX
    : /\.jsx$/iu.test(filePath)
      ? ts.ScriptKind.JSX
      : /\.tsx?$/iu.test(filePath)
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  return ts.createSourceFile(filePath, script, ts.ScriptTarget.Latest, true, kind);
}
