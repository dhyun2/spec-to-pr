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
  legacyAstNode as astNode,
  legacyExportedSelection,
  legacyIdentifierName as identifierName,
  legacyLocalSelection,
  legacyMemberObject,
  legacyMemberProperty,
  legacyNodeText,
  legacyProgramBody as programBody,
  legacyPropertyName,
  legacyStringLiteralValue as stringLiteralValue,
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

type ReceiverBinding = {
  transportRef: string;
  baseUrlNode?: LegacyAstNode;
};

type ImportBinding = {
  source: string;
  imported: string;
  local: string;
};

type FileBindings = {
  parsed: ParsedLegacySource;
  variables: Map<string, LegacyAstNode>;
  receivers: Map<string, ReceiverBinding>;
  imports: Map<string, ImportBinding>;
  localNames: Set<string>;
  parents: WeakMap<LegacyAstNode, LegacyAstNode>;
};

type ImportedInvocation = {
  binding: ImportBinding;
  selector: string;
};

type FacadeTraceContext = {
  graph: LegacySourceGraph;
  candidates: Map<string, LegacyApiCandidate>;
  bindingsByPath: Map<string, FileBindings>;
  ownerFile: LegacyGraphFile;
  importerFile: LegacyGraphFile;
  invocation: ImportedInvocation;
  visited: Set<string>;
  wrapperPrefix?: string[];
};

export function discoverLegacyApiCandidates(graph: LegacySourceGraph): LegacyApiCandidate[] {
  const candidates = new Map<string, LegacyApiCandidate>();
  const bindingsByPath = new Map<string, FileBindings>();
  for (const file of graph.files) {
    if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/iu.test(file.absolutePath)) continue;
    bindingsByPath.set(file.absolutePath, bindingsFor(file));
  }
  for (const file of productionReachableOwnedFiles(graph)) {
    const bindings = bindingsByPath.get(file.absolutePath);
    if (bindings === undefined) continue;
    walkLegacyAst(bindings.parsed.root, (node) => {
      if (!isCallNode(node)) return;
      const terminal = terminalCall(node, bindings, graph);
      if (terminal !== undefined) mergeCandidate(candidates, file, file, bindings, terminal);
      const invocation = importedInvocation(node, bindings);
      if (invocation !== undefined) {
        traceImportedInvocation({
          graph,
          candidates,
          bindingsByPath,
          ownerFile: file,
          importerFile: file,
          invocation,
          visited: new Set<string>(),
        });
      }
    });
  }
  return [...candidates.values()].sort((left, right) =>
    `${left.operationKey}:${left.endpointKey}`.localeCompare(
      `${right.operationKey}:${right.endpointKey}`,
    ),
  );
}

export function productionReachableOwnedFiles(graph: LegacySourceGraph): LegacyGraphFile[] {
  const filesByApplicationPath = new Map(
    graph.files.map((file) => [file.applicationRelativePath, file] as const),
  );
  const targetsByImporter = new Map<string, LegacyGraphFile[]>();
  for (const edge of graph.edges) {
    const target = filesByApplicationPath.get(edge.resolvedPath);
    if (target === undefined) continue;
    const targets = targetsByImporter.get(edge.importer) ?? [];
    targets.push(target);
    targetsByImporter.set(edge.importer, targets);
  }

  const reachable = new Set(
    graph.ownedFiles
      .filter((file) => !isAuxiliaryLegacySourcePath(file.applicationRelativePath))
      .map((file) => file.sourcePath),
  );
  const pending = [...reachable];
  for (let index = 0; index < pending.length; index += 1) {
    for (const target of targetsByImporter.get(pending[index]!) ?? []) {
      if (reachable.has(target.sourcePath)) continue;
      reachable.add(target.sourcePath);
      pending.push(target.sourcePath);
    }
  }
  return graph.ownedFiles.filter((file) => reachable.has(file.sourcePath));
}

export function isAuxiliaryLegacySourcePath(applicationRelativePath: string): boolean {
  const normalized = applicationRelativePath.replace(/\\/gu, "/").toLowerCase();
  const segments = normalized.split("/");
  if (
    segments.some((segment) =>
      /^(?:__(?:fixtures?|mocks?|specs?|stor(?:y|ies)|tests?)__|fixtures?|mocks?|specs?|stor(?:y|ies)|storybook|tests?)$/u.test(
        segment,
      ),
    )
  ) {
    return true;
  }
  const fileName = segments.at(-1) ?? "";
  return /\.(?:fixture|mock|spec|stor(?:y|ies)|storybook|test)\.[^/]+$/u.test(fileName);
}

function bindingsFor(file: LegacyGraphFile): FileBindings {
  const parsed = parseLegacySource(file.content, file.absolutePath);
  const variables = new Map<string, LegacyAstNode>();
  const receivers = new Map<string, ReceiverBinding>();
  const imports = new Map<string, ImportBinding>();
  const localNames = new Set<string>();
  const parents = new WeakMap<LegacyAstNode, LegacyAstNode>();
  walkLegacyAst(parsed.root, (node, parent) => {
    if (parent !== undefined) parents.set(node, parent);
    if (node.type === "VariableDeclarator") {
      addBindingNames(node["id"], localNames);
      const name = identifierName(node["id"]);
      const initializer = astNode(node["init"]);
      if (name !== undefined && initializer !== undefined) variables.set(name, initializer);
    }
    if (
      ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)
    ) {
      if (node.type !== "ArrowFunctionExpression") addBindingNames(node["id"], localNames);
      if (Array.isArray(node["params"])) {
        node["params"].forEach((parameter) => addBindingNames(parameter, localNames));
      }
    }
    if (["ClassDeclaration", "ClassExpression"].includes(node.type)) {
      addBindingNames(node["id"], localNames);
    }
    if (node.type === "CatchClause") addBindingNames(node["param"], localNames);
    if (node.type !== "ImportDeclaration") return;
    const sourceNode = astNode(node["source"]);
    const source =
      sourceNode?.type === "StringLiteral" && typeof sourceNode["value"] === "string"
        ? sourceNode["value"]
        : undefined;
    const specifiers = node["specifiers"];
    if (source === undefined || !Array.isArray(specifiers)) return;
    for (const specifier of specifiers) {
      if (!isLegacyAstNode(specifier)) continue;
      const local = identifierName(specifier["local"]);
      if (local === undefined) continue;
      localNames.add(local);
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier.type === "ImportNamespaceSpecifier"
            ? "*"
            : legacyPropertyName(astNode(specifier["imported"]));
      if (imported === undefined) continue;
      imports.set(local, { source, imported, local });
      const transportRef = importedTransportRef(source, imported, local);
      if (transportRef !== undefined) receivers.set(local, { transportRef });
    }
  });
  walkLegacyAst(parsed.root, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const name = identifierName(node["id"]);
    const initializer = astNode(node["init"]);
    if (name === undefined || initializer === undefined) return;
    if (initializer.type === "NewExpression") {
      const constructorNode = astNode(initializer["callee"]);
      const constructorName =
        constructorNode === undefined ? "" : legacyNodeText(constructorNode, parsed);
      const constructorRoot = constructorName.split(/[.[\]]/u)[0] ?? "";
      const importedConstructor = receivers.get(constructorRoot);
      if (importedConstructor !== undefined) {
        receivers.set(name, {
          transportRef: importedConstructor.transportRef,
          ...baseUrlBinding(expressionArray(initializer["arguments"]), variables),
        });
      }
      return;
    }
    if (
      isCallNode(initializer) &&
      legacyMemberProperty(astNode(initializer["callee"])!) === "create"
    ) {
      const callee = astNode(initializer["callee"]);
      const receiverNode = callee === undefined ? undefined : legacyMemberObject(callee);
      const receiverName =
        receiverNode === undefined ? undefined : legacyNodeText(receiverNode, parsed);
      const factory =
        receiverName === undefined
          ? undefined
          : (receivers.get(receiverName) ?? externalTransportBinding(receiverName, { localNames }));
      if (factory?.transportRef === "axios") {
        receivers.set(name, {
          transportRef: factory.transportRef,
          ...baseUrlBinding(expressionArray(initializer["arguments"]), variables),
        });
      }
      return;
    }
    const alias = resolveReceiverAlias(initializer, parsed, receivers);
    if (alias !== undefined) receivers.set(name, alias);
  });
  return { parsed, variables, receivers, imports, localNames, parents };
}

function importedInvocation(
  node: LegacyAstNode,
  bindings: FileBindings,
): ImportedInvocation | undefined {
  if (!isCallNode(node)) return undefined;
  const callee = astNode(node["callee"]);
  if (callee === undefined) return undefined;
  const resolved = unwrapLegacyExpression(callee);
  const directName = identifierName(resolved);
  if (directName !== undefined) {
    const binding = bindings.imports.get(directName);
    if (binding === undefined || bindings.receivers.has(directName)) return undefined;
    return { binding, selector: binding.imported };
  }
  const object = legacyMemberObject(resolved);
  const property = legacyMemberProperty(resolved);
  const objectName =
    object === undefined ? undefined : identifierName(unwrapLegacyExpression(object));
  if (objectName === undefined || property === undefined) return undefined;
  const binding = bindings.imports.get(objectName);
  if (binding === undefined || bindings.receivers.has(objectName)) return undefined;
  return {
    binding,
    selector: binding.imported === "*" ? property : `${binding.imported}.${property}`,
  };
}

function traceImportedInvocation(context: FacadeTraceContext): void {
  const target = importedTarget(
    context.graph,
    context.importerFile,
    context.invocation.binding.source,
  );
  if (target === undefined || target.ownership !== "supporting-dependency") return;
  traceExportSelector({
    ...context,
    importerFile: target,
    selector: context.invocation.selector,
  });
}

function traceExportSelector(
  context: Omit<FacadeTraceContext, "invocation"> & { selector: string },
): void {
  const key = `${context.ownerFile.sourcePath}\0${context.importerFile.sourcePath}\0${context.selector}`;
  if (context.visited.has(key)) return;
  context.visited.add(key);
  const bindings = context.bindingsByPath.get(context.importerFile.absolutePath);
  if (bindings === undefined) return;

  const forwarded = forwardedExports(bindings, context.selector);
  for (const item of forwarded) {
    const target = importedTarget(context.graph, context.importerFile, item.source);
    if (target !== undefined) {
      traceExportSelector({
        ...context,
        importerFile: target,
        selector: item.selector,
      });
      return;
    }
  }

  const selected = legacyExportedSelection(bindings.parsed.root, context.selector);
  if (selected === undefined) return;
  traceSelectedNode({ ...context, bindings, selected });
}

function traceSelectedNode(
  context: Omit<FacadeTraceContext, "invocation"> & {
    bindings: FileBindings;
    selected: LegacyAstNode;
  },
): void {
  walkLegacyAst(context.selected, (node) => {
    if (!isCallNode(node)) return;
    const terminal = terminalCall(node, context.bindings, context.graph);
    if (terminal !== undefined) {
      mergeCandidate(
        context.candidates,
        context.ownerFile,
        context.importerFile,
        context.bindings,
        terminal,
        context.wrapperPrefix,
      );
      return;
    }
    const invocation = importedInvocation(node, context.bindings);
    if (invocation !== undefined) {
      traceImportedInvocation({
        ...context,
        invocation,
        wrapperPrefix: [
          ...(context.wrapperPrefix ?? []),
          ...enclosingWrappers(node, context.bindings, context.importerFile.sourcePath),
        ],
      });
      return;
    }
    const callee = astNode(node["callee"]);
    const localName =
      callee === undefined ? undefined : identifierName(unwrapLegacyExpression(callee));
    if (localName === undefined) return;
    const local = legacyLocalSelection(context.bindings.parsed.root, localName);
    if (local === undefined) return;
    const localKey = `${context.ownerFile.sourcePath}\0${context.importerFile.sourcePath}\0local:${localName}`;
    if (context.visited.has(localKey)) return;
    context.visited.add(localKey);
    traceSelectedNode({
      ...context,
      selected: local,
      wrapperPrefix: [
        ...(context.wrapperPrefix ?? []),
        ...enclosingWrappers(node, context.bindings, context.importerFile.sourcePath),
      ],
    });
  });
}

function importedTarget(
  graph: LegacySourceGraph,
  importer: LegacyGraphFile,
  source: string,
): LegacyGraphFile | undefined {
  const edge = graph.edges.find(
    (item) => item.importer === importer.sourcePath && item.specifier === source,
  );
  if (edge === undefined) return undefined;
  return graph.files.find((file) => file.applicationRelativePath === edge.resolvedPath);
}

function forwardedExports(
  bindings: FileBindings,
  selector: string,
): Array<{ source: string; selector: string }> {
  const [base, ...rest] = selector.split(".");
  const exportAll: Array<{ source: string; selector: string }> = [];
  for (const statement of programBody(bindings.parsed.root)) {
    if (statement.type === "ExportAllDeclaration") {
      const source = stringLiteralValue(astNode(statement["source"]));
      if (source !== undefined) exportAll.push({ source, selector });
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const source = stringLiteralValue(astNode(statement["source"]));
    if (source === undefined || !Array.isArray(statement["specifiers"])) continue;
    for (const specifier of statement["specifiers"]) {
      if (!isLegacyAstNode(specifier)) continue;
      const exported = legacyPropertyName(astNode(specifier["exported"]));
      if (exported !== base) continue;
      const local = legacyPropertyName(astNode(specifier["local"]));
      if (local !== undefined) {
        return [{ source, selector: [local, ...rest].join(".") }];
      }
    }
  }
  return exportAll;
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

  const directAxios = directAxiosBinding(callee, bindings);
  if (directAxios !== undefined) {
    const first = args[0];
    if (first === undefined) return undefined;
    const resolvedFirst = resolveExpression(first, bindings);
    if (resolvedFirst.type === "ObjectExpression") {
      const urlNode = objectProperty(resolvedFirst, ["url", "path"]);
      if (urlNode === undefined) return undefined;
      return {
        ...endpointFromExpression(urlNode, bindings, graph),
        method: methodFromOptions(resolvedFirst, bindings) ?? "UNKNOWN",
        receiver: legacyNodeText(callee, bindings.parsed),
        transportRef: directAxios.transportRef,
        terminalKind: "request-config",
        node,
        optionsNode: resolvedFirst,
      };
    }
    return {
      ...endpointWithReceiverBase(first, directAxios, bindings, graph),
      method: methodFromOptions(args[1], bindings) ?? "GET",
      receiver: legacyNodeText(callee, bindings.parsed),
      transportRef: directAxios.transportRef,
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
  const transport = transportForReceiver(receiver, bindings);
  if (transport === undefined) return undefined;
  const first = args[0];
  if (first === undefined) return undefined;
  if (methodName === "REQUEST") {
    const resolvedFirst = resolveExpression(first, bindings);
    if (resolvedFirst.type === "ObjectExpression") {
      const urlNode = objectProperty(resolvedFirst, ["url", "path"]);
      if (urlNode === undefined) return undefined;
      return {
        ...endpointWithReceiverBase(urlNode, transport, bindings, graph),
        method: methodFromOptions(resolvedFirst, bindings) ?? "UNKNOWN",
        receiver,
        transportRef: transport.transportRef,
        terminalKind: "request-config",
        node,
        optionsNode: resolvedFirst,
      };
    }
    return {
      ...endpointWithReceiverBase(first, transport, bindings, graph),
      method: methodFromOptions(args[1], bindings) ?? "UNKNOWN",
      receiver,
      transportRef: transport.transportRef,
      terminalKind: "request-config",
      node,
      ...(args[1] === undefined ? {} : { optionsNode: args[1] }),
    };
  }
  return {
    ...endpointWithReceiverBase(first, transport, bindings, graph),
    method: methodName as TerminalCall["method"],
    receiver,
    transportRef: transport.transportRef,
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

function endpointWithReceiverBase(
  expression: LegacyAstNode,
  receiver: ReceiverBinding,
  bindings: FileBindings,
  graph: LegacySourceGraph,
): EndpointExpression {
  const endpoint = endpointFromExpression(expression, bindings, graph);
  if (endpoint.originRef !== undefined || receiver.baseUrlNode === undefined) return endpoint;
  const base = endpointFromExpression(receiver.baseUrlNode, bindings, graph);
  const pathTemplate = joinedPathTemplate(base.pathTemplate, endpoint.pathTemplate);
  return {
    ...endpoint,
    ...(pathTemplate === undefined ? {} : { pathTemplate }),
    ...(base.originRef === undefined ? {} : { originRef: base.originRef }),
    confidence:
      endpoint.confidence === "low" || base.confidence === "low"
        ? "low"
        : endpoint.confidence === "medium" || base.confidence === "medium"
          ? "medium"
          : "high",
  };
}

function joinedPathTemplate(
  basePath: string | undefined,
  endpointPath: string | undefined,
): string | undefined {
  if (basePath === undefined || endpointPath === undefined) return endpointPath;
  return normalizedPathTemplate(
    `${basePath.replace(/\/+$/u, "")}/${endpointPath.replace(/^\/+/, "")}`,
  );
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
      if (embedded !== undefined) result.push(...fragmentsForExpression(embedded, bindings));
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

function fragmentsForExpression(
  expression: LegacyAstNode,
  bindings: FileBindings,
): EndpointFragment[] {
  const resolved = resolveExpression(expression, bindings);
  const environment = environmentExpression(resolved);
  if (environment !== undefined) return [{ kind: "environment", ...environment }];
  const nested = endpointFragments(resolved, bindings);
  return nested ?? [{ kind: "parameter", value: parameterName(resolved) }];
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

function transportForReceiver(
  receiver: string,
  bindings: FileBindings,
): ReceiverBinding | undefined {
  const root = receiver.split(/[.[\]]/u)[0]!;
  if (bindings.receivers.has(receiver)) return bindings.receivers.get(receiver);
  if (bindings.receivers.has(root)) return bindings.receivers.get(root);
  return externalTransportBinding(root, bindings);
}

function externalTransportBinding(
  name: string,
  bindings: Pick<FileBindings, "localNames">,
): ReceiverBinding | undefined {
  if (bindings.localNames.has(name)) return undefined;
  return /^(?:axios|api|http|client|request)$/iu.test(name) ||
    /(?:api|http|axios|request|rest)(?:client|service|instance)?$/iu.test(name) ||
    /(?:client|service)(?:instance)?$/iu.test(name)
    ? { transportRef: name }
    : undefined;
}

function addBindingNames(value: unknown, names: Set<string>): void {
  const node = astNode(value);
  if (node === undefined) return;
  const identifier = identifierName(node);
  if (identifier !== undefined) {
    names.add(identifier);
    return;
  }
  if (["RestElement", "TSParameterProperty"].includes(node.type)) {
    addBindingNames(node["argument"] ?? node["parameter"], names);
    return;
  }
  if (node.type === "AssignmentPattern") {
    addBindingNames(node["left"], names);
    return;
  }
  if (node.type === "ArrayPattern" && Array.isArray(node["elements"])) {
    node["elements"].forEach((element) => addBindingNames(element, names));
    return;
  }
  if (node.type !== "ObjectPattern" || !Array.isArray(node["properties"])) return;
  node["properties"].forEach((property) => {
    if (!isLegacyAstNode(property)) return;
    addBindingNames(
      property.type === "RestElement" ? property["argument"] : property["value"],
      names,
    );
  });
}

function importedTransportRef(source: string, imported: string, local: string): string | undefined {
  if (/^(?:axios|axios\/)/iu.test(source)) return "axios";
  const evidence = `${source}/${imported === "default" ? "" : imported}/${local}`;
  if (
    !/(?:^|[/@._-])(?:axios|http|request|rest)(?:[/@._-]|$)/iu.test(evidence) &&
    !/(?:axios|http|request|rest)(?:client|service|instance)$/iu.test(evidence)
  ) {
    return undefined;
  }
  return imported === "default" || imported === "*" ? local : imported;
}

function baseUrlBinding(
  args: LegacyAstNode[],
  variables: Map<string, LegacyAstNode>,
): Pick<ReceiverBinding, "baseUrlNode"> {
  const first = args[0];
  if (first === undefined) return {};
  const resolved = resolveVariable(first, variables);
  if (resolved.type === "ObjectExpression") {
    const baseUrlNode = objectProperty(resolved, ["baseURL", "baseUrl", "origin"]);
    return baseUrlNode === undefined ? {} : { baseUrlNode };
  }
  return ["StringLiteral", "TemplateLiteral", "BinaryExpression", "MemberExpression"].includes(
    resolved.type,
  )
    ? { baseUrlNode: first }
    : {};
}

function resolveVariable(
  expression: LegacyAstNode,
  variables: Map<string, LegacyAstNode>,
): LegacyAstNode {
  let current = unwrapLegacyExpression(expression);
  const visited = new Set<string>();
  while (current.type === "Identifier" && typeof current["name"] === "string") {
    const name = current["name"];
    const next = variables.get(name);
    if (next === undefined || visited.has(name)) break;
    visited.add(name);
    current = unwrapLegacyExpression(next);
  }
  return current;
}

function resolveReceiverAlias(
  expression: LegacyAstNode,
  parsed: ParsedLegacySource,
  receivers: Map<string, ReceiverBinding>,
): ReceiverBinding | undefined {
  const resolved = unwrapLegacyExpression(expression);
  if (resolved.type !== "Identifier") return undefined;
  const name = legacyNodeText(resolved, parsed);
  return receivers.get(name);
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

function directAxiosBinding(
  expression: LegacyAstNode,
  bindings: FileBindings,
): ReceiverBinding | undefined {
  const text = legacyNodeText(expression, bindings.parsed).replace(/\?\./gu, ".");
  const binding = bindings.receivers.get(text) ?? externalTransportBinding(text, bindings);
  return binding?.transportRef === "axios" ? binding : undefined;
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
  ownerFile: LegacyGraphFile,
  terminalFile: LegacyGraphFile,
  bindings: FileBindings,
  terminal: TerminalCall,
  wrapperPrefix: string[] = [],
): void {
  const start = terminal.node.loc?.start ?? { line: 1, column: 0 };
  const locator = `${terminalFile.sourcePath}:${start.line}:${start.column + 1}`;
  const endpointKey =
    terminal.pathTemplate === undefined
      ? `endpoint_${createHash("sha256").update("dynamic").update("\0").update(locator).digest("hex").slice(0, 24)}`
      : stableEndpointKey(terminal);
  const callSite: LegacyApiCallSite = {
    callSiteKey: `call_${createHash("sha256").update(ownerFile.sourcePath).update("\0").update(locator).digest("hex").slice(0, 24)}`,
    ownerSourcePath: ownerFile.sourcePath,
    terminalSourcePath: terminalFile.sourcePath,
    line: start.line,
    column: start.column + 1,
    receiver: terminal.receiver,
    ...(terminal.transportRef === undefined ? {} : { transportRef: terminal.transportRef }),
    wrapperChain: [
      ...wrapperPrefix,
      ...enclosingWrappers(terminal.node, bindings, terminalFile.sourcePath),
    ].slice(-32),
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

function enclosingWrappers(
  node: LegacyAstNode,
  bindings: FileBindings,
  sourcePath: string,
): string[] {
  const wrappers: string[] = [];
  let current: LegacyAstNode | undefined = node;
  while ((current = bindings.parents.get(current)) !== undefined) {
    let name: string | undefined;
    if (current.type === "FunctionDeclaration") {
      name = identifierName(current["id"]);
    } else if (["ObjectMethod", "ClassMethod", "ClassPrivateMethod"].includes(current.type)) {
      name = legacyPropertyName(astNode(current["key"]));
    } else if (["ArrowFunctionExpression", "FunctionExpression"].includes(current.type)) {
      const parent = bindings.parents.get(current);
      if (parent?.type === "VariableDeclarator") name = identifierName(parent["id"]);
      else if (parent?.type === "ObjectProperty") name = legacyPropertyName(astNode(parent["key"]));
    }
    if (name !== undefined) wrappers.unshift(`${sourcePath}#${name}`);
  }
  return wrappers.slice(-32);
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
