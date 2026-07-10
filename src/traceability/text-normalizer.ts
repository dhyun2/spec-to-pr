const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g;

export function normalizeTraceText(input: string): string {
  return input
    .normalize("NFC")
    .replace(CAMEL_CASE_BOUNDARY, "$1 $2")
    .replace(/[_/{}()[\].:?-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function tokenizeTraceText(input: string): string[] {
  const normalized = normalizeTraceText(input);

  if (normalized.length === 0) {
    return [];
  }

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "api",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "해야",
  "한다",
  "가능",
  "제공",
  "관리",
  "화면",
  "기능",
]);
