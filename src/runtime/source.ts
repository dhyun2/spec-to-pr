import { z } from "zod";

import { EvidenceIdSchema, SourceIdSchema } from "./ids.js";
import {
  GitObjectIdSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  Sha256DigestSchema,
} from "./scalars.js";

export const SourceKindSchema = z.enum([
  "brief",
  "figma",
  "openapi",
  "repository",
  "generated",
  "test-report",
  "other",
]);

export const FileSourceLocatorSchema = z
  .object({
    type: z.literal("file"),
    path: RelativePathSchema,
    mediaType: z.string().trim().min(1).optional(),
  })
  .strict();

export const UrlSourceLocatorSchema = z
  .object({
    type: z.literal("url"),
    url: z.string().url(),
    mediaType: z.string().trim().min(1).optional(),
  })
  .strict();

export const FigmaSourceLocatorSchema = z
  .object({
    type: z.literal("figma"),
    url: z.string().url(),
    fileKey: z.string().trim().min(1).optional(),
    nodeId: z.string().trim().min(1).optional(),
  })
  .strict();

export const RepositorySourceLocatorSchema = z
  .object({
    type: z.literal("repository"),
    root: z.string().trim().min(1),
    commit: GitObjectIdSchema.optional(),
  })
  .strict();

export const TicketProviderSchema = z.enum(["jira", "gitlab", "github", "notion", "linear"]);

export const TicketSourceLocatorSchema = z
  .object({
    type: z.literal("ticket"),
    provider: TicketProviderSchema,
    url: z.string().url(),
    externalId: z.string().trim().min(1).optional(),
    mediaType: z.string().trim().min(1).optional(),
  })
  .strict();

export const SourceLocatorSchema = z.discriminatedUnion("type", [
  FileSourceLocatorSchema,
  UrlSourceLocatorSchema,
  FigmaSourceLocatorSchema,
  RepositorySourceLocatorSchema,
  TicketSourceLocatorSchema,
]);

export const SourceRefSchema = z
  .object({
    id: SourceIdSchema,
    kind: SourceKindSchema,
    locator: SourceLocatorSchema,
    digest: Sha256DigestSchema.optional(),
    capturedAt: IsoDateTimeSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const FileLinesEvidenceLocationSchema = z
  .object({
    type: z.literal("file-lines"),
    path: RelativePathSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict()
  .superRefine((location, context) => {
    if (location.endLine < location.startLine) {
      context.addIssue({
        code: "custom",
        message: "endLine must be greater than or equal to startLine",
        path: ["endLine"],
      });
    }
  });

export const JsonPointerEvidenceLocationSchema = z
  .object({
    type: z.literal("json-pointer"),
    document: RelativePathSchema,
    pointer: z.string().startsWith("/"),
  })
  .strict();

export const FigmaNodeEvidenceLocationSchema = z
  .object({
    type: z.literal("figma-node"),
    fileKey: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    propertyPath: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export const UrlFragmentEvidenceLocationSchema = z
  .object({
    type: z.literal("url-fragment"),
    url: z.string().url(),
    fragment: z.string().trim().min(1),
  })
  .strict();

export const PdfPageEvidenceLocationSchema = z
  .object({
    type: z.literal("pdf-page"),
    path: RelativePathSchema,
    page: z.number().int().positive(),
  })
  .strict();

export const PdfTextBlockEvidenceLocationSchema = z
  .object({
    type: z.literal("pdf-text-block"),
    path: RelativePathSchema,
    page: z.number().int().positive(),
    blockIndex: z.number().int().nonnegative(),
  })
  .strict();

export const TicketFieldEvidenceLocationSchema = z
  .object({
    type: z.literal("ticket-field"),
    provider: TicketProviderSchema,
    url: z.string().url(),
    field: z.string().trim().min(1),
    commentId: z.string().trim().min(1).optional(),
  })
  .strict();

export const GitFileEvidenceLocationSchema = z
  .object({
    type: z.literal("git-file"),
    commit: GitObjectIdSchema,
    path: RelativePathSchema,
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((location, context) => {
    const hasStartLine = location.startLine !== undefined;
    const hasEndLine = location.endLine !== undefined;

    if (hasStartLine !== hasEndLine) {
      context.addIssue({
        code: "custom",
        message: "startLine and endLine must be provided together",
        path: ["startLine"],
      });
    }

    if (
      location.startLine !== undefined &&
      location.endLine !== undefined &&
      location.endLine < location.startLine
    ) {
      context.addIssue({
        code: "custom",
        message: "endLine must be greater than or equal to startLine",
        path: ["endLine"],
      });
    }
  });

export const EvidenceLocationSchema = z.discriminatedUnion("type", [
  FileLinesEvidenceLocationSchema,
  JsonPointerEvidenceLocationSchema,
  FigmaNodeEvidenceLocationSchema,
  UrlFragmentEvidenceLocationSchema,
  PdfPageEvidenceLocationSchema,
  PdfTextBlockEvidenceLocationSchema,
  TicketFieldEvidenceLocationSchema,
  GitFileEvidenceLocationSchema,
]);

export const EvidenceRefSchema = z
  .object({
    id: EvidenceIdSchema,
    sourceId: SourceIdSchema,
    location: EvidenceLocationSchema,
    summary: z.string().trim().min(1).max(2_000),
    excerpt: z.string().max(4_000).optional(),
    digest: Sha256DigestSchema,
    capturedAt: IsoDateTimeSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type TicketProvider = z.infer<typeof TicketProviderSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type EvidenceLocation = z.infer<typeof EvidenceLocationSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
