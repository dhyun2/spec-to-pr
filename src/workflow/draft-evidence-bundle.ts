import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

export const DraftEvidenceBundleSchema = z
  .object({
    featureSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Draft evidence feature slug must be kebab-case"),
    rootPath: z
      .string()
      .regex(/^\.spec-to-pr\/[a-z0-9]+(?:-[a-z0-9]+)*$/, "Draft evidence root is invalid"),
    manifestPath: z
      .string()
      .regex(
        /^\.spec-to-pr\/[a-z0-9]+(?:-[a-z0-9]+)*\/manifest\.json$/,
        "Draft evidence manifest path is invalid",
      ),
    contractsRoot: z.string().trim().min(1),
    evidenceRoot: z.string().trim().min(1),
    visualRoot: z.string().trim().min(1),
    reportRoot: z.string().trim().min(1),
  })
  .strict();

export type DraftEvidenceBundle = z.infer<typeof DraftEvidenceBundleSchema>;

const DraftEvidenceManifestArtifactSchema = z
  .object({
    path: z.string().trim().min(1).max(1_000),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export const DraftEvidenceManifestSchema = z
  .object({
    schemaVersion: z.literal("draft-evidence-manifest-v1"),
    runId: z.string().regex(/^run_[a-f0-9]{32}$/),
    runRevision: z.number().int().nonnegative(),
    phase: z.literal("pre-implementation"),
    legacyRootDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    requirementIds: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
    openSpec: z
      .object({
        changeName: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        proposal: DraftEvidenceManifestArtifactSchema,
        specs: z.array(DraftEvidenceManifestArtifactSchema).min(1).max(50),
        tasks: DraftEvidenceManifestArtifactSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.requirementIds).size !== manifest.requirementIds.length) {
      context.addIssue({
        code: "custom",
        path: ["requirementIds"],
        message: "Draft evidence requirement IDs must be unique",
      });
    }
    const paths = [
      manifest.openSpec.proposal.path,
      ...manifest.openSpec.specs.map((artifact) => artifact.path),
      manifest.openSpec.tasks.path,
    ];
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        path: ["openSpec"],
        message: "Draft evidence OpenSpec artifact paths must be unique",
      });
    }
  });

export type DraftEvidenceManifest = z.infer<typeof DraftEvidenceManifestSchema>;

export function createDraftEvidenceBundle(input: {
  mode: "legacy";
  legacyProjectRoot: string;
}): DraftEvidenceBundle {
  const featureSlug = featureSlugFromLegacyRoot(input.legacyProjectRoot);
  const rootPath = `.spec-to-pr/${featureSlug}`;

  return DraftEvidenceBundleSchema.parse({
    featureSlug,
    rootPath,
    manifestPath: `${rootPath}/manifest.json`,
    contractsRoot: `${rootPath}/contracts`,
    evidenceRoot: `${rootPath}/evidence`,
    visualRoot: `${rootPath}/visual`,
    reportRoot: `${rootPath}/report`,
  });
}

function featureSlugFromLegacyRoot(legacyProjectRoot: string): string {
  const normalized = legacyProjectRoot.trim().replace(/[\\/]+$/, "");
  const featureDirectory = path.basename(normalized);

  if (featureDirectory === "" || featureDirectory === "." || featureDirectory === "..") {
    throw new Error("Draft evidence feature slug requires a safe legacy feature directory");
  }

  const slug = featureDirectory
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9\s_-]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug === ""
    ? `feature-${createHash("sha256").update(featureDirectory).digest("hex").slice(0, 10)}`
    : slug;
}
