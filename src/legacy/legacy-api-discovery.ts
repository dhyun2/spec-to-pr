import { createHash } from "node:crypto";

import {
  type LegacyApiCallSite,
  type LegacyApiCandidate,
  type LegacyOriginRef,
  stableEndpointKey,
} from "./legacy-api-contracts.js";
import {
  type LegacyAstNode,
  type ParsedLegacySource,
  isLegacyAstNode,
  legacyMemberObject,
  legacyMemberProperty,
  legacyNodeText,
  legacyPropertyName,
  parseLegacySource,
  unwrapLegacyExpression,
  walkLegacyAst,
} from "./legacy-parser.js";
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
  node: LegacyAstNode;
  optionsNode?: LegacyAstNode;
};

type FileBindings = {
  parsed: ParsedLegacySource;
  variables: Map<string, LegacyAstNode>;
  receivers: Map<string, string>;
};

export function discoverLegacyApiCandidates(graph: LegacySourceGraph): LegacyApiCandidate[] {
  const candidates = new Map<string, LegacyApiCandidate>();
  for (const file of graph.ownedFiles) {
    if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/iu.test(file.absolutePath)) continue;
    const bindings = bindingsFor(file);
    walkLegacyAst(bindings.parsed.root, (node) => {
      if (!isCallNode(node)) return;
      const terminal = terminalCall(node, bindings, graph);
      if (terminal !== undefined) mergeCandidate(candidates, file, bindings, terminal);
    });
  }
  return [...candidates.values()].sort((left, right) =>
    `${left.operationKey}:${left.endpointKey}`.localeCompare(
      `${right.operationKey}:${right.endpointKey}`,
    ),
  );
}

function bindingsFor(file: LegacyGraphFile): FileBindings {
  const parsed = parseLegacySource(file.content, file.absolutePath);
  const variables = new Map<string, LegacyAstNode>();
  const receivers = new Map<string, string>([["axios", "axios"]]);
  walkLegacyAst(parsed.root, (node) => {
    if (node.type === "VariableDeclarator") {
      const name = identifierName(node["id"]);
      const initializer = astNode(node["init"]);
      if (name === undefined || initializer === undefined) return;
      variables.set(name, initializer);
      if (initializer.type === "NewExpression") {
        const constructorNode = astNode(initializer["callee"]);
        const constructorName =
          constructorNode === undefined ? "" : legacyNodeText(constructorNode, parsed);
        if (looksLikeHttpReceiver(constructorName)) receivers.set(name, constructorName);
      } else if (
        isCallNode(initializer) &&
        legacyMemberProperty(astNode(initializer["callee"])!) === "create"
      ) {
        const callee = astNode(initializer["callee"]);
        const receiver = callee === undefined ? undefined : legacyMemberObject(callee);
        if (receiver !== undefined && legacyNodeText(receiver, parsed) === "axios") {
          receivers.set(name, "axios");
        }
      }
    }
    if (node.type === "ImportDeclaration") {
      const specifiers = node["specifiers"];
      if (!Array.isArray(specifiers)) return;
      for (const specifier of specifiers) {
        if (!isLegacyAstNode(specifier)) continue;
        const name = identifierName(specifier["local"]);
        if (name !== undefined && looksLikeHttpReceiver(name)) receivers.set(name, name);
      }
    }
  });
  return { parsed, variables, receivers };
}

function terminalCall(
  node: LegacyAstNode,
  bindings: FileBindings,
  graph: LegacySourceGraph,
): TerminalCall | undefined {
  const callee = astNode(node["callee"]);
  const args = callArguments(node);
  if (callee === undefined) return undefined;

  if (isFetchExpression(callee, bindings.parsed)) {
    const first = args[0];
    if (first === undefined) return undefined;
    const request =
      first.type === "NewExpression" &&
      astNode(first["callee"]) !== undefined &&
      legacyNodeText(astNode(first["callee"])!, bindings.parsed) === "Request";
    const requestArguments = request ? expressionArray(first["arguments"]) : [];
    const urlNode = request ? requestArguments[0] : first;
    if (urlNode === undefined) return undefined;
    const optionsNode = args[1] ?? (request ? requestArguments[1] : undefined);
    return {
      ...endpointFromExpression(urlNode, bindings, graph),
      method: methodFromOptions(optionsNode, bindings) ?? "GET",
      receiver: "fetch",
      transportRef: "fetch",
      terminalKind: "fetch",
      node,
      ...(optionsNode === undefined ? {} : { optionsNode }),
    };
  }

  if (isDirectAxiosExpression(callee, bindings.parsed)) {
    const first = args[0];
    if (first === undefined) return undefined;
    const resolvedFirst = resolveExpression(first, bindings);
    if (resolvedFirst.type === "ObjectExpression") {
      const urlNode = objectProperty(resolvedFirst, ["url", "path"]);
      if (urlNode === undefined) return undefined;
      return {
        ...endpointFromExpression(urlNode, bindings, graph),
        method: methodFromOptions(resolvedFirst, bindings) ?? "UNKNOWN",
        receiver: "axios",
        transportRef: "axios",
        terminalKind: "request-config",
        node,
        optionsNode: resolvedFirst,
      };
    }
    return {
      ...endpointFromExpression(first, bindings, graph),
      method: methodFromOptions(args[1], bindings) ?? "GET",
      receiver: "axios",
      transportRef: "axios",
      terminalKind: "http-client",
      node,
      ...(args[1] === undefined ? {} : { optionsNode: args[1] }),
    };
  }

  const methodName = legacyMemberProperty(callee)?.toUpperCase();
  const receiverNode = legacyMemberObject(callee);
  if (
    methodName === undefined ||
    receiverNode === undefined ||
    (!HTTP_METHODS.has(methodName) && methodName !== "REQUEST")
  ) {
    return undefined;
  }
  const receiver = legacyNodeText(receiverNode, bindings.parsed);
  const transportRef = transportForReceiver(receiver, bindings);
  if (transportRef === undefined) return undefined;
  const first = args[0];
  if (first === undefined) return undefined;
  if (methodName === "REQUEST") {
    const resolvedFirst = resolveExpression(first, bindings);
    if (resolvedFirst.type === "ObjectExpression") {
      const urlNode = objectProperty(resolvedFirst, ["url", "path"]);
      if (urlNode === undefined) return undefined;
      return {
        ...endpointFromExpression(urlNode, bindings, graph),
        method: methodFromOptions(resolvedFirst, bindings) ?? "UNKNOWN",
        receiver,
        transportRef,
        terminalKind: "request-config",
        node,
        optionsNode: resolvedFirst,
      };
    }
    return {
      ...endpointFromExpression(first, bindings, graph),
      method: methodFromOptions(args[1], bindings) ?? "UNKNOWN",
      receiver,
      transportRef,
      terminalKind: "request-config",
      node,
      ...(args[1] === undefined ? {} : { optionsNode: args[1] }),
    };
  }
  return {
    ...endpointFromExpression(first, bindings, graph),
    method: methodName as TerminalCall["method"],
    receiver,
    transportRef,
    terminalKind: "http-client",
    node,
    ...(args[1] === undefined ? {} : { optionsNode: args[1] }),
  };
}

function endpointFromExpression(
  expression: LegacyAstNode,
  bindings: FileBindings,
  graph: LegacySourceGraph,
): EndpointExpression {
  const fragments = endpointFragments(resolveExpression(expression, bindings), bindings);
  if (fragments === undefined) return { confidence: "low" };
  let rawPath = "";
  let originRef: LegacyOriginRef | undefined;
  let confidence: EndpointExpression["confidence"] = "high";
  for (const fragment of fragments) {
    if (fragment.kind === "text") rawPath += fragment.value;
    else if (fragment.kind === "parameter") rawPath += `{${fragment.value}}`;
    else if (isSafeUrlEnvironmentName(fragment.value)) {
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
  expression: LegacyAstNode,
  bindings: FileBindings,
): EndpointFragment[] | undefined {
  const resolved = resolveExpression(expression, bindings);
  if (resolved.type === "StringLiteral" && typeof resolved["value"] === "string") {
    return [{ kind: "text", value: resolved["value"] }];
  }
  if (resolved.type === "TemplateLiteral") {
    const quasis = Array.isArray(resolved["quasis"]) ? resolved["quasis"] : [];
    const expressions = expressionArray(resolved["expressions"]);
    const result: EndpointFragment[] = [];
    for (let index = 0; index < quasis.length; index += 1) {
      const quasi = quasis[index];
      if (isLegacyAstNode(quasi)) {
        const value = quasi["value"];
        result.push({
          kind: "text",
          value:
            typeof value === "object" && value !== null && "cooked" in value
              ? String((value as { cooked?: unknown }).cooked ?? "")
              : "",
        });
      }
      const embedded = expressions[index];
      if (embedded !== undefined) result.push(fragmentForExpression(embedded));
    }
    return result;
  }
  if (resolved.type === "BinaryExpression" && resolved["operator"] === "+") {
    const leftNode = astNode(resolved["left"]);
    const rightNode = astNode(resolved["right"]);
    if (leftNode === undefined || rightNode === undefined) return undefined;
    const left = endpointFragments(leftNode, bindings);
    const right = endpointFragments(rightNode, bindings);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  const environment = environmentExpression(resolved);
  return environment === undefined ? undefined : [{ kind: "environment", ...environment }];
}

function fragmentForExpression(expression: LegacyAstNode): EndpointFragment {
  const environment = environmentExpression(expression);
  return environment === undefined
    ? { kind: "parameter", value: parameterName(expression) }
    : { kind: "environment", ...environment };
}

function environmentExpression(
  expression: LegacyAstNode,
): { runtime: "process.env" | "import.meta.env"; value: string } | undefined {
  const name = legacyMemberProperty(expression);
  const env = legacyMemberObject(expression);
  if (name === undefined || env === undefined || legacyMemberProperty(env) !== "env")
    return undefined;
  const root = legacyMemberObject(env);
  if (root?.type === "Identifier" && root["name"] === "process") {
    return { runtime: "process.env", value: name };
  }
  if (root?.type === "MetaProperty" && legacyPropertyName(astNode(root["meta"])) === "import") {
    return { runtime: "import.meta.env", value: name };
  }
  return undefined;
}

function parameterName(expression: LegacyAstNode): string {
  const identifier = identifierName(expression);
  if (identifier !== undefined) return safeParameter(identifier);
  const member = legacyMemberProperty(expression);
  return member === undefined ? "dynamic" : safeParameter(member);
}

function safeParameter(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) ? value : "dynamic";
}

function methodFromOptions(
  expression: LegacyAstNode | undefined,
  bindings: FileBindings,
): LegacyApiCandidate["method"] | undefined {
  if (expression === undefined) return undefined;
  const resolved = resolveExpression(expression, bindings);
  if (resolved.type !== "ObjectExpression") return undefined;
  const method = objectProperty(resolved, ["method"]);
  if (method === undefined) return undefined;
  const value = resolveExpression(method, bindings);
  if (value.type !== "StringLiteral" || typeof value["value"] !== "string") return undefined;
  const normalized = value["value"].toUpperCase();
  return HTTP_METHODS.has(normalized) ? (normalized as LegacyApiCandidate["method"]) : undefined;
}

function resolveExpression(expression: LegacyAstNode, bindings: FileBindings): LegacyAstNode {
  let current = unwrapLegacyExpression(expression);
  const visited = new Set<string>();
  while (current.type === "Identifier" && typeof current["name"] === "string") {
    const name = current["name"];
    const next = bindings.variables.get(name);
    if (next === undefined || visited.has(name)) break;
    visited.add(name);
    current = unwrapLegacyExpression(next);
  }
  return current;
}

function objectProperty(object: LegacyAstNode, names: string[]): LegacyAstNode | undefined {
  const properties = object["properties"];
  if (!Array.isArray(properties)) return undefined;
  for (const property of properties) {
    if (!isLegacyAstNode(property) || property.type !== "ObjectProperty") continue;
    const name = legacyPropertyName(astNode(property["key"]));
    const value = astNode(property["value"]);
    if (name !== undefined && names.includes(name) && value !== undefined) return value;
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

function isFetchExpression(expression: LegacyAstNode, parsed: ParsedLegacySource): boolean {
  const text = legacyNodeText(expression, parsed).replace(/\?\./gu, ".");
  return text === "fetch" || text === "globalThis.fetch" || text === "window.fetch";
}

function isDirectAxiosExpression(expression: LegacyAstNode, parsed: ParsedLegacySource): boolean {
  return legacyNodeText(expression, parsed).replace(/\?\./gu, ".") === "axios";
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
  const start = terminal.node.loc?.start ?? { line: 1, column: 0 };
  const locator = `${file.sourcePath}:${start.line}:${start.column + 1}`;
  const endpointKey =
    terminal.pathTemplate === undefined
      ? `endpoint_${createHash("sha256").update("dynamic").update("\0").update(locator).digest("hex").slice(0, 24)}`
      : stableEndpointKey(terminal);
  const callSite: LegacyApiCallSite = {
    callSiteKey: `call_${createHash("sha256").update(locator).digest("hex").slice(0, 24)}`,
    ownerSourcePath: file.sourcePath,
    terminalSourcePath: file.sourcePath,
    line: start.line,
    column: start.column + 1,
    receiver: terminal.receiver,
    ...(terminal.transportRef === undefined ? {} : { transportRef: terminal.transportRef }),
    wrapperChain: [],
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
    ...(terminal.pathTemplate === undefined ? {} : { pathTemplate: terminal.pathTemplate }),
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
    if (options.type === "ObjectExpression") {
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

function objectKeysOrSymbol(expression: LegacyAstNode, bindings: FileBindings): string[] {
  const resolved = resolveExpression(expression, bindings);
  if (resolved.type === "ObjectExpression" && Array.isArray(resolved["properties"])) {
    return resolved["properties"].flatMap((property) => {
      if (!isLegacyAstNode(property)) return [];
      if (property.type === "ObjectProperty" || property.type === "ObjectMethod") {
        const name = legacyPropertyName(astNode(property["key"]));
        return name === undefined ? [] : [name];
      }
      return [];
    });
  }
  const name = identifierName(resolved);
  return name === undefined ? [] : [name];
}

function isCallNode(node: LegacyAstNode): boolean {
  return node.type === "CallExpression" || node.type === "OptionalCallExpression";
}

function callArguments(node: LegacyAstNode): LegacyAstNode[] {
  return expressionArray(node["arguments"]);
}

function expressionArray(value: unknown): LegacyAstNode[] {
  return Array.isArray(value) ? value.filter(isLegacyAstNode) : [];
}

function astNode(value: unknown): LegacyAstNode | undefined {
  return isLegacyAstNode(value) ? value : undefined;
}

function identifierName(value: unknown): string | undefined {
  return isLegacyAstNode(value) && value.type === "Identifier" && typeof value["name"] === "string"
    ? value["name"]
    : undefined;
}
