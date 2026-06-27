import { z } from "zod";

import { BriefAnalysisResultSchema, type BriefExtractedItem } from "../brief/brief-analysis.js";
import { detectBriefSourceType } from "../brief/brief-source-type.js";
import {
  BriefIssueFlagSchema,
  BriefItemTypeSchema,
  classifyBriefBlocks,
  type BriefIssueFlag,
  type BriefItemType,
} from "../brief/brief-classifier.js";
import { parseMarkdownBrief } from "../brief/markdown-brief-parser.js";
import type { NormalizedBriefBlock, NormalizedBriefDocument } from "../brief/normalized-brief.js";
import { parsePlainTextBrief } from "../brief/plaintext-brief-parser.js";
import { createUnsupportedBriefDocument } from "../brief/unsupported-brief-parser.js";
import { RunManifestSchema } from "../run/index.js";
import { createEvidenceId, createGapId } from "../runtime/id-factory.js";
import { RunIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema, type Sha256Digest } from "../runtime/scalars.js";
import { GapSchema, type Gap } from "../runtime/gap.js";
import { EvidenceRefSchema, type EvidenceRef, type SourceRef } from "../runtime/source.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { SourceSnapshotStore } from "../source-registry/snapshot-store.js";
import type { RunStore } from "../store/run-store.js";

export const AnalyzeBriefSourceInputSchema = z
  .object({
    runId: RunIdSchema,
    sourceId: SourceIdSchema,
  })
  .strict();

export type AnalyzeBriefSourceInput = z.infer<typeof AnalyzeBriefSourceInputSchema>;

const BRIEF_ADAPTER_VERSION = "brief-adapter-v1" as const;

export class BriefAdapterService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly snapshotStore: SourceSnapshotStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async analyzeBriefSource(rawInput: unknown) {
    const input = AnalyzeBriefSourceInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);

    const source = findBriefSource(run.sources, input.sourceId);
    const sourceDigest = requireSourceDigest(source);

    const existingEvidence = run.evidence.filter((evidence) =>
      isBriefAdapterEvidence(evidence, source.id, sourceDigest),
    );

    if (existingEvidence.length > 0) {
      return BriefAnalysisResultSchema.parse({
        sourceId: source.id,
        sourceDigest,
        duplicate: true,
        sectionCount: countBriefSections(existingEvidence),
        candidateCount: existingEvidence.length,
        evidenceAdded: 0,
        gapsAdded: 0,
        items: existingEvidence.map((evidence) => existingEvidenceItem(evidence, run.gaps)),
      });
    }

    const document = await this.normalizeBriefSource(source, sourceDigest);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const evidenceToAdd: EvidenceRef[] = [];
    const gapsToAdd: Gap[] = [];
    const items: BriefExtractedItem[] = [];

    if (isUnsupportedDocument(document)) {
      const unsupportedBlock = document.blocks[0]!;
      const evidence = createEvidenceFromBlock({
        source,
        sourceDigest,
        block: unsupportedBlock,
        timestamp,
        itemType: "note",
        flags: [],
      });
      const gap = createUnsupportedGap({
        evidence,
        block: unsupportedBlock,
        timestamp,
      });

      evidenceToAdd.push(evidence);
      gapsToAdd.push(gap);

      items.push({
        evidenceId: evidence.id,
        itemType: "note",
        location: evidence.location,
        ...fileLineFields(evidence.location),
        summary: evidence.summary,
        headingPath: [],
        flags: [],
        gapIds: [gap.id],
      });
    }

    const candidates = isUnsupportedDocument(document) ? [] : classifyBriefBlocks(document.blocks);

    for (const candidate of candidates) {
      const evidence = createEvidenceFromBlock({
        source,
        sourceDigest,
        block: {
          blockId: "candidate",
          kind: "paragraph",
          text: candidate.text,
          location: candidate.location,
          headingPath: candidate.headingPath,
          metadata: {},
        },
        timestamp,
        itemType: candidate.itemType,
        flags: candidate.flags,
      });

      evidenceToAdd.push(evidence);

      const gapIds: string[] = [];

      if (candidate.flags.includes("ambiguous")) {
        const gap = GapSchema.parse({
          id: createGapId(),
          category: "requirement",
          severity: candidate.itemType === "requirement" ? "major" : "minor",
          status: "open",
          title: "Ambiguous brief statement",
          expected: "Brief statements should define observable behavior or reviewable policy.",
          observed: candidate.text,
          impact:
            "The implementation could diverge because the statement does not provide a precise acceptance condition.",
          sourceEvidenceIds: [evidence.id],
          owner: "spec-bdd",
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        gapsToAdd.push(gap);
        gapIds.push(gap.id);
      }

      if (candidate.flags.includes("prompt-injection-like")) {
        const gap = GapSchema.parse({
          id: createGapId(),
          category: "security",
          severity: "blocker",
          status: "open",
          title: "Prompt-injection-like content in brief",
          expected:
            "Brief content must be treated as untrusted data and must not instruct the plugin or model to reveal secrets, ignore instructions, or execute tools.",
          observed: candidate.text,
          impact:
            "The content resembles an instruction aimed at the automation system rather than a product requirement.",
          sourceEvidenceIds: [evidence.id],
          owner: "evidence-verifier",
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        gapsToAdd.push(gap);
        gapIds.push(gap.id);
      }

      items.push({
        evidenceId: evidence.id,
        itemType: candidate.itemType,
        location: evidence.location,
        ...fileLineFields(evidence.location),
        summary: candidate.summary,
        headingPath: candidate.headingPath,
        flags: candidate.flags,
        gapIds,
      });
    }

    if (evidenceToAdd.length > 0 || gapsToAdd.length > 0) {
      const nextRun = RunManifestSchema.parse({
        ...run,
        revision: run.revision + 1,
        updatedAt: timestamp,
        evidence: [...run.evidence, ...evidenceToAdd],
        gaps: [...run.gaps, ...gapsToAdd],
      });

      await this.runStore.save(nextRun, run.revision);
    }

    return BriefAnalysisResultSchema.parse({
      sourceId: source.id,
      sourceDigest,
      duplicate: false,
      sectionCount: countDocumentSections(document),
      candidateCount: candidates.length,
      evidenceAdded: evidenceToAdd.length,
      gapsAdded: gapsToAdd.length,
      items,
    });
  }

  private async normalizeBriefSource(
    source: SourceRef,
    sourceDigest: Sha256Digest,
  ): Promise<NormalizedBriefDocument> {
    const format = detectBriefSourceType(source);

    if (source.locator.type !== "file") {
      return createUnsupportedBriefDocument({
        source,
        sourceDigest,
        format,
        reason: unsupportedReason(format),
      });
    }

    await this.assertSnapshotMatches(sourceDigest);

    if (format !== "markdown" && format !== "plaintext") {
      return createUnsupportedBriefDocument({
        source,
        sourceDigest,
        format,
        reason: unsupportedReason(format),
      });
    }

    const content = (await this.snapshotStore.readContent(sourceDigest)).toString("utf8");

    if (format === "plaintext") {
      return parsePlainTextBrief({
        source,
        sourceDigest,
        content,
      });
    }

    return parseMarkdownBrief({
      source,
      sourceDigest,
      content,
    });
  }

  private async assertSnapshotMatches(sourceDigest: Sha256Digest): Promise<void> {
    const metadata = await this.snapshotStore.readMetadata(sourceDigest);

    if (metadata.canonicalDigest !== sourceDigest) {
      throw new Error(
        `Source snapshot digest mismatch: expected ${sourceDigest}, got ${metadata.canonicalDigest}`,
      );
    }
  }
}

function findBriefSource(sources: SourceRef[], sourceId: string): SourceRef {
  const source = sources.find((item) => item.id === sourceId);

  if (source === undefined) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  if (source.kind !== "brief") {
    throw new Error(`Source is not a brief: ${sourceId}`);
  }

  return source;
}

function requireSourceDigest(source: SourceRef): Sha256Digest {
  if (source.digest === undefined) {
    throw new Error(`Brief source has no digest: ${source.id}`);
  }

  return source.digest;
}

function isBriefAdapterEvidence(
  evidence: EvidenceRef,
  sourceId: string,
  sourceDigest: Sha256Digest,
): boolean {
  return (
    evidence.sourceId === sourceId &&
    evidence.metadata["adapter"] === BRIEF_ADAPTER_VERSION &&
    evidence.metadata["sourceDigest"] === sourceDigest
  );
}

function existingEvidenceItem(evidence: EvidenceRef, gaps: Gap[]): BriefExtractedItem {
  const itemType = parseMetadataItemType(evidence.metadata["itemType"]);
  const flags = parseMetadataFlags(evidence.metadata["flags"]);
  const headingPath = parseMetadataHeadingPath(evidence.metadata["headingPath"]);

  return {
    evidenceId: evidence.id,
    itemType,
    location: evidence.location,
    ...fileLineFields(evidence.location),
    summary: evidence.summary,
    headingPath,
    flags,
    gapIds: gaps.filter((gap) => gap.sourceEvidenceIds.includes(evidence.id)).map((gap) => gap.id),
  };
}

function countBriefSections(evidence: EvidenceRef[]): number {
  const headings = new Set<string>();

  for (const item of evidence) {
    const headingPath = parseMetadataHeadingPath(item.metadata["headingPath"]);

    if (headingPath.length > 0) {
      headings.add(headingPath.join(" / "));
    }
  }

  return headings.size;
}

function parseMetadataItemType(value: unknown): BriefItemType {
  const parsed = BriefItemTypeSchema.safeParse(value);

  return parsed.success ? parsed.data : "requirement";
}

function parseMetadataFlags(value: unknown): BriefIssueFlag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = BriefIssueFlagSchema.safeParse(item);

    return parsed.success ? [parsed.data] : [];
  });
}

function parseMetadataHeadingPath(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function createEvidenceFromBlock(input: {
  source: SourceRef;
  sourceDigest: Sha256Digest;
  block: NormalizedBriefBlock;
  timestamp: string;
  itemType: BriefItemType;
  flags: BriefIssueFlag[];
}): EvidenceRef {
  return EvidenceRefSchema.parse({
    id: createEvidenceId(),
    sourceId: input.source.id,
    location: input.block.location,
    summary: summarizeEvidence(input.block.text),
    excerpt: input.block.text,
    digest: sha256Digest(Buffer.from(input.block.text, "utf8")),
    capturedAt: input.timestamp,
    metadata: {
      adapter: BRIEF_ADAPTER_VERSION,
      sourceDigest: input.sourceDigest,
      itemType: input.itemType,
      headingPath: input.block.headingPath,
      flags: input.flags,
      blockId: input.block.blockId,
      blockKind: input.block.kind,
      ...(input.block.metadata["unsupported"] === true ? { unsupported: true } : {}),
    },
  });
}

function createUnsupportedGap(input: {
  evidence: EvidenceRef;
  block: NormalizedBriefBlock;
  timestamp: string;
}): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "requirement",
    severity: "major",
    status: "open",
    title: "Unsupported brief source format",
    expected: "Brief sources should be normalized by a supported adapter before extraction.",
    observed: input.block.text,
    impact:
      "The brief could contain requirements, but this source format cannot be extracted deterministically yet.",
    sourceEvidenceIds: [input.evidence.id],
    owner: "spec-bdd",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  });
}

function isUnsupportedDocument(document: NormalizedBriefDocument): boolean {
  return document.metadata["unsupported"] === true;
}

function countDocumentSections(document: NormalizedBriefDocument): number {
  return document.blocks.filter((block) => block.kind === "heading").length;
}

function fileLineFields(location: EvidenceRef["location"]): {
  lineStart?: number;
  lineEnd?: number;
} {
  if (location.type !== "file-lines") {
    return {};
  }

  return {
    lineStart: location.startLine,
    lineEnd: location.endLine,
  };
}

function summarizeEvidence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157)}...`;
}

function unsupportedReason(format: string): string {
  switch (format) {
    case "pdf":
      return "PDF brief extraction is not implemented yet.";
    case "ticket":
      return "Ticket brief connector extraction is not implemented yet.";
    case "html":
      return "HTML brief extraction is not implemented yet.";
    case "unknown":
      return "Brief source format could not be detected.";
    default:
      return `Brief source format is not supported yet: ${format}.`;
  }
}
