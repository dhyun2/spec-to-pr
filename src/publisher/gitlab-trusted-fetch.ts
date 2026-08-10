import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Builds an HTTPS fetch implementation which trusts the explicitly configured
 * private CA bundle. This is intentionally opt-in: disabling TLS verification
 * would make a self-hosted publication endpoint susceptible to interception.
 */
export function createGitLabTrustedFetch(
  caFile = process.env["SPEC_TO_PR_GITLAB_CA_FILE"],
): FetchLike {
  const normalizedCaFile = caFile?.trim();
  if (normalizedCaFile === undefined || normalizedCaFile.length === 0) return fetch;

  let certificateAuthority: Promise<Buffer> | undefined;
  const loadCertificateAuthority = () => {
    certificateAuthority ??= readFile(normalizedCaFile).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "unknown file error";
      throw new Error(`GITLAB_TLS_CA_LOAD_FAILED: ${normalizedCaFile}: ${detail}`);
    });
    return certificateAuthority;
  };

  return async (url, init) => {
    const request = new Request(url, init);
    const body = request.body === null ? undefined : Buffer.from(await request.arrayBuffer());
    const certificate = await loadCertificateAuthority();

    return new Promise<Response>((resolve, reject) => {
      const clientRequest = httpsRequest(
        new URL(request.url),
        {
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          ca: certificate,
          signal: request.signal,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          incoming.on("error", reject);
          incoming.on("end", () => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (value === undefined) continue;
              for (const item of Array.isArray(value) ? value : [value]) {
                headers.append(name, item);
              }
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: incoming.statusCode ?? 500,
                statusText: incoming.statusMessage ?? "",
                headers,
              }),
            );
          });
        },
      );

      clientRequest.on("error", reject);
      clientRequest.end(body);
    });
  };
}
