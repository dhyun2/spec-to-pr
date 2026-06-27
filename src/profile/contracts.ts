import { z } from "zod";

import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema, RelativePathSchema } from "../runtime/scalars.js";

export const IntakeSourceKindSchema = z.enum(["brief", "figma", "openapi"]);

export const IntakeSourceLocatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("file"),
      path: RelativePathSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("url"),
      url: z.string().url(),
    })
    .strict(),
  z
    .object({
      type: z.literal("figma"),
      url: z.string().url(),
      fileKey: z.string().trim().min(1).optional(),
      nodeId: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

export const IntakeSourceInputSchema = z
  .object({
    kind: IntakeSourceKindSchema,
    locator: IntakeSourceLocatorSchema,
    required: z.boolean().default(true),
    label: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const IntakeManifestSchema = z
  .object({
    runId: RunIdSchema,
    projectRoot: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema.optional(),
    targetWorkspace: z.string().trim().min(1).optional(),
    language: z.enum(["ko", "en"]).default("ko"),
    requestedScope: z.string().trim().min(1).max(4_000).optional(),
    sources: z.array(IntakeSourceInputSchema).default([]),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ConfidenceSchema = z.enum(["high", "medium", "low", "unknown"]);

export const ProfileFindingSeveritySchema = z.enum(["info", "warning", "risk", "gap"]);

export const ProfileFindingSchema = z
  .object({
    severity: ProfileFindingSeveritySchema,
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    evidence: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun", "unknown"]);

export const GitProfileSchema = z
  .object({
    isGitRepository: z.boolean(),
    root: z.string().trim().min(1).optional(),
    headCommit: GitObjectIdSchema.optional(),
    currentBranch: z.string().trim().min(1).optional(),
    isDirty: z.boolean().optional(),
    isShallow: z.boolean().optional(),
  })
  .strict();

export const PackageManagerProfileSchema = z
  .object({
    name: PackageManagerSchema,
    confidence: ConfidenceSchema,
    lockfiles: z.array(RelativePathSchema).default([]),
    packageJsonPath: RelativePathSchema.optional(),
    packageManagerField: z.string().trim().min(1).optional(),
    installCommand: z.string().trim().min(1).optional(),
    runCommandPrefix: z.string().trim().min(1).optional(),
  })
  .strict();

export const WorkspacePackageSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    path: RelativePathSchema,
    packageJsonPath: RelativePathSchema,
    private: z.boolean().optional(),
    scripts: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const WorkspaceProfileSchema = z
  .object({
    isMonorepo: z.boolean(),
    rootPackageJson: RelativePathSchema.optional(),
    patterns: z.array(z.string().trim().min(1)).default([]),
    packages: z.array(WorkspacePackageSchema).default([]),
  })
  .strict();

export const FrameworkProfileSchema = z
  .object({
    primary: z
      .enum(["react", "next", "vue", "nuxt", "svelte", "angular", "node", "unknown"])
      .default("unknown"),
    buildTool: z
      .enum(["vite", "next", "webpack", "rspack", "turbo", "tsup", "unknown"])
      .default("unknown"),
    testRunner: z.enum(["vitest", "jest", "playwright", "cypress", "unknown"]).default("unknown"),
    language: z.enum(["typescript", "javascript", "mixed", "unknown"]).default("unknown"),
    confidence: ConfidenceSchema,
    evidence: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const FsdLayerSchema = z.enum(["app", "pages", "widgets", "features", "entities", "shared"]);

export const FsdProfileSchema = z
  .object({
    detected: z.boolean(),
    confidence: ConfidenceSchema,
    rootCandidates: z.array(RelativePathSchema).default([]),
    presentLayers: z.array(FsdLayerSchema).default([]),
  })
  .strict();

export const DesignSystemProfileSchema = z
  .object({
    detected: z.boolean(),
    confidence: ConfidenceSchema,
    componentRoots: z.array(RelativePathSchema).default([]),
    tokenFiles: z.array(RelativePathSchema).default([]),
    evidence: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const ApiGenerationProfileSchema = z
  .object({
    detected: z.boolean(),
    confidence: ConfidenceSchema,
    generatorScripts: z.array(z.string().trim().min(1)).default([]),
    generatedClientRoots: z.array(RelativePathSchema).default([]),
    openapiSourceCandidates: z.array(RelativePathSchema).default([]),
    evidence: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const ProjectProfileSchema = z
  .object({
    runId: RunIdSchema,
    projectRoot: z.string().trim().min(1),
    profiledAt: IsoDateTimeSchema,
    profileArtifactId: ArtifactIdSchema.optional(),
    git: GitProfileSchema,
    packageManager: PackageManagerProfileSchema,
    workspace: WorkspaceProfileSchema,
    framework: FrameworkProfileSchema,
    fsd: FsdProfileSchema,
    designSystem: DesignSystemProfileSchema,
    apiGeneration: ApiGenerationProfileSchema,
    findings: z.array(ProfileFindingSchema).default([]),
  })
  .strict();

export type IntakeManifest = z.infer<typeof IntakeManifestSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type ProfileFinding = z.infer<typeof ProfileFindingSchema>;
export type WorkspacePackage = z.infer<typeof WorkspacePackageSchema>;
