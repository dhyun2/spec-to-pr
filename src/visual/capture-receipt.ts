import { z } from "zod";

import { VisualSizeSchema } from "../figma/figma-capture-contract.js";
import {
  GitObjectIdSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  Sha256DigestSchema,
} from "../runtime/scalars.js";

const ReviewPacketIdSchema = z
  .string()
  .regex(/^packet_[a-f0-9]{64}$/, "Expected packet_<64 lowercase hex characters>");

const DigestEntrySchema = z
  .object({
    family: z.string().trim().min(1).max(300),
    digest: Sha256DigestSchema,
  })
  .strict();

export const VisualCaptureReceiptSchema = z
  .object({
    reviewPacketId: ReviewPacketIdSchema,
    headSha: GitObjectIdSchema,
    targetId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._:-]*$/i),
    route: z.string().trim().min(1).max(2_000),
    state: z.string().trim().min(1).max(200),
    captureKind: z.enum(["viewport", "full-frame"]),
    logicalSize: VisualSizeSchema,
    deviceScaleFactor: z.number().positive().max(8),
    playwrightVersion: z.string().trim().min(1).max(100),
    browserName: z.string().trim().min(1).max(100),
    browserVersion: z.string().trim().min(1).max(200),
    locale: z.string().trim().min(1).max(100),
    colorScheme: z.enum(["light", "dark", "no-preference"]),
    timezone: z.string().trim().min(1).max(200),
    userAgent: z.string().trim().min(1).max(2_000),
    fonts: z.array(DigestEntrySchema).max(200),
    fixture: z
      .object({
        id: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .regex(/^[a-z0-9][a-z0-9._:-]*$/i),
        digest: Sha256DigestSchema,
      })
      .strict(),
    assets: z
      .array(
        z
          .object({
            path: RelativePathSchema,
            digest: Sha256DigestSchema,
          })
          .strict(),
      )
      .max(2_000),
    assetsComplete: z.literal(true),
    actual: z
      .object({
        path: RelativePathSchema,
        digest: Sha256DigestSchema,
        bitmapSize: VisualSizeSchema,
      })
      .strict(),
    runnerVersion: z.literal("capture-runner-v1"),
    normalizerVersion: z.literal("visual-normalizer-v1"),
    capturedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    assertUniqueReceiptValues(
      receipt.fonts.map((font) => font.family),
      ["fonts"],
      context,
    );
    assertUniqueReceiptValues(
      receipt.assets.map((asset) => asset.path),
      ["assets"],
      context,
    );
  });

export type VisualCaptureReceipt = z.infer<typeof VisualCaptureReceiptSchema>;

type ReceiptPacket = {
  id: string;
  headSha: string;
};

type ReceiptTarget = {
  targetId: string;
  route: string;
  state: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  fixture: string;
  figmaCapture?:
    | {
        captureKind: "viewport" | "full-frame";
        logicalSize: { width: number; height: number };
      }
    | undefined;
};

export function assertCaptureReceipt(rawInput: {
  receipt: unknown;
  packet: ReceiptPacket;
  target: ReceiptTarget;
  actualDigest: string;
  fixtureDigest: string;
  actualPath?: string;
  expectedFonts?: Array<{ family: string; digest: string }>;
  expectedAssets?: Array<{ path: string; digest: string }>;
}): VisualCaptureReceipt {
  const parsed = VisualCaptureReceiptSchema.safeParse(rawInput.receipt);
  if (!parsed.success) {
    throw provenanceError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const receipt = parsed.data;
  const geometry = rawInput.target.figmaCapture;
  if (geometry === undefined) {
    throw provenanceError("strict receipt target is missing Figma geometry");
  }
  if (
    receipt.fixture.id !== rawInput.target.fixture ||
    receipt.fixture.digest !== rawInput.fixtureDigest
  ) {
    throw new Error(
      `MOCK_FIXTURE_NOT_CONSUMED: receipt fixture ${receipt.fixture.id} at ${receipt.fixture.digest} does not match ${rawInput.target.fixture} at ${rawInput.fixtureDigest}`,
    );
  }

  const expectedBitmapSize = {
    width: Math.round(rawInput.target.viewport.width * rawInput.target.deviceScaleFactor),
    height: Math.round(rawInput.target.viewport.height * rawInput.target.deviceScaleFactor),
  };
  const provenanceMatches =
    receipt.reviewPacketId === rawInput.packet.id &&
    receipt.headSha === rawInput.packet.headSha &&
    receipt.targetId === rawInput.target.targetId &&
    receipt.route === rawInput.target.route &&
    receipt.state === rawInput.target.state &&
    receipt.captureKind === geometry.captureKind &&
    sameSize(receipt.logicalSize, geometry.logicalSize) &&
    receipt.deviceScaleFactor === rawInput.target.deviceScaleFactor &&
    receipt.actual.digest === rawInput.actualDigest &&
    sameSize(receipt.actual.bitmapSize, expectedBitmapSize) &&
    (rawInput.actualPath === undefined || receipt.actual.path === rawInput.actualPath) &&
    hasExactDigestEntries(receipt.fonts, rawInput.expectedFonts ?? []) &&
    hasExactDigestEntries(receipt.assets, rawInput.expectedAssets ?? []);
  if (!provenanceMatches) {
    throw provenanceError("receipt does not match the current packet, target, or capture artifact");
  }
  return receipt;
}

function sameSize(
  left: { width: number; height: number },
  right: { width: number; height: number },
): boolean {
  return left.width === right.width && left.height === right.height;
}

function hasExactDigestEntries(
  received: Array<{ digest: string; family?: string; path?: string }>,
  expected: Array<{ digest: string; family?: string; path?: string }>,
): boolean {
  if (expected.length === 0) return true;
  return (
    received.length === expected.length &&
    expected.every((expectedEntry) =>
      received.some(
        (receivedEntry) =>
          receivedEntry.digest === expectedEntry.digest &&
          receivedEntry.family === expectedEntry.family &&
          receivedEntry.path === expectedEntry.path,
      ),
    )
  );
}

function assertUniqueReceiptValues(
  values: string[],
  path: Array<string | number>,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message: "Receipt entries must be unique" });
  }
}

function provenanceError(message: string): Error {
  return new Error(`VISUAL_CAPTURE_PROVENANCE_INVALID: ${message}`);
}
