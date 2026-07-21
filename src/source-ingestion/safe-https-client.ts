import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export type HostAddress = { address: string; family: 4 | 6 };
export type HostResolver = (hostname: string) => Promise<readonly HostAddress[]>;

const IPV4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV6_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const blockedIpv4Addresses = new BlockList();
for (const [network, prefix] of IPV4_BLOCKS) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of IPV6_BLOCKS) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export function normalizePublicHttpsUrl(rawUrl: string, label: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${label} must not contain embedded credentials`);
  }
  const hostname = unbracketedHostname(parsed.hostname);
  if (isIP(hostname) !== 0) {
    throw blockedAddress(`${label} must use a public DNS hostname`);
  }
  for (const name of parsed.searchParams.keys()) {
    if (/token|secret|password|credential|api[_-]?key|authorization/i.test(name)) {
      throw new Error(`${label} must not contain secret-shaped query parameters`);
    }
  }
  return parsed.toString();
}

export async function resolvePublicAddresses(
  hostname: string,
  resolver: HostResolver = defaultResolver,
  signal?: AbortSignal | null,
): Promise<readonly HostAddress[]> {
  const addresses = await raceWithAbort(resolver(hostname), signal);
  if (addresses.length === 0) throw blockedAddress(`DNS returned no addresses for ${hostname}`);
  for (const candidate of addresses) {
    const detectedFamily = isIP(candidate.address);
    if (detectedFamily !== candidate.family || isBlockedAddress(candidate)) {
      throw blockedAddress(`DNS returned a blocked address for ${hostname}`);
    }
  }
  return addresses;
}

export async function safeHttpsFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const rawUrl = input instanceof Request ? input.url : input.toString();
  const normalized = normalizePublicHttpsUrl(rawUrl, "OpenAPI URL");
  const url = new URL(normalized);
  const addresses = await resolvePublicAddresses(url.hostname, defaultResolver, init.signal);
  const selected = addresses[0]!;
  const headers = Object.fromEntries(new Headers(init.headers).entries());

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers,
        signal: init.signal ?? undefined,
        lookup: (_hostname, _options, callback) => {
          callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        const responseHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          responseHeaders.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
        }
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 500,
            ...(response.statusMessage === undefined ? {} : { statusText: response.statusMessage }),
            headers: responseHeaders,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function defaultResolver(hostname: string): Promise<readonly HostAddress[]> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((address) =>
    address.family === 4 || address.family === 6
      ? [{ address: address.address, family: address.family }]
      : [],
  );
}

function isBlockedAddress(candidate: HostAddress): boolean {
  return candidate.family === 4
    ? blockedIpv4Addresses.check(candidate.address, "ipv4")
    : blockedIpv6Addresses.check(candidate.address, "ipv6");
}

function unbracketedHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function blockedAddress(detail: string): Error {
  return new Error(`REMOTE_SOURCE_ADDRESS_BLOCKED: ${detail}`);
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (signal === undefined || signal === null) return await promise;
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
