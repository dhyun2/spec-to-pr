import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  extractPdfText,
  fetchOpenApiDocument,
  orderedConcurrentMap,
} from "../../src/source-ingestion/source-loader.js";
import {
  normalizePublicHttpsUrl,
  resolvePublicAddresses,
} from "../../src/source-ingestion/safe-https-client.js";

describe("source ingestion", () => {
  it("maps independent source loads in declaration order with at most four active", async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const inputs = Array.from({ length: 20 }, (_unused, index) => index);

    const pending = orderedConcurrentMap(inputs, 4, async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return `source-${input}`;
    });

    await vi.waitFor(() => expect(active).toBe(4));
    while (release.length > 0 || active > 0) {
      release.splice(0).forEach((resolve) => resolve());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await expect(pending).resolves.toEqual(inputs.map((input) => `source-${input}`));
    expect(maxActive).toBe(4);
  });

  it("extracts page-aware text from a real PDF instead of decoding binary bytes", async () => {
    const pdf = minimalTextPdf("Acceptance criterion: checkout submits once.");

    const extracted = await extractPdfText(pdf);

    expect(extracted.mediaType).toBe("application/pdf");
    expect(extracted.pages).toEqual([
      {
        page: 1,
        text: expect.stringContaining("checkout submits once"),
      },
    ]);
    expect(extracted.text).toContain("[Page 1]");
    expect(extracted.text).toContain("Acceptance criterion");
    expect(extracted.sha256).toBe("sha256:" + createHash("sha256").update(pdf).digest("hex"));
  });

  it("blocks image-only or empty PDFs instead of returning binary garbage", async () => {
    await expect(extractPdfText(minimalTextPdf(""))).rejects.toThrow(/PDF_TEXT_UNAVAILABLE/);
  });

  it("loads a bounded HTTPS OpenAPI document and pins its resolved URL and digest", async () => {
    const yaml = "openapi: 3.1.0\npaths: {}\n";
    const fetchImpl = vi.fn(
      async () =>
        new Response(yaml, {
          status: 200,
          headers: { "content-type": "application/yaml" },
        }),
    );

    const source = await fetchOpenApiDocument({
      url: "https://api.example.com/openapi.yaml",
      fetchImpl,
    });

    expect(source).toMatchObject({
      originalUrl: "https://api.example.com/openapi.yaml",
      resolvedUrl: "https://api.example.com/openapi.yaml",
      mediaType: "application/yaml",
      text: yaml,
      sha256: "sha256:" + createHash("sha256").update(yaml).digest("hex"),
    });
  });

  it("resolves a Swagger UI spec URL without treating HTML as OpenAPI", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<html><script>SwaggerUIBundle({ url: "/contracts/openapi.json" })</script></html>',
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response('{"openapi":"3.1.0","paths":{}}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const source = await fetchOpenApiDocument({
      url: "https://api.example.com/docs",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/contracts/openapi.json",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(source).toMatchObject({
      originalUrl: "https://api.example.com/docs",
      resolvedUrl: "https://api.example.com/contracts/openapi.json",
      mediaType: "application/json",
    });
  });

  it("rejects oversized, non-HTTPS, and non-spec responses", async () => {
    await expect(
      fetchOpenApiDocument({
        url: "http://api.example.com/openapi.yaml",
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow(/HTTPS/);

    await expect(
      fetchOpenApiDocument({
        url: "https://api.example.com/openapi.yaml",
        fetchImpl: vi.fn(
          async () =>
            new Response("openapi: 3.1.0", {
              headers: {
                "content-type": "application/yaml",
                "content-length": String(1024 * 1024 + 1),
              },
            }),
        ),
      }),
    ).rejects.toThrow(/1 MB/);

    await expect(
      fetchOpenApiDocument({
        url: "https://api.example.com/docs",
        fetchImpl: vi.fn(
          async () =>
            new Response("<html>No Swagger initializer</html>", {
              headers: { "content-type": "text/html" },
            }),
        ),
      }),
    ).rejects.toThrow(/Swagger UI.*spec URL/i);
  });

  it.each([
    "https://127.0.0.1/openapi.yaml",
    "https://2130706433/openapi.yaml",
    "https://[::1]/openapi.yaml",
    "https://[::ffff:127.0.0.1]/openapi.yaml",
  ])("rejects IP-literal OpenAPI destinations before transport: %s", (url) => {
    expect(() => normalizePublicHttpsUrl(url, "OpenAPI URL")).toThrow(
      /REMOTE_SOURCE_ADDRESS_BLOCKED/,
    );
  });

  it("normalizes public HTTPS URLs and returns only public DNS answers", async () => {
    expect(normalizePublicHttpsUrl("https://api.example.com/openapi.yaml", "OpenAPI URL")).toBe(
      "https://api.example.com/openapi.yaml",
    );
    await expect(
      resolvePublicAddresses("api.example.com", async () => [
        { address: "93.184.216.34", family: 4 as const },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
      ]),
    ).resolves.toHaveLength(2);
  });

  it("rejects an IP-literal URL even when a custom test transport is supplied", async () => {
    await expect(
      fetchOpenApiDocument({
        url: "https://127.0.0.1/internal/openapi.yaml",
        fetchImpl: vi.fn(async () =>
          Promise.resolve(
            new Response("openapi: 3.1.0\npaths: {}\n", {
              headers: { "content-type": "application/yaml" },
            }),
          ),
        ),
      }),
    ).rejects.toThrow(/REMOTE_SOURCE_ADDRESS_BLOCKED/);
  });

  it("fails closed when DNS contains any private or link-local answer", async () => {
    const resolver = async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "169.254.169.254", family: 4 as const },
    ];

    await expect(resolvePublicAddresses("api.example.com", resolver)).rejects.toThrow(
      /REMOTE_SOURCE_ADDRESS_BLOCKED/,
    );
  });

  it.each([
    "https://10.0.0.1/openapi.yaml",
    "https://100.64.0.1/openapi.yaml",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.1/openapi.yaml",
  ])("rejects redirects to blocked IP classes: %s", async (location) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));

    await expect(
      fetchOpenApiDocument({ url: "https://api.example.com/openapi.yaml", fetchImpl }),
    ).rejects.toThrow(/REMOTE_SOURCE_ADDRESS_BLOCKED/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a Swagger-discovered private spec URL", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(
          '<html><script>SwaggerUIBundle({ url: "https://127.0.0.1/openapi.json" })</script></html>',
          { headers: { "content-type": "text/html" } },
        ),
      ),
    );

    await expect(
      fetchOpenApiDocument({ url: "https://api.example.com/docs", fetchImpl }),
    ).rejects.toThrow(/REMOTE_SOURCE_ADDRESS_BLOCKED/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies one deadline across remote-source transport", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );

    await expect(
      fetchOpenApiDocument({
        url: "https://api.example.com/openapi.yaml",
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies the same deadline while a response body stalls", async () => {
    const body = new ReadableStream<Uint8Array>({ pull: async () => await new Promise(() => {}) });

    await expect(
      fetchOpenApiDocument({
        url: "https://api.example.com/openapi.yaml",
        fetchImpl: vi.fn(async () =>
          Promise.resolve(new Response(body, { headers: { "content-type": "application/yaml" } })),
        ),
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/deadline/);
  });

  it("aborts before a slow DNS resolution can open a connection", async () => {
    const signal = AbortSignal.timeout(5);
    await expect(
      resolvePublicAddresses(
        "api.example.com",
        async () => await new Promise<never>(() => {}),
        signal,
      ),
    ).rejects.toThrow();
  });

  it("rejects a chunked body that crosses the 1 MB limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(768 * 1024));
        controller.enqueue(new Uint8Array(512 * 1024));
        controller.close();
      },
    });

    await expect(
      fetchOpenApiDocument({
        url: "https://api.example.com/openapi.yaml",
        fetchImpl: vi.fn(async () =>
          Promise.resolve(new Response(body, { headers: { "content-type": "application/yaml" } })),
        ),
      }),
    ).rejects.toThrow(/1 MB/);
  });
});

function minimalTextPdf(text: string): Buffer {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = escaped === "" ? "" : "BT /F1 12 Tf 72 720 Td (" + escaped + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      String(Buffer.byteLength(stream, "latin1")) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += String(index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += "xref\n0 " + String(objects.length + 1) + "\n";
  body += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    body += String(offset).padStart(10, "0") + " 00000 n \n";
  });
  body += "trailer\n<< /Size " + String(objects.length + 1) + " /Root 1 0 R >>\n";
  body += "startxref\n" + String(xrefOffset) + "\n%%EOF\n";
  return Buffer.from(body, "latin1");
}
