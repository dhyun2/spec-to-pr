import * as ts from "typescript";

export type SourceImport = {
  kind: "import" | "export" | "dynamic-import";
  specifier: string;
  line: number;
  column: number;
};

export function parseSourceImports(input: { filePath: string; content: string }): SourceImport[] {
  const sourceFile = ts.createSourceFile(
    input.filePath,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    input.filePath.endsWith(".tsx") || input.filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const imports: SourceImport[] = [];

  function addImport(kind: SourceImport["kind"], specifierNode: ts.StringLiteralLike): void {
    const position = sourceFile.getLineAndCharacterOfPosition(specifierNode.getStart(sourceFile));

    imports.push({
      kind,
      specifier: specifierNode.text,
      line: position.line + 1,
      column: position.character + 1,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      addImport("import", node.moduleSpecifier);
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addImport("export", node.moduleSpecifier);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const [argument] = node.arguments;

      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        addImport("dynamic-import", argument);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return imports.sort((left, right) => left.line - right.line || left.column - right.column);
}
