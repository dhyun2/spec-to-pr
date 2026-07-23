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
