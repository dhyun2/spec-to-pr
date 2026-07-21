const MARKDOWN_CONTROL_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "[",
  "]",
  "(",
  ")",
  "#",
  "!",
  "|",
  ">",
  "<",
  "&",
]);

export function markdownInline(value: string): string {
  return encodeMarkdown(redactSecretShapes(value), false);
}

export function markdownBullet(value: string): string {
  return markdownInline(value);
}

export function markdownTableCell(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => encodeMarkdown(redactSecretShapes(line), true))
    .join("&#92;n");
}

export function redactSecretShapes(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, "[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(
      /\b(token|secret|password|credential|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}

function encodeMarkdown(value: string, tableCell: boolean): string {
  return [...value]
    .map((character) => {
      if (character === "\r") return "&#92;r";
      if (character === "\n") return "&#92;n";
      const code = character.charCodeAt(0);
      if (code < 32 || code === 127) return "�";
      if (tableCell && character === "|") return "\\|";
      if (MARKDOWN_CONTROL_CHARACTERS.has(character)) {
        return `&#${String(code)};`;
      }
      return character;
    })
    .join("");
}
