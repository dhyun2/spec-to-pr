import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizePublicHttpsUrl, safeHttpsFetch } from "./safe-https-client.js";

const MAX_REMOTE_SOURCE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

const PdfPageSchema = z
  .object({
    page: z.number().int().positive(),
    text: z.string().trim().min(1),
  })
  .strict();

export const ExtractedPdfSchema = z
  .object({
    mediaType: z.literal("application/pdf"),
    text: z.string().trim().min(1),
    pages: z.array(PdfPageSchema).min(1),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export const RemoteOpenApiSourceSchema = z
  .object({
    originalUrl: z.string().url(),
    resolvedUrl: z.string().url(),
    mediaType: z.string().trim().min(1),
    text: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export type ExtractedPdf = z.infer<typeof ExtractedPdfSchema>;
export type RemoteOpenApiSource = z.infer<typeof RemoteOpenApiSourceSchema>;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function orderedConcurrentMap<T, R>(
  inputs: readonly T[],
  maxConcurrency: number,
  operation: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }
  const results = new Array<R>(inputs.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(inputs[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, inputs.length) }, async () => worker()),
  );
  return results;
}

export async function extractPdfText(content: Buffer): Promise<ExtractedPdf> {
  installTextOnlyPdfGlobals();
  // pdfjs ships this runtime worker entry without a declaration file.
  // @ts-expect-error -- the side-effect import is required by the bundled Node runtime.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(content),
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;
    const pages: Array<z.infer<typeof PdfPageSchema>> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      if (text.length > 0) pages.push(PdfPageSchema.parse({ page: pageNumber, text }));
      page.cleanup();
    }

    if (pages.length === 0) {
      throw new Error(
        "PDF_TEXT_UNAVAILABLE: the PDF has no extractable text; provide page-aware OCR evidence",
      );
    }

    return ExtractedPdfSchema.parse({
      mediaType: "application/pdf",
      text: pages.map((page) => "[Page " + String(page.page) + "]\n" + page.text).join("\n\n"),
      pages,
      sha256: sha256(content),
    });
  } finally {
    await loadingTask.destroy();
  }
}

function installTextOnlyPdfGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    DOMMatrix?: typeof TextOnlyDOMMatrix;
    Path2D?: typeof TextOnlyPath2D;
  };
  globals.DOMMatrix ??= TextOnlyDOMMatrix;
  globals.Path2D ??= TextOnlyPath2D;
}

class TextOnlyDOMMatrix {
  public a = 1;
  public b = 0;
  public c = 0;
  public d = 1;
  public e = 0;
  public f = 0;

  public constructor(_values?: unknown) {}

  public preMultiplySelf(): this {
    return this;
  }

  public translate(): this {
    return this;
  }

  public scale(): this {
    return this;
  }

  public invertSelf(): this {
    return this;
  }

  public multiplySelf(): this {
    return this;
  }
}

class TextOnlyPath2D {
  public constructor(_path?: unknown) {}

  public addPath(): void {}

  public rect(): void {}
}

export async function fetchOpenApiDocument(input: {
  url: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<RemoteOpenApiSource> {
  const original = normalizePublicHttpsUrl(input.url, "OpenAPI URL");
  const fetchImpl = input.fetchImpl ?? safeHttpsFetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineAt = Date.now() + timeoutMs;
  const first = await fetchWithRedirects({
    url: original,
    fetchImpl,
    deadlineAt,
  });
  let resolved = first.url;
  let mediaType = normalizedMediaType(first.response.headers.get("content-type"));
  let content = await readBoundedBody(first.response, deadlineAt);

  if (mediaType === "text/html" || looksLikeHtml(content)) {
    const specReference = swaggerSpecReference(content.toString("utf8"));
    if (specReference === undefined) {
      throw new Error(
        "Swagger UI did not expose a spec URL; provide the direct OpenAPI JSON or YAML URL",
      );
    }
    resolved = normalizePublicHttpsUrl(
      new URL(specReference, resolved).toString(),
      "Resolved OpenAPI URL",
    );
    const second = await fetchWithRedirects({
      url: resolved,
      fetchImpl,
      deadlineAt,
    });
    resolved = second.url;
    mediaType = normalizedMediaType(second.response.headers.get("content-type"));
    content = await readBoundedBody(second.response, deadlineAt);
  }

  const text = content.toString("utf8");
  if (!isOpenApiMediaType(mediaType) || !looksLikeOpenApi(text)) {
    throw new Error("OpenAPI URL must return an OpenAPI or Swagger JSON/YAML document");
  }

  return RemoteOpenApiSourceSchema.parse({
    originalUrl: original,
    resolvedUrl: resolved,
    mediaType,
    text,
    sha256: sha256(content),
  });
}

async function fetchWithRedirects(input: {
  url: string;
  fetchImpl: FetchLike;
  deadlineAt: number;
}): Promise<{ url: string; response: Response }> {
  let current = input.url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    current = normalizePublicHttpsUrl(current, "OpenAPI URL");
    const remainingMs = input.deadlineAt - Date.now();
    if (remainingMs <= 0) throw new Error("OpenAPI URL exceeded the 15 second deadline");
    const response = await input.fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(remainingMs),
      headers: {
        accept:
          "application/vnd.oai.openapi+json, application/json, application/yaml, application/x-yaml, text/yaml, text/plain, text/html",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || redirect === MAX_REDIRECTS) {
        throw new Error("OpenAPI URL exceeded the redirect limit");
      }
      current = normalizePublicHttpsUrl(
        new URL(location, current).toString(),
        "Redirected OpenAPI URL",
      );
      continue;
    }
    if (!response.ok) {
      throw new Error("OpenAPI URL returned HTTP " + String(response.status));
    }
    return { url: current, response };
  }
  throw new Error("OpenAPI URL exceeded the redirect limit");
}

async function readBoundedBody(response: Response, deadlineAt: number): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_REMOTE_SOURCE_BYTES
  ) {
    throw new Error("OpenAPI response exceeds the 1 MB limit");
  }
  if (response.body === null) throw new Error("OpenAPI response body is empty");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      await reader.cancel();
      throw new Error("OpenAPI URL exceeded the 15 second deadline");
    }
    const result = await withDeadline(reader.read(), remainingMs, async () => {
      await reader.cancel();
    });
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_REMOTE_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("OpenAPI response exceeds the 1 MB limit");
    }
    chunks.push(Buffer.from(result.value));
  }
  if (total === 0) throw new Error("OpenAPI response body is empty");
  return Buffer.concat(chunks);
}

async function withDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
  onTimeout: () => Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("OpenAPI URL exceeded the 15 second deadline"));
          void onTimeout();
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizedMediaType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase();
}

function isOpenApiMediaType(value: string): boolean {
  return (
    value === "application/json" ||
    value === "application/yaml" ||
    value === "application/x-yaml" ||
    value === "application/vnd.oai.openapi+json" ||
    value === "application/vnd.oai.openapi" ||
    value === "text/yaml" ||
    value === "text/plain"
  );
}

function looksLikeHtml(content: Buffer): boolean {
  return /^\s*(?:<!doctype\s+html|<html|<script)/i.test(content.toString("utf8", 0, 256));
}

function looksLikeOpenApi(text: string): boolean {
  return /^\s*[{[]/.test(text)
    ? /["'](?:openapi|swagger)["']\s*:/.test(text)
    : /^\s*(?:openapi|swagger)\s*:/m.test(text);
}

function swaggerSpecReference(html: string): string | undefined {
  return (
    /\burl\s*:\s*["']([^"']+)["']/i.exec(html)?.[1] ??
    /["']url["']\s*:\s*["']([^"']+)["']/i.exec(html)?.[1]
  );
}

function sha256(content: Buffer): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}
