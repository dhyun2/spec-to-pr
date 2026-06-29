import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import {
  ArtifactRefSchema,
  EvidenceRefSchema,
  SourceRefSchema,
  type ArtifactRef,
  type EvidenceRef,
  type SourceRef,
} from "../runtime/index.js";
import { createArtifactId, createEvidenceId, createSourceId } from "../runtime/id-factory.js";
import { RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import { canonicalizeFileContent, SourceSnapshotStore } from "../source-registry/index.js";
import type { RunStore } from "../store/run-store.js";

const DEFAULT_MEDIA_TYPE = "text/plain; charset=utf-8" as const;
const PARSER_VERSION = "intake-request-parser-v1" as const;

export const ParseIntakeRequestInputSchema = z
  .object({
    runId: RunIdSchema,
    requestText: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => value.trim().length > 0, {
        message: "requestText must contain non-whitespace content",
      }),
    label: z.string().trim().min(1).max(200).default("user-request"),
  })
  .strict();

export const BranchPolicySchema = z
  .object({
    sourceBranch: z.string().trim().min(1).optional(),
    targetBranch: z.string().trim().min(1).optional(),
  })
  .strict();

export const PublishPolicySchema = z
  .object({
    shouldPublish: z.boolean().optional(),
    mode: z.enum(["draft", "ready"]).optional(),
    mergeAllowed: z.boolean().optional(),
  })
  .strict();

export const ArchivePolicySchema = z
  .object({
    archiveAllowed: z.boolean().optional(),
  })
  .strict();

export const ParsedIntakeRequestSchema = z
  .object({
    parserVersion: z.literal(PARSER_VERSION),
    figmaUrls: z.array(z.string().url()),
    urls: z.array(z.string().url()),
    filePaths: z.array(z.string().trim().min(1)),
    ticketUrls: z.array(z.string().url()),
    inlineOpenApiBlocks: z.array(z.string().trim().min(1)),
    branchPolicy: BranchPolicySchema,
    validationCommands: z.array(z.string().trim().min(1)),
    constraints: z.array(z.string().trim().min(1)),
    publishPolicy: PublishPolicySchema,
    archivePolicy: ArchivePolicySchema,
    targetHints: z.array(z.string().trim().min(1)),
  })
  .strict();

export const ParseIntakeRequestResultSchema = z
  .object({
    run: RunSummarySchema,
    source: SourceRefSchema,
    evidence: EvidenceRefSchema,
    artifact: ArtifactRefSchema,
    parsed: ParsedIntakeRequestSchema,
    duplicateSource: z.boolean(),
  })
  .strict();

export type ParseIntakeRequestInput = z.infer<typeof ParseIntakeRequestInputSchema>;
export type ParsedIntakeRequest = z.infer<typeof ParsedIntakeRequestSchema>;
export type ParseIntakeRequestResult = z.infer<typeof ParseIntakeRequestResultSchema>;

export class IntakeRequestService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly snapshotStore: SourceSnapshotStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async parseIntakeRequest(rawInput: unknown): Promise<ParseIntakeRequestResult> {
    const input = ParseIntakeRequestInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const capturedAt = IsoDateTimeSchema.parse(this.now());
    const canonical = canonicalizeFileContent({
      path: `${input.label}.txt`,
      mediaType: DEFAULT_MEDIA_TYPE,
      rawContent: Buffer.from(input.requestText, "utf8"),
    });

    const existingSource = run.sources.find(
      (source) =>
        source.kind === "instruction" &&
        source.locator.type === "inline" &&
        source.locator.label === input.label &&
        source.digest === canonical.canonicalDigest,
    );

    const source =
      existingSource ??
      SourceRefSchema.parse({
        id: createSourceId(),
        kind: "instruction",
        locator: {
          type: "inline",
          label: input.label,
          mediaType: DEFAULT_MEDIA_TYPE,
        },
        digest: canonical.canonicalDigest,
        capturedAt,
        metadata: {
          parserVersion: PARSER_VERSION,
          rawDigest: canonical.rawDigest,
          mode: canonical.mode,
          rawByteLength: canonical.rawByteLength,
          canonicalByteLength: canonical.canonicalByteLength,
          ...(canonical.lineCount === undefined ? {} : { lineCount: canonical.lineCount }),
        },
      });

    await this.snapshotStore.writeSnapshot({
      source,
      canonical,
      storedAt: capturedAt,
    });

    const parsed = parseRequestText(input.requestText);
    const evidence = createInstructionEvidence({
      source,
      label: input.label,
      requestText: input.requestText,
      digest: canonical.canonicalDigest,
      capturedAt,
    });
    const artifact = await this.createParsedArtifact({
      runId: input.runId,
      evidence,
      parsed,
      capturedAt,
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: capturedAt,
      sources: existingSource === undefined ? [...run.sources, source] : run.sources,
      evidence: [...run.evidence, evidence],
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return ParseIntakeRequestResultSchema.parse({
      run: summarizeRun(nextRun),
      source,
      evidence,
      artifact,
      parsed,
      duplicateSource: existingSource !== undefined,
    });
  }

  private async createParsedArtifact(input: {
    runId: string;
    evidence: EvidenceRef;
    parsed: ParsedIntakeRequest;
    capturedAt: string;
  }): Promise<ArtifactRef> {
    const content = Buffer.from(
      `${JSON.stringify(
        {
          runId: input.runId,
          generatedAt: input.capturedAt,
          parsed: input.parsed,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const blob = await this.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: input.capturedAt,
      label: "parsed-intake-request",
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "parsed-intake-request",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [input.evidence.id],
      createdAt: input.capturedAt,
      metadata: {
        parserVersion: PARSER_VERSION,
      },
    });
  }
}

function createInstructionEvidence(input: {
  source: SourceRef;
  label: string;
  requestText: string;
  digest: string;
  capturedAt: string;
}): EvidenceRef {
  const lines = normalizeLineEndings(input.requestText).split("\n");

  return EvidenceRefSchema.parse({
    id: createEvidenceId(),
    sourceId: input.source.id,
    location: {
      type: "inline-text",
      label: input.label,
      startLine: 1,
      endLine: Math.max(1, lines.length),
    },
    summary: "Original user request captured for deterministic intake.",
    excerpt: input.requestText.slice(0, 4_000),
    digest: input.digest,
    capturedAt: input.capturedAt,
    metadata: {
      parserVersion: PARSER_VERSION,
      itemType: "instruction",
    },
  });
}

function parseRequestText(requestText: string): ParsedIntakeRequest {
  const text = normalizeLineEndings(requestText);
  const urls = extractUrls(text);
  const figmaUrls = urls.filter(isFigmaUrl);
  const ticketUrls = urls.filter(isTicketUrl);
  const filePaths = extractFilePaths(text);
  const inlineOpenApiBlocks = extractInlineOpenApiBlocks(text);
  const validationCommands = extractValidationCommands(text);
  const constraints = extractConstraints(text);

  return ParsedIntakeRequestSchema.parse({
    parserVersion: PARSER_VERSION,
    figmaUrls,
    urls,
    filePaths,
    ticketUrls,
    inlineOpenApiBlocks,
    branchPolicy: extractBranchPolicy(text),
    validationCommands,
    constraints,
    publishPolicy: extractPublishPolicy(text),
    archivePolicy: extractArchivePolicy(text),
    targetHints: extractTargetHints(text, filePaths, figmaUrls),
  });
}

function normalizeLineEndings(value: string): string {
  return value.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  const matches = text.matchAll(/https?:\/\/[^\s<>"'`)\]}]+/gi);

  for (const match of matches) {
    const normalized = trimTrailingPunctuation(match[0]);

    try {
      urls.add(new URL(normalized).toString());
    } catch {
      // Ignore malformed URL-like text.
    }
  }

  return [...urls];
}

function isFigmaUrl(url: string): boolean {
  return safeHostname(url).endsWith("figma.com");
}

function isTicketUrl(url: string): boolean {
  const hostname = safeHostname(url);

  return (
    hostname.includes("jira") ||
    hostname.includes("linear.app") ||
    hostname.includes("notion.") ||
    hostname.includes("github.") ||
    hostname.includes("gitlab.")
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();
  const matches = text.matchAll(
    /(?<![A-Za-z0-9_@./-])((?:\.{1,2}\/)?[A-Za-z0-9_@./-]+\.(?:md|mdx|txt|yaml|yml|json|jsonc|feature|pdf|html|htm))(?![A-Za-z0-9_@./-])/g,
  );

  for (const match of matches) {
    const rawPath = match[1];

    if (rawPath === undefined) {
      continue;
    }

    const normalized = rawPath.replace(/^\.\//, "");

    if (!normalized.includes("://")) {
      paths.add(trimTrailingPunctuation(normalized));
    }
  }

  return [...paths];
}

function extractInlineOpenApiBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fencedBlocks = text.matchAll(/```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g);

  for (const match of fencedBlocks) {
    const language = match[1]?.toLowerCase() ?? "";
    const content = match[2]?.trim() ?? "";

    if (
      content.length > 0 &&
      (language.includes("openapi") ||
        language.includes("yaml") ||
        language.includes("yml") ||
        language.includes("json") ||
        /(^|\n)\s*openapi\s*:/i.test(content) ||
        /(^|\n)\s*paths\s*:/i.test(content))
    ) {
      blocks.push(content);
    }
  }

  if (
    blocks.length === 0 &&
    /(^|\n)\s*openapi\s*:/i.test(text) &&
    /(^|\n)\s*paths\s*:/i.test(text)
  ) {
    blocks.push(text.slice(0, 20_000).trim());
  }

  return unique(blocks);
}

function extractBranchPolicy(text: string): z.infer<typeof BranchPolicySchema> {
  return BranchPolicySchema.parse({
    sourceBranch: matchBranch(text, [
      /source(?:\s|-)?branch\s*[:=]?\s*([A-Za-z0-9._/-]+)/i,
      /소스\s*브랜치\s*[:=]?\s*([A-Za-z0-9._/-]+)/i,
      /현재\s*브랜치\s*[:=]?\s*([A-Za-z0-9._/-]+)/i,
    ]),
    targetBranch: matchBranch(text, [
      /target(?:\s|-)?branch\s*[:=]?\s*([A-Za-z0-9._/-]+)/i,
      /타겟\s*브랜치\s*[:=]?\s*([A-Za-z0-9._/-]+)/i,
      /대상\s*브랜치\s*[:=]?\s*([A-Za-z0-9._/-]+)/i,
      /(?:PR|MR|pr|mr)[^\n]*(?:into|to|->|대상|타겟)\s*([A-Za-z0-9._/-]+)/,
    ]),
  });
}

function matchBranch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const branch = match?.[1];

    if (branch !== undefined) {
      return sanitizeToken(branch);
    }
  }

  return undefined;
}

function extractValidationCommands(text: string): string[] {
  const commands = new Set<string>();
  const commandPattern =
    /(?<![A-Za-z0-9_-])((?:pnpm|npm|yarn|bun|npx|node|deno|pytest|go test|cargo test|mvn|gradle|make)\b(?!-)[^\n\r가-힣]*)/gi;

  for (const match of text.matchAll(commandPattern)) {
    const command = sanitizeCommand(match[1] ?? "");

    if (command.length > 0) {
      commands.add(command);
    }
  }

  return [...commands];
}

function extractConstraints(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) {
        return false;
      }

      return /(must|should|do not|don't|never|반드시|해야|하지\s*마|하지마|금지|머지|merge|archive|publish|PR|MR)/i.test(
        line,
      );
    })
    .slice(0, 50);
}

function extractPublishPolicy(text: string): z.infer<typeof PublishPolicySchema> {
  const lower = text.toLowerCase();
  const shouldPublish = /(publish|pr|mr|pull request|merge request|올려|요청|생성)/i.test(text)
    ? true
    : undefined;
  const mergeAllowed =
    /(do not merge|don't merge|never merge|merge\s*하지|merge\s*금지|머지\s*하지|머지\s*금지|머지하지|머지금지)/i.test(
      text,
    )
      ? false
      : undefined;
  const mode =
    lower.includes("ready for review") || lower.includes("mark ready") ? "ready" : undefined;

  return PublishPolicySchema.parse({
    ...(shouldPublish === undefined ? {} : { shouldPublish }),
    ...(mode === undefined ? {} : { mode }),
    ...(mergeAllowed === undefined ? {} : { mergeAllowed }),
  });
}

function extractArchivePolicy(text: string): z.infer<typeof ArchivePolicySchema> {
  const archiveMentioned = /archive|openspec\s*archive|아카이브/i.test(text);
  const archiveDenied =
    archiveMentioned &&
    /(archive[^\n]*(do not|don't|never|하지\s*마|하지마|금지)|openspec\s*archive[^\n]*(하지\s*마|하지마|금지)|merge\s*전[^\n]*(archive|아카이브|하지)|머지\s*전[^\n]*(archive|아카이브|하지))/i.test(
      text,
    );

  return ArchivePolicySchema.parse({
    ...(archiveMentioned ? { archiveAllowed: !archiveDenied } : {}),
  });
}

function extractTargetHints(text: string, filePaths: string[], figmaUrls: string[]): string[] {
  const hints = new Set<string>();

  for (const filePath of filePaths) {
    const directory = filePath.split("/").slice(0, -1).join("/");

    if (directory.length > 0) {
      hints.add(directory);
    }
  }

  if (figmaUrls.length > 0) {
    hints.add("figma");
  }

  const pageMatches = text.matchAll(/(?:page|screen|화면|페이지)\s*[:=]?\s*([A-Za-z0-9_./-]+)/gi);

  for (const match of pageMatches) {
    const hint = match[1];

    if (hint !== undefined) {
      hints.add(sanitizeToken(hint));
    }
  }

  return [...hints].filter((hint) => hint.length > 0).slice(0, 20);
}

function sanitizeToken(token: string): string {
  return trimTrailingPunctuation(token.trim());
}

function sanitizeCommand(command: string): string {
  return trimTrailingPunctuation(command.trim().replace(/\s+/g, " "));
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?，。]+$/u, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
