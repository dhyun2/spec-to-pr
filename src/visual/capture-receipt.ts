import { createHash } from "node:crypto";

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

const ReceiptBindingFields = {
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
  actual: z
    .object({
      path: RelativePathSchema,
      digest: Sha256DigestSchema,
      bitmapSize: VisualSizeSchema,
    })
    .strict(),
  normalizerVersion: z.literal("visual-normalizer-v1"),
  capturedAt: IsoDateTimeSchema,
} as const;

export const CaptureEnvironmentV2Schema = z
  .object({
    browser: z
      .object({
        family: z.string().trim().min(1),
        channel: z.string().trim().min(1),
        version: z.string().trim().min(1),
        userAgent: z.string().trim().min(1),
      })
      .strict(),
    renderer: z
      .object({
        adapter: z.literal("spec-to-pr-playwright"),
        adapterVersion: z.string().trim().min(1),
        playwrightVersion: z.string().trim().min(1),
      })
      .strict(),
    locale: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
    colorScheme: z.enum(["light", "dark", "no-preference"]),
    reducedMotion: z.enum(["reduce", "no-preference"]),
    serverOrigin: z.string().url(),
    readiness: z
      .object({
        documentReadyState: z.literal("complete"),
        fontsReady: z.literal(true),
        imagesReady: z.literal(true),
        assetsReady: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type CaptureEnvironmentV2 = z.infer<typeof CaptureEnvironmentV2Schema>;

export const VisualCaptureReceiptV1Schema = z
  .object({
    ...ReceiptBindingFields,
    playwrightVersion: z.string().trim().min(1).max(100),
    browserName: z.string().trim().min(1).max(100),
    browserVersion: z.string().trim().min(1).max(200),
    locale: z.string().trim().min(1).max(100),
    colorScheme: z.enum(["light", "dark", "no-preference"]),
    timezone: z.string().trim().min(1).max(200),
    userAgent: z.string().trim().min(1).max(2_000),
    assetsComplete: z.literal(true),
    runnerVersion: z.literal("capture-runner-v1"),
  })
  .strict()
  .superRefine(assertUniqueReceiptEntries);

export const VisualCaptureReceiptV2Schema = z
  .object({
    schemaVersion: z.literal("visual-capture-receipt-v2"),
    ...ReceiptBindingFields,
    environment: CaptureEnvironmentV2Schema,
  })
  .strict()
  .superRefine(assertUniqueReceiptEntries);

export const VisualCaptureReceiptSchema = z.union([
  VisualCaptureReceiptV2Schema,
  VisualCaptureReceiptV1Schema,
]);

export type VisualCaptureReceipt = z.infer<typeof VisualCaptureReceiptSchema>;
export type VisualCaptureReceiptV2 = z.infer<typeof VisualCaptureReceiptV2Schema>;

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

export function captureRendererLineageId(rawEnvironment: CaptureEnvironmentV2): `sha256:${string}` {
  const environment = CaptureEnvironmentV2Schema.parse(rawEnvironment);
  const canonical = {
    browser: {
      family: environment.browser.family,
      channel: environment.browser.channel,
      version: environment.browser.version,
    },
    renderer: {
      adapter: environment.renderer.adapter,
      adapterVersion: environment.renderer.adapterVersion,
      playwrightVersion: environment.renderer.playwrightVersion,
    },
    locale: environment.locale,
    timezone: environment.timezone,
    colorScheme: environment.colorScheme,
    reducedMotion: environment.reducedMotion,
    serverOrigin: normalizedServerOrigin(environment.serverOrigin),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export function canonicalCaptureFontDigests(
  fonts: ReadonlyArray<{
    family: string;
    digest?: string | undefined;
    source?: string | undefined;
  }>,
): Array<{ family: string; digest: `sha256:${string}` }> {
  const canonical = new Map<string, `sha256:${string}`>();
  for (const font of fonts) {
    if (font.digest === undefined) {
      throw provenanceError(`mapped font ${font.family} is missing its required digest`);
    }
    const digest = Sha256DigestSchema.safeParse(font.digest);
    if (!digest.success) {
      throw provenanceError(`mapped font ${font.family} has an invalid digest`);
    }
    const digestValue = digest.data as `sha256:${string}`;
    const existing = canonical.get(font.family);
    if (existing !== undefined && existing !== digestValue) {
      throw provenanceError(`mapped font ${font.family} has conflicting digests`);
    }
    canonical.set(font.family, digestValue);
  }
  return [...canonical]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, digest]) => ({ family, digest }));
}

export function canonicalCaptureAssetDigests(
  assets: ReadonlyArray<{ path: string; digest: string }>,
): Array<{ path: string; digest: `sha256:${string}` }> {
  const canonical = new Map<string, `sha256:${string}`>();
  for (const asset of assets) {
    const parsedPath = RelativePathSchema.safeParse(asset.path);
    const parsedDigest = Sha256DigestSchema.safeParse(asset.digest);
    if (!parsedPath.success || !parsedDigest.success) {
      throw provenanceError(`mapped asset ${asset.path} has an invalid path or digest`);
    }
    const digestValue = parsedDigest.data as `sha256:${string}`;
    const existing = canonical.get(parsedPath.data);
    if (existing !== undefined && existing !== digestValue) {
      throw provenanceError(`mapped asset ${parsedPath.data} has conflicting digests`);
    }
    canonical.set(parsedPath.data, digestValue);
  }
  return [...canonical]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetPath, digest]) => ({ path: assetPath, digest }));
}

export function assertCaptureReceipt(rawInput: {
  receipt: unknown;
  packet: ReceiptPacket;
  target: ReceiptTarget;
  actualDigest: string;
  fixtureDigest: string;
  actualPath?: string;
  expectedFonts?: Array<{ family: string; digest: string }>;
  expectedAssets?: Array<{ path: string; digest: string }>;
}): VisualCaptureReceiptV2 {
  const compatible = VisualCaptureReceiptSchema.safeParse(rawInput.receipt);
  if (!compatible.success) {
    throw provenanceError(compatible.error.issues.map((issue) => issue.message).join("; "));
  }
  if (!("schemaVersion" in compatible.data)) {
    throw new Error(
      "VISUAL_CAPTURE_RECEIPT_REACQUISITION_REQUIRED: historical v1 receipts are report-readable only; reacquire a strict v2 capture",
    );
  }
  const receipt = compatible.data;
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

  const serverOrigin = normalizedServerOrigin(receipt.environment.serverOrigin);
  const resolvedTargetRoute = new URL(rawInput.target.route, serverOrigin);
  const routeMatches =
    receipt.environment.serverOrigin === serverOrigin &&
    resolvedTargetRoute.origin === serverOrigin &&
    receipt.route === resolvedTargetRoute.toString();
  const expectedBitmapSize = {
    width: Math.round(rawInput.target.viewport.width * rawInput.target.deviceScaleFactor),
    height: Math.round(rawInput.target.viewport.height * rawInput.target.deviceScaleFactor),
  };
  const provenanceMatches =
    receipt.reviewPacketId === rawInput.packet.id &&
    receipt.headSha === rawInput.packet.headSha &&
    receipt.targetId === rawInput.target.targetId &&
    routeMatches &&
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

function normalizedServerOrigin(value: string): string {
  return new URL(value).origin;
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

function assertUniqueReceiptEntries(
  receipt: {
    fonts: Array<{ family: string }>;
    assets: Array<{ path: string }>;
  },
  context: z.RefinementCtx,
): void {
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
