import { z } from "zod";

import { BriefAnalysisResultSchema, type BriefExtractedItem } from "../brief/brief-analysis.js";
import {
  BriefIssueFlagSchema,
  BriefItemTypeSchema,
  classifyBriefBlocks,
  type BriefIssueFlag,
  type BriefItemType,
} from "../brief/brief-classifier.js";
import { parseMarkdownLines } from "../brief/markdown-lines.js";
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

    if (source.locator.type !== "file") {
      throw new Error("Task 08 only supports file brief sources");
    }

    const snapshotContent = await this.snapshotStore.readContent(sourceDigest);
    const content = snapshotContent.toString("utf8");

    const parsed = parseMarkdownLines(content);
    const candidates = classifyBriefBlocks(parsed.blocks);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const evidenceToAdd: EvidenceRef[] = [];
    const gapsToAdd: Gap[] = [];
    const items: BriefExtractedItem[] = [];

    for (const candidate of candidates) {
      const evidence = EvidenceRefSchema.parse({
        id: createEvidenceId(),
        sourceId: source.id,
        location: {
          type: "file-lines",
          path: source.locator.path,
          startLine: candidate.lineStart,
          endLine: candidate.lineEnd,
        },
        summary: candidate.summary,
        excerpt: candidate.text,
        digest: sha256Digest(Buffer.from(candidate.text, "utf8")),
        capturedAt: timestamp,
        metadata: {
          adapter: BRIEF_ADAPTER_VERSION,
          sourceDigest,
          itemType: candidate.itemType,
          headingPath: candidate.headingPath,
          flags: candidate.flags,
        },
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
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd,
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
      sectionCount: parsed.headings.length,
      candidateCount: candidates.length,
      evidenceAdded: evidenceToAdd.length,
      gapsAdded: gapsToAdd.length,
      items,
    });
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
  const location =
    evidence.location.type === "file-lines"
      ? evidence.location
      : { startLine: 1, endLine: 1 };

  return {
    evidenceId: evidence.id,
    itemType,
    lineStart: location.startLine,
    lineEnd: location.endLine,
    summary: evidence.summary,
    headingPath,
    flags,
    gapIds: gaps
      .filter((gap) => gap.sourceEvidenceIds.includes(evidence.id))
      .map((gap) => gap.id),
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
