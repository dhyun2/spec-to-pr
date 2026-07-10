import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";
import { z } from "zod";

const DEFAULT_MAX_FILE_BYTES = 512_000;
const SCANNED_EXTENSIONS = new Set([
  ".vue",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "tmp",
  ".turbo",
]);

export const LegacyFeatureCategorySchema = z.enum([
  "netfunnel",
  "native-bridge",
  "query-param",
  "radius-expansion",
  "dialog-toast",
  "analytics",
  "reservation-routing",
  "url-open",
  "image-fallback",
  "resource-binding",
  "api-call",
  "event-bus",
  "permission",
  "global-style",
  "carousel-swipe",
]);

export const LegacyFeatureSchema = z
  .object({
    id: z.string().trim().min(1),
    category: LegacyFeatureCategorySchema,
    label: z.string().trim().min(1),
    file: z.string().trim().min(1),
    line: z.number().int().positive(),
    snippet: z.string().trim().min(1),
    keywords: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const LegacyFeatureInventorySchema = z
  .object({
    schemaVersion: z.literal("legacy-feature-inventory-v1"),
    legacyRoot: z.string().trim().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    scannedFileCount: z.number().int().nonnegative(),
    featureCount: z.number().int().nonnegative(),
    features: z.array(LegacyFeatureSchema),
  })
  .strict();

export type LegacyFeatureCategory = z.infer<typeof LegacyFeatureCategorySchema>;
export type LegacyFeature = z.infer<typeof LegacyFeatureSchema>;
export type LegacyFeatureInventory = z.infer<typeof LegacyFeatureInventorySchema>;

type SignalPattern = {
  category: LegacyFeatureCategory;
  label: string;
  keywords: string[];
  pattern: RegExp;
};

const SIGNAL_PATTERNS: SignalPattern[] = [
  {
    category: "netfunnel",
    label: "NetFunnel entry/complete/back handling",
    keywords: ["NetFunnel"],
    pattern: /\bNetFunnel(?:_Action)?\b|netfunnel/i,
  },
  {
    category: "native-bridge",
    label: "nativeBackPressed / web navigation bridge",
    keywords: ["nativeBackPressed", "hideWebNavBar", "native bridge"],
    pattern:
      /nativeBackPressed|hideWebNavBar|webkit\.messageHandlers|window\.(?:Android|GolfzonApp)|(?:Android|NativeBridge)\./i,
  },
  {
    category: "query-param",
    label: "initial route/query/hash parameter branch",
    keywords: ["rgnNo", "lat", "lng", "optFilter", "GDR", "userAgent"],
    pattern:
      /\b(rgnNo|lat|lng|optFilter|GDR|userAgent|route\.query|location\.search|location\.hash)\b/i,
  },
  {
    category: "radius-expansion",
    label: "radius expansion search branch",
    keywords: ["radius", "2.5", "3", "5"],
    pattern: /radius|2\.5\s*[,=>].*3\s*[,=>].*5|2\.5.*3.*5/i,
  },
  {
    category: "dialog-toast",
    label: "confirm dialog / toast branch",
    keywords: ["confirm", "toast", "alert"],
    pattern: /\b(confirm|alert)\s*\(|\$?toast|Toast|좀 더 넓은 위치 탐색/i,
  },
  {
    category: "analytics",
    label: "analytics tracking event",
    keywords: ["trackPV", "trackEvent", "analytics"],
    pattern: /\b(trackPV|trackEvent|gtag|analytics|amplitude)\b/i,
  },
  {
    category: "reservation-routing",
    label: "reservation URL branch",
    keywords: ["/booking/#", "/academy/#/grx/stores"],
    pattern: /\/academy\/#\/grx\/stores|\/booking\/#\//i,
  },
  {
    category: "url-open",
    label: "external URL/native map open",
    keywords: ["window.open", "location.href", "tel:", "kakaomap"],
    pattern:
      /window\.open|location\.href|location\.assign|tel:|kakaomap|naversearchapp|FindPath|findPath/i,
  },
  {
    category: "image-fallback",
    label: "image resize/fallback/error recovery",
    keywords: ["onerror", "resizeImage", "fallback"],
    pattern: /@error|onerror|onError|resizeImage|fallback\.(?:png|jpg|jpeg|webp)|imageFallback/i,
  },
  {
    category: "resource-binding",
    label: "legacy visual resource binding",
    keywords: ["logoImgUrl", "imgUrl", "shopImg", "markerOptions", "G PASS", "mapLevel"],
    pattern:
      /logoImgUrl|shopImg|imgUrl|imageUrl|getResizeImgUrl|resizeImgUrl|markerOptions|markerSprite|markerImage|default[A-Za-z0-9_]*Image|G\s*PASS|gpass|mapLevel|zoomLevel|\blevel\s*:/i,
  },
  {
    category: "api-call",
    label: "API call / request parameter behavior",
    keywords: ["axios", "fetch", "$http", "api"],
    pattern: /\b(axios|fetch|apiClient|\$http|\$axios)\b/i,
  },
  {
    category: "event-bus",
    label: "event bus listener/emitter",
    keywords: ["event bus", "$emit", "$on"],
    pattern: /\$emit\s*\(|\$on\s*\(|EventBus|eventBus/i,
  },
  {
    category: "permission",
    label: "permission or geolocation branch",
    keywords: ["permission", "geolocation", "권한"],
    pattern: /permission|geolocation|getCurrentPosition|위치\s*권한|권한\s*거부/i,
  },
  {
    category: "carousel-swipe",
    label: "carousel/swipe interaction branch",
    keywords: ["swiper", "slideChange", "activeIndex", "swipe"],
    pattern:
      /\b(?:Swiper|SwiperSlide|swiper|slideChange|slideNext|slidePrev|activeIndex|touchStart|touchMove|swipe)\b/i,
  },
];

const GLOBAL_STYLE_KEYWORDS = ["root CSS", "global CSS", "selector", "stylesheet"];

export async function scanLegacyFeatureInventory(input: {
  legacyRoot: string;
  includeGlobs?: string[];
  maxFileBytes?: number;
  generatedAt?: string;
}): Promise<LegacyFeatureInventory> {
  const legacyRoot = path.resolve(input.legacyRoot);
  const files = await collectCandidateFiles({
    root: legacyRoot,
    maxFileBytes: input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    ...(input.includeGlobs === undefined ? {} : { includeGlobs: input.includeGlobs }),
  });
  const features: LegacyFeature[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(legacyRoot, filePath).split(path.sep).join("/");
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const styleFile = STYLE_EXTENSIONS.has(path.extname(filePath));

    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();

      if (line.length === 0) {
        return;
      }

      if (styleFile && isGlobalStyleSelector(line)) {
        features.push(
          LegacyFeatureSchema.parse({
            id: featureId({
              category: "global-style",
              file: relativePath,
              line: index + 1,
              label: "root/global CSS selector affecting legacy UI",
              snippet: line,
            }),
            category: "global-style",
            label: labelWithMatch(
              "root/global CSS selector affecting legacy UI",
              cssSelector(line),
            ),
            file: relativePath,
            line: index + 1,
            snippet: line,
            keywords: GLOBAL_STYLE_KEYWORDS,
          }),
        );
      }

      for (const signal of SIGNAL_PATTERNS) {
        const match = signal.pattern.exec(line);

        if (match === null) {
          continue;
        }

        features.push(
          LegacyFeatureSchema.parse({
            id: featureId({
              category: signal.category,
              file: relativePath,
              line: index + 1,
              label: signal.label,
              snippet: line,
            }),
            category: signal.category,
            label: labelWithMatch(signal.label, match[0]),
            file: relativePath,
            line: index + 1,
            snippet: line,
            keywords: signal.keywords,
          }),
        );
      }
    });
  }

  const deduped = dedupeFeatures(features);

  return LegacyFeatureInventorySchema.parse({
    schemaVersion: "legacy-feature-inventory-v1",
    legacyRoot,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scannedFileCount: files.length,
    featureCount: deduped.length,
    features: deduped,
  });
}

async function collectCandidateFiles(input: {
  root: string;
  includeGlobs?: string[];
  maxFileBytes: number;
}): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || !SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }

      const relativePath = path.relative(input.root, absolutePath).split(path.sep).join("/");

      if (
        input.includeGlobs !== undefined &&
        !input.includeGlobs.some((glob) => minimatch(relativePath, glob)) &&
        !isRootGlobalStylePath(relativePath)
      ) {
        continue;
      }

      const metadata = await stat(absolutePath);

      if (metadata.size <= input.maxFileBytes) {
        files.push(absolutePath);
      }
    }
  }

  await visit(input.root);

  return files.sort((left, right) => left.localeCompare(right));
}

function isGlobalStyleSelector(line: string): boolean {
  const selector = cssSelector(line);

  if (selector.length === 0 || selector.startsWith("@")) {
    return false;
  }

  return /(^|[\s,>+~])(?:\.|#|:root\b|body\b|html\b|\*)/.test(selector);
}

function cssSelector(line: string): string {
  const braceIndex = line.indexOf("{");

  if (braceIndex === -1) {
    return "";
  }

  return line.slice(0, braceIndex).trim();
}

function isRootGlobalStylePath(relativePath: string): boolean {
  if (!STYLE_EXTENSIONS.has(path.extname(relativePath))) {
    return false;
  }

  const segments = relativePath.split("/");

  if (segments.length <= 2) {
    return true;
  }

  return segments.some(
    (segment, index) => ["css", "style", "styles"].includes(segment) && index <= 2,
  );
}

function featureId(input: {
  category: LegacyFeatureCategory;
  file: string;
  line: number;
  label: string;
  snippet: string;
}): string {
  const digest = createHash("sha256")
    .update([input.category, input.file, input.line, input.label, input.snippet].join("\0"))
    .digest("hex")
    .slice(0, 16);

  return `legacy_${digest}`;
}

function labelWithMatch(label: string, match: string): string {
  const normalized = match.trim();

  if (normalized.length === 0 || label.toLowerCase().includes(normalized.toLowerCase())) {
    return label;
  }

  return `${label}: ${normalized}`;
}

function dedupeFeatures(features: LegacyFeature[]): LegacyFeature[] {
  const byId = new Map<string, LegacyFeature>();

  for (const feature of features) {
    byId.set(feature.id, feature);
  }

  return [...byId.values()].sort((left, right) =>
    [left.file, String(left.line), left.category, left.label]
      .join("\0")
      .localeCompare([right.file, String(right.line), right.category, right.label].join("\0")),
  );
}
