export function markdownTable(headers: string[], rows: string[][]): string {
  const header = `| ${headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);

  return [header, separator, ...body].join("\n");
}

export function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
