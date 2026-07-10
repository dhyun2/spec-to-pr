import { z } from "zod";

export const MarkdownBlockKindSchema = z.enum(["heading", "list-item", "paragraph"]);

export const MarkdownBlockSchema = z
  .object({
    kind: MarkdownBlockKindSchema,
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    text: z.string(),
    headingLevel: z.number().int().positive().max(6).optional(),
    headingPath: z.array(z.string()).default([]),
  })
  .strict();

export type MarkdownBlockKind = z.infer<typeof MarkdownBlockKindSchema>;
export type MarkdownBlock = z.infer<typeof MarkdownBlockSchema>;

export type ParsedMarkdown = {
  blocks: MarkdownBlock[];
  headings: MarkdownBlock[];
  lineCount: number;
};

type ParagraphDraft = {
  lineStart: number;
  lineEnd: number;
  lines: string[];
  headingPath: string[];
};

export function parseMarkdownLines(content: string): ParsedMarkdown {
  const lines = content.split("\n");
  const blocks: MarkdownBlock[] = [];
  const headings: MarkdownBlock[] = [];

  const headingStack: string[] = [];
  let paragraph: ParagraphDraft | undefined;
  let fence: { marker: "`" | "~"; length: number } | undefined;

  function flushParagraph(): void {
    if (paragraph === undefined) {
      return;
    }

    const text = paragraph.lines.join(" ").trim();

    if (text.length > 0) {
      blocks.push(
        MarkdownBlockSchema.parse({
          kind: "paragraph",
          lineStart: paragraph.lineStart,
          lineEnd: paragraph.lineEnd,
          text,
          headingPath: paragraph.headingPath,
        }),
      );
    }

    paragraph = undefined;
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fenceMarker = parseFenceMarker(line);

    if (fence !== undefined) {
      if (
        fenceMarker !== undefined &&
        fenceMarker.marker === fence.marker &&
        fenceMarker.length >= fence.length
      ) {
        fence = undefined;
      }

      return;
    }

    if (fenceMarker !== undefined) {
      flushParagraph();
      fence = fenceMarker;
      return;
    }

    const heading = parseHeading(line);

    if (heading !== undefined) {
      flushParagraph();

      headingStack.splice(heading.level - 1);
      headingStack[heading.level - 1] = heading.text;

      const headingPath = headingStack.filter(Boolean);

      const block = MarkdownBlockSchema.parse({
        kind: "heading",
        lineStart: lineNumber,
        lineEnd: lineNumber,
        text: heading.text,
        headingLevel: heading.level,
        headingPath,
      });

      blocks.push(block);
      headings.push(block);
      return;
    }

    const listItem = parseListItem(line);

    if (listItem !== undefined) {
      flushParagraph();

      blocks.push(
        MarkdownBlockSchema.parse({
          kind: "list-item",
          lineStart: lineNumber,
          lineEnd: lineNumber,
          text: listItem,
          headingPath: headingStack.filter(Boolean),
        }),
      );

      return;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      return;
    }

    if (paragraph === undefined) {
      paragraph = {
        lineStart: lineNumber,
        lineEnd: lineNumber,
        lines: [line.trim()],
        headingPath: headingStack.filter(Boolean),
      };
      return;
    }

    paragraph.lineEnd = lineNumber;
    paragraph.lines.push(line.trim());
  });

  flushParagraph();

  return {
    blocks,
    headings,
    lineCount: lines.length,
  };
}

function parseHeading(line: string): { level: number; text: string } | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

  if (match === null) {
    return undefined;
  }

  return {
    level: match[1]!.length,
    text: stripMarkdownInline(match[2]!),
  };
}

function parseListItem(line: string): string | undefined {
  const match = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+?)\s*$/.exec(line);

  if (match === null) {
    return undefined;
  }

  return stripMarkdownInline(match[1]!);
}

function parseFenceMarker(line: string): { marker: "`" | "~"; length: number } | undefined {
  const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

  if (match === null) {
    return undefined;
  }

  const raw = match[1]!;

  return {
    marker: raw[0] === "`" ? "`" : "~",
    length: raw.length,
  };
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}
