/**
 * DNS resolve + pin for external HTTP MCP servers.
 * Refuse if ANY resolved address is private/loopback/link-local/ULA/metadata;
 * pin the TCP connection to a validated public IP so a later DNS answer cannot
 * swap in a private target (DNS rebinding).
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";


/** Hostnames that are always local by design (http allowed). */
export function isLocalHostname(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * True for private, loopback, link-local, CGNAT, unspecified, multicast and
 * IPv4-mapped literals. Hostnames that are not IP literals return false.
 */
export function isPrivateAddressLiteral(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes(".")) return isPrivateAddressLiteral(tail);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return isPrivateAddressLiteral([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
    return true;
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(host);
}


export type DnsLookupFn = (hostname: string) => Promise<string[]>;

export async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((row) => row.address);
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function isIpLiteralHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

export type ResolvePinResult =
  | { ok: true; hostname: string; pinnedAddress: string; addresses: string[] }
  | { ok: false; error: string };

/**
 * Resolve hostname and require every answer to be a public address.
 * Mixed public+private (classic rebinding dual answer) is refused.
 */
export async function resolveAndPinMcpHostname(
  hostname: string,
  lookup: DnsLookupFn = defaultDnsLookup,
): Promise<ResolvePinResult> {
  const host = stripBrackets(hostname);
  if (!host) return { ok: false, error: "The MCP hostname is empty." };

  if (isIpLiteralHostname(hostname)) {
    if (isPrivateAddressLiteral(hostname)) {
      return { ok: false, error: "Private, link-local and internal IP addresses are refused." };
    }
    return { ok: true, hostname: host, pinnedAddress: host, addresses: [host] };
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, error: "The MCP hostname could not be resolved." };
  }
  if (!addresses.length) {
    return { ok: false, error: "The MCP hostname could not be resolved." };
  }

  const safe: string[] = [];
  for (const address of addresses) {
    const normalized = stripBrackets(address).toLowerCase();
    if (isPrivateAddressLiteral(normalized) || isPrivateAddressLiteral(address)) {
      return {
        ok: false,
        error: "The MCP hostname resolved to a private, link-local, or internal address (DNS rebinding guard).",
      };
    }
    safe.push(normalized);
  }

  // Prefer IPv4 pin when dual-stack is all-public.
  const pinned = safe.find((addr) => !addr.includes(":")) ?? safe[0]!;
  return { ok: true, hostname: host, pinnedAddress: pinned, addresses: safe };
}

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
  body?: { getReader: () => ReadableStreamDefaultReader<Uint8Array> } | null;
};

/**
 * Fetch-like POST that connects to `pinnedAddress` while presenting `hostname`
 * for TLS SNI / Host. A custom `lookup` on the socket always returns the pin,
 * so a second DNS answer cannot redirect the TCP connection.
 */
export function pinnedHttpFetch(
  url: URL,
  pinnedAddress: string,
  hostname: string,
  init: RequestInit & { signal?: AbortSignal; streamResponse?: boolean } = {},
): Promise<FetchLikeResponse> {
  const lib = url.protocol === "https:" ? https : http;
  const path = `${url.pathname}${url.search}`;
  const headers: Record<string, string> = { host: hostname };
  const incoming = init.headers;
  if (incoming && typeof incoming === "object") {
    if (incoming instanceof Headers) {
      incoming.forEach((value, key) => {
        if (key.toLowerCase() !== "host") headers[key] = value;
      });
    } else if (Array.isArray(incoming)) {
      for (const [key, value] of incoming) {
        if (key.toLowerCase() !== "host") headers[key] = value;
      }
    } else {
      for (const [key, value] of Object.entries(incoming)) {
        if (key.toLowerCase() !== "host" && typeof value === "string") headers[key] = value;
      }
    }
  }

  const family = pinnedAddress.includes(":") ? 6 : 4;
  const pinnedLookup: NonNullable<https.RequestOptions["lookup"]> = (_host, _opts, cb) => {
    // Always return the validated pin — never re-resolve.
    (cb as (err: Error | null, address: string, family: number) => void)(null, pinnedAddress, family);
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: pinnedAddress,
        servername: hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        method: (init.method as string) || "GET",
        path,
        headers,
        lookup: pinnedLookup,
      },
      (res) => {
        const headerGet = (name: string) => {
          const value = res.headers[name.toLowerCase()];
          if (Array.isArray(value)) return value[0] ?? null;
          return value ?? null;
        };
        if (init.streamResponse && headerGet("content-type")?.includes("text/event-stream")) {
          // Preserve the validated socket pin while allowing model answer deltas
          // to arrive before upstream completion. Existing MCP callers retain
          // their buffered transport unless they explicitly select this mode.
          const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, headers: { get: headerGet }, body, text: () => new Response(body).text() });
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: headerGet },
            text: async () => buf.toString("utf8"),
            body: null,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error("aborted"));
        reject(new Error("aborted"));
        return;
      }
      init.signal.addEventListener(
        "abort",
        () => {
          req.destroy(new Error("aborted"));
        },
        { once: true },
      );
    }
    if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
      req.write(init.body);
    }
    req.end();
  });
}
