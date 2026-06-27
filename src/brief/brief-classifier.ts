import { z } from "zod";

import { EvidenceLocationSchema } from "../runtime/source.js";
import type { NormalizedBriefBlock } from "./normalized-brief.js";

export const BriefItemTypeSchema = z.enum([
  "requirement",
  "policy",
  "api",
  "design",
  "test",
  "out-of-scope",
  "note",
]);

export const BriefIssueFlagSchema = z.enum(["ambiguous", "prompt-injection-like"]);

export const BriefCandidateSchema = z
  .object({
    itemType: BriefItemTypeSchema,
    location: EvidenceLocationSchema,
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    text: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    headingPath: z.array(z.string()).default([]),
    flags: z.array(BriefIssueFlagSchema).default([]),
  })
  .strict();

export type BriefItemType = z.infer<typeof BriefItemTypeSchema>;
export type BriefIssueFlag = z.infer<typeof BriefIssueFlagSchema>;
export type BriefCandidate = z.infer<typeof BriefCandidateSchema>;

const REQUIREMENT_PATTERNS = [
  /해야\s*한다/,
  /해야\s*함/,
  /필수/,
  /제공/,
  /지원/,
  /가능해야/,
  /표시/,
  /노출/,
  /관리/,
  /생성/,
  /수정/,
  /삭제/,
  /변경/,
  /조회/,
  /검색/,
  /필터/,
  /정렬/,
  /저장/,
  /검증/,
  /\bmust\b/i,
  /\bshould\b/i,
  /\brequired\b/i,
] as const;

const POLICY_PATTERNS = [
  /정책/,
  /규칙/,
  /조건/,
  /제한/,
  /상태/,
  /권한/,
  /가드/,
  /guard/i,
  /fallback/i,
] as const;

const API_PATTERNS = [
  /\bAPI\b/i,
  /\bOpenAPI\b/i,
  /\bendpoint\b/i,
  /엔드포인트/,
  /응답/,
  /요청/,
  /\bGET\b/,
  /\bPOST\b/,
  /\bPUT\b/,
  /\bPATCH\b/,
  /\bDELETE\b/,
  /status\s*code/i,
] as const;

const DESIGN_PATTERNS = [
  /\bFigma\b/i,
  /피그마/,
  /\bUI\b/i,
  /화면/,
  /디자인/,
  /컴포넌트/,
  /토큰/,
  /색상/,
  /타이포/,
  /모바일/,
  /데스크톱/,
] as const;

const TEST_PATTERNS = [
  /테스트/,
  /검증/,
  /통과/,
  /coverage/i,
  /unit/i,
  /component/i,
  /e2e/i,
  /acceptance/i,
  /시나리오/,
] as const;

const OUT_OF_SCOPE_PATTERNS = [
  /범위\s*제외/,
  /제외/,
  /하지\s*않음/,
  /구현하지\s*않음/,
  /추후/,
  /이번\s*범위가\s*아님/,
  /out\s+of\s+scope/i,
] as const;

const AMBIGUITY_PATTERNS = [
  /적절히/,
  /빠르게/,
  /사용자\s*친화/,
  /간단히/,
  /충분히/,
  /가능하면/,
  /필요시/,
  /기존과\s*동일/,
  /기존처럼/,
  /등$/,
  /\betc\.?$/i,
  /\bas appropriate\b/i,
  /\buser friendly\b/i,
] as const;

const PROMPT_INJECTION_LIKE_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /ignore\s+all\s+previous/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /reveal\s+.*secret/i,
  /exfiltrate/i,
  /api\s*key/i,
  /access\s*token/i,
  /이전\s*지시.*무시/,
  /시스템\s*프롬프트/,
  /개발자\s*메시지/,
  /비밀.*출력/,
  /토큰.*출력/,
  /API\s*키.*출력/,
  /모든\s*도구.*실행/,
] as const;

export function classifyBriefBlocks(blocks: NormalizedBriefBlock[]): BriefCandidate[] {
  return blocks
    .filter((block) => block.kind !== "heading")
    .map(classifyBlock)
    .filter((candidate): candidate is BriefCandidate => candidate !== undefined);
}

function classifyBlock(block: NormalizedBriefBlock): BriefCandidate | undefined {
  const text = block.text.trim();

  if (text.length === 0) {
    return undefined;
  }

  const itemType = classifyText(text);
  const flags = detectFlags(text);

  if (itemType === "note" && flags.length === 0) {
    return undefined;
  }

  return BriefCandidateSchema.parse({
    itemType,
    location: block.location,
    ...(block.location.type === "file-lines"
      ? {
          lineStart: block.location.startLine,
          lineEnd: block.location.endLine,
        }
      : {}),
    text,
    summary: summarizeText(text),
    headingPath: block.headingPath,
    flags,
  });
}

function classifyText(text: string): BriefItemType {
  if (matchesAny(text, OUT_OF_SCOPE_PATTERNS)) {
    return "out-of-scope";
  }

  if (matchesAny(text, API_PATTERNS)) {
    return "api";
  }

  if (matchesAny(text, DESIGN_PATTERNS)) {
    return "design";
  }

  if (matchesAny(text, TEST_PATTERNS)) {
    return "test";
  }

  if (matchesAny(text, POLICY_PATTERNS)) {
    return "policy";
  }

  if (matchesAny(text, REQUIREMENT_PATTERNS)) {
    return "requirement";
  }

  return "note";
}

function detectFlags(text: string): BriefIssueFlag[] {
  const flags: BriefIssueFlag[] = [];

  if (matchesAny(text, AMBIGUITY_PATTERNS)) {
    flags.push("ambiguous");
  }

  if (matchesAny(text, PROMPT_INJECTION_LIKE_PATTERNS)) {
    flags.push("prompt-injection-like");
  }

  return flags;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157)}...`;
}
