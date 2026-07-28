import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ArtifactRef } from "../runtime/artifact.js";
import { ArtifactIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import type { ImplementationReviewPacket } from "../workflow/workflow-contracts.js";

const ReviewPacketIdSchema = z
  .string()
  .regex(/^packet_[a-f0-9]{64}$/, "Expected packet_<64 lowercase hex characters>");
const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(isSafeRelativePath, "Expected a safe project-relative path");
const PRODUCT_SOURCE_EXTENSION = /\.(?:js|jsx|ts|tsx|vue|svelte|css|scss)$/i;
const BROWSER_BUNDLE_EXTENSION = /\.(?:js|mjs|cjs|css)$/i;
const MAX_PERCENT_DECODE_ROUNDS = 4;

export const BaselineIsolationEvidenceSchema = z
  .object({
    schemaVersion: z.literal("baseline-isolation-v1"),
    reviewPacketId: ReviewPacketIdSchema,
    headSha: GitObjectIdSchema,
    baselineArtifacts: z
      .array(
        z
          .object({
            artifactId: ArtifactIdSchema,
            path: RelativePathSchema,
            digest: Sha256DigestSchema,
          })
          .strict(),
      )
      .min(1),
    checkedSourceFiles: z
      .array(
        z
          .object({
            path: RelativePathSchema,
            digest: Sha256DigestSchema,
          })
          .strict(),
      )
      .min(1),
    requestedResources: z.array(
      z
        .object({
          url: z.string().url(),
          digest: Sha256DigestSchema.optional(),
        })
        .strict(),
    ),
    renderedMedia: z.array(
      z
        .object({
          selector: z.string().trim().min(1),
          sourceUrl: z.string().url().optional(),
          digest: Sha256DigestSchema.optional(),
        })
        .strict(),
    ),
    violations: z.array(
      z
        .object({
          kind: z.enum(["source-reference", "network-request", "rendered-baseline"]),
          evidence: z.string().trim().min(1),
        })
        .strict(),
    ),
    status: z.literal("passed"),
  })
  .strict();

export type BaselineIsolationEvidence = z.infer<typeof BaselineIsolationEvidenceSchema>;

export async function assertBaselineIsolation(input: {
  projectRoot: string;
  packet: ImplementationReviewPacket;
  baselineArtifacts: ArtifactRef[];
  evidence: unknown;
  implementationSourceFiles?: string[];
  designSystemSourceFiles?: string[];
  browserBundlePaths?: string[];
  excludedPaths?: string[];
}): Promise<BaselineIsolationEvidence> {
  const evidence = parseEvidence(input.evidence);
  const baselineArtifacts = canonicalBaselines(input.baselineArtifacts);
  if (evidence.reviewPacketId !== input.packet.id || evidence.headSha !== input.packet.headSha) {
    invalid("evidence must bind the current review packet and implementation head");
  }
  assertExactBaselineBindings(evidence, baselineArtifacts);
  if (evidence.violations.length > 0) {
    invalid("submitted evidence reports baseline-isolation violations");
  }

  const excludedPaths = new Set(
    [...baselineArtifacts.map((baseline) => baseline.path), ...(input.excludedPaths ?? [])].map(
      normalizeRelativePath,
    ),
  );
  const derivedSourcePaths = deriveProductSourcePaths({
    changedFiles: input.packet.changedFiles,
    implementationSourceFiles: input.implementationSourceFiles ?? [],
    designSystemSourceFiles: input.designSystemSourceFiles ?? [],
    browserBundlePaths: input.browserBundlePaths ?? [],
    excludedPaths,
  });
  const checkedPaths = evidence.checkedSourceFiles.map((source) =>
    normalizeRelativePath(source.path),
  );
  if (
    new Set(checkedPaths).size !== checkedPaths.length ||
    checkedPaths.length !== derivedSourcePaths.length ||
    checkedPaths.some((sourcePath) => !derivedSourcePaths.includes(sourcePath))
  ) {
    invalid(
      `checked source coverage must exactly match derived production sources; expected: ${derivedSourcePaths.join(", ") || "none"}`,
    );
  }

  const root = await resolvedProjectRoot(input.projectRoot);
  const baselineTokens = baselineArtifacts.flatMap((baseline) => baselineReferenceTokens(baseline));
  for (const source of evidence.checkedSourceFiles) {
    const sourcePath = normalizeRelativePath(source.path);
    const content = await readBoundedSource(root, sourcePath);
    const digest = sha256(content);
    if (digest !== source.digest) {
      invalid(`source digest does not match ${sourcePath}`);
    }
    const text = canonicalReferenceText(content.toString("utf8"));
    const matchedToken = baselineTokens.find((token) => text.includes(token));
    if (matchedToken !== undefined) {
      invalid(`product source ${sourcePath} references immutable baseline evidence`);
    }
  }

  for (const resource of evidence.requestedResources) {
    if (
      matchesBaselineDigest(resource.digest, baselineArtifacts) ||
      matchesBaselineUrl(resource.url, baselineArtifacts)
    ) {
      invalid(`requested resource references immutable baseline evidence: ${resource.url}`);
    }
  }
  for (const media of evidence.renderedMedia) {
    if (
      matchesBaselineDigest(media.digest, baselineArtifacts) ||
      (media.sourceUrl !== undefined && matchesBaselineUrl(media.sourceUrl, baselineArtifacts))
    ) {
      invalid(`rendered media references immutable baseline evidence: ${media.selector}`);
    }
  }
  return evidence;
}

type CanonicalBaseline = {
  artifactId: string;
  path: string;
  digest: string;
  uri: string;
};

function parseEvidence(raw: unknown): BaselineIsolationEvidence {
  const parsed = BaselineIsolationEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    invalid("evidence schema is invalid");
  }
  return parsed.data;
}

function canonicalBaselines(artifacts: ArtifactRef[]): CanonicalBaseline[] {
  if (artifacts.length === 0) invalid("at least one immutable baseline artifact is required");
  const baselines = artifacts.map((artifact) => {
    const rawPath = artifact.metadata["projectRelativePath"];
    if (typeof rawPath !== "string" || !isSafeRelativePath(rawPath)) {
      invalid(`baseline artifact ${artifact.id} is missing a safe project-relative path`);
    }
    return {
      artifactId: artifact.id,
      path: normalizeRelativePath(rawPath),
      digest: artifact.digest,
      uri: artifact.uri,
    };
  });
  if (
    new Set(baselines.map((baseline) => baseline.artifactId)).size !== baselines.length ||
    new Set(baselines.map((baseline) => baseline.path)).size !== baselines.length
  ) {
    invalid("baseline artifact IDs and paths must be unique");
  }
  return baselines.sort((left, right) => left.path.localeCompare(right.path));
}

function assertExactBaselineBindings(
  evidence: BaselineIsolationEvidence,
  baselines: CanonicalBaseline[],
): void {
  const supplied = evidence.baselineArtifacts
    .map((baseline) => ({
      ...baseline,
      path: normalizeRelativePath(baseline.path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    supplied.length !== baselines.length ||
    supplied.some((baseline, index) => {
      const expected = baselines[index];
      return (
        expected === undefined ||
        baseline.artifactId !== expected.artifactId ||
        baseline.path !== expected.path ||
        baseline.digest !== expected.digest
      );
    })
  ) {
    invalid("baseline artifact bindings do not match the current immutable baselines");
  }
}

function deriveProductSourcePaths(input: {
  changedFiles: string[];
  implementationSourceFiles: string[];
  designSystemSourceFiles: string[];
  browserBundlePaths: string[];
  excludedPaths: ReadonlySet<string>;
}): string[] {
  const candidates = [
    ...input.changedFiles
      .filter((sourcePath) => PRODUCT_SOURCE_EXTENSION.test(sourcePath))
      .map((sourcePath) => ({ sourcePath, bundle: false })),
    ...input.implementationSourceFiles
      .filter((sourcePath) => PRODUCT_SOURCE_EXTENSION.test(sourcePath))
      .map((sourcePath) => ({ sourcePath, bundle: false })),
    ...input.designSystemSourceFiles
      .filter((sourcePath) => PRODUCT_SOURCE_EXTENSION.test(sourcePath))
      .map((sourcePath) => ({ sourcePath, bundle: false })),
    ...input.browserBundlePaths
      .filter((sourcePath) => BROWSER_BUNDLE_EXTENSION.test(sourcePath))
      .map((sourcePath) => ({ sourcePath, bundle: true })),
  ];
  const derived = new Set<string>();
  for (const candidate of candidates) {
    if (!isSafeRelativePath(candidate.sourcePath)) {
      invalid(`production source path is unsafe: ${candidate.sourcePath}`);
    }
    const sourcePath = normalizeRelativePath(candidate.sourcePath);
    if (
      input.excludedPaths.has(sourcePath) ||
      (!candidate.bundle && !PRODUCT_SOURCE_EXTENSION.test(sourcePath))
    ) {
      continue;
    }
    derived.add(sourcePath);
  }
  if (derived.size === 0) {
    invalid("derived production source set is empty");
  }
  return [...derived].sort();
}

async function resolvedProjectRoot(projectRoot: string): Promise<string> {
  try {
    return await realpath(projectRoot);
  } catch {
    invalid("project root does not exist");
  }
}

async function readBoundedSource(root: string, sourcePath: string): Promise<Buffer> {
  const requested = path.resolve(root, sourcePath);
  assertWithinRoot(root, requested, sourcePath);
  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch {
    invalid(`derived production source does not exist: ${sourcePath}`);
  }
  assertWithinRoot(root, resolved, sourcePath);
  const details = await stat(resolved);
  if (!details.isFile() || details.size > 50 * 1024 * 1024) {
    invalid(`derived production source is not a bounded regular file: ${sourcePath}`);
  }
  return readFile(resolved);
}

function assertWithinRoot(root: string, candidate: string, originalPath: string): void {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    invalid(`production source resolves outside the project root: ${originalPath}`);
  }
}

function baselineReferenceTokens(baseline: CanonicalBaseline): string[] {
  const artifactDigestPath = baseline.digest.replace("sha256:", "artifact://sha256/");
  return [
    ...new Set(
      [baseline.path, `/${baseline.path}`, baseline.digest, baseline.uri, artifactDigestPath].map(
        canonicalReferenceText,
      ),
    ),
  ];
}

function matchesBaselineDigest(
  digest: string | undefined,
  baselines: CanonicalBaseline[],
): boolean {
  return digest !== undefined && baselines.some((baseline) => baseline.digest === digest);
}

function matchesBaselineUrl(url: string, baselines: CanonicalBaseline[]): boolean {
  const decoded = canonicalReferenceText(url);
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    return false;
  }
  const requestedPath = canonicalUrlPath(parsed.pathname);
  const queryValues = [...parsed.searchParams.values()].map(canonicalUrlPath);
  return baselines.some((baseline) => {
    const baselinePath = canonicalUrlPath(baseline.path);
    return (
      decoded === canonicalReferenceText(baseline.uri) ||
      decoded.includes(baseline.digest.toLowerCase()) ||
      hasSegmentBoundSuffix(requestedPath, baselinePath) ||
      queryValues.some((value) => hasSegmentBoundSuffix(value, baselinePath))
    );
  });
}

function hasSegmentBoundSuffix(value: string, suffix: string): boolean {
  return value === suffix || value.endsWith(`/${suffix}`);
}

function canonicalReferenceText(value: string): string {
  return decodePercentEncoding(value).replace(/\\+/g, "/").toLowerCase();
}

function canonicalUrlPath(value: string): string {
  const decoded = decodePercentEncoding(value).replace(/\\+/g, "/");
  return path.posix.normalize(`/${decoded}`).replace(/^\/+/, "").toLowerCase();
}

function decodePercentEncoding(value: string): string {
  let decoded = value;
  for (let round = 0; round < MAX_PERCENT_DECODE_ROUNDS; round += 1) {
    const next = decodePercentEncodingOnce(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  if (decodePercentEncodingOnce(decoded) !== decoded) {
    invalid(`percent encoding exceeds ${String(MAX_PERCENT_DECODE_ROUNDS)} decoding rounds`);
  }
  return decoded;
}

function decodePercentEncodingOnce(value: string): string {
  return value.replace(/(?:%[a-f0-9]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
}

function normalizeRelativePath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/"));
}

function isSafeRelativePath(value: string): boolean {
  if (value.trim() !== value || value === "" || path.isAbsolute(value) || value.includes("\0")) {
    return false;
  }
  const normalized = normalizeRelativePath(value);
  return normalized !== ".." && !normalized.startsWith("../") && normalized !== ".";
}

function sha256(content: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function invalid(reason: string): never {
  throw new Error(`VISUAL_BASELINE_ISOLATION_INVALID: ${reason}`);
}
