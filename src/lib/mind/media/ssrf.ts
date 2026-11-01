/**
 * Server-only SSRF hardening: classify IPs, resolve+pin hostnames, fetch without following redirects.
 * Injectable resolver enables DNS-rebinding harnesses in tests.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isSafeRemoteImageUrl } from "./harden.ts";

export type LookupFn = (hostname: string) => Promise<string[]>;

const DEFAULT_MAX_BYTES = 1_800_000; // align with MAX_DATA_URL_CHARS roughly for raw bytes

/** Parse hostname that is already an IPv4 literal, including decimal/octal/hex tricks. */
export function parseIpv4Literal(host: string): number[] | null {
  const h = host.trim().toLowerCase();
  if (!h) return null;
  // Dotted forms with hex (0x..) or octal (0..) or decimal
  if (h.includes(".")) {
    const parts = h.split(".");
    if (parts.length !== 4) return null;
    const octets: number[] = [];
    for (const part of parts) {
      let n: number;
      if (/^0x[0-9a-f]+$/i.test(part)) n = Number.parseInt(part.slice(2), 16);
      else if (/^0[0-7]+$/.test(part)) n = Number.parseInt(part, 8);
      else if (/^\d+$/.test(part)) n = Number.parseInt(part, 10);
      else return null;
      if (!Number.isFinite(n) || n < 0 || n > 255) return null;
      octets.push(n);
    }
    return octets;
  }
  // Single-number IPv4 (decimal/hex/octal)
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(h)) n = Number.parseInt(h.slice(2), 16);
  else if (/^0[0-7]+$/.test(h)) n = Number.parseInt(h, 8);
  else if (/^\d+$/.test(h)) n = Number.parseInt(h, 10);
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

export function isPrivateOrReservedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

export function normalizeIpString(address: string): string {
  return address.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

/** True when an address (v4, v6, v4-mapped v6) is unsafe for server-side fetch. */
export function isUnsafeResolvedAddress(address: string): boolean {
  const addr = normalizeIpString(address);
  if (!addr) return true;
  if (addr === "::" || addr === "::1" || addr === "0:0:0:0:0:0:0:0" || addr === "0:0:0:0:0:0:0:1") return true;
  // IPv4-mapped IPv6 ::ffff:a.b.c.d
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i) || addr.match(/^::ffff:([0-9a-f:]+)$/i);
  if (mapped) {
    const inner = mapped[1]!;
    if (inner.includes(".")) {
      const octets = parseIpv4Literal(inner);
      return !octets || isPrivateOrReservedIpv4(octets);
    }
  }
  if (addr.includes(":")) {
    // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8
    if (addr.startsWith("fc") || addr.startsWith("fd") || addr.startsWith("fe80") || addr.startsWith("ff")) return true;
    return false;
  }
  const octets = parseIpv4Literal(addr);
  if (octets) return isPrivateOrReservedIpv4(octets);
  // Hostnames must not be classified here — only resolved addresses.
  if (/[a-z]/i.test(addr)) return false;
  return true;
}

export async function defaultLookup(hostname: string): Promise<string[]> {
  const literal = parseIpv4Literal(hostname);
  if (literal) return [literal.join(".")];
  if (hostname.includes(":") || hostname === "localhost") {
    // Treat bare IPv6 / localhost without DNS
    if (hostname === "localhost") return ["127.0.0.1"];
    return [hostname];
  }
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((row) => row.address);
}

export type PinResult =
  | { ok: true; hostname: string; pinnedAddress: string; url: URL }
  | { ok: false; error: string };

export async function resolveAndPinUrl(raw: string, lookup: LookupFn = defaultLookup): Promise<PinResult> {
  if (!isSafeRemoteImageUrl(raw)) {
    return { ok: false, error: "Refusing to download that image URL (unsafe host or scheme)." };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Refusing to download that image URL (unsafe host or scheme)." };
  }
  // Literal IP in hostname
  const host = url.hostname;
  const literal = parseIpv4Literal(host);
  if (literal) {
    if (isPrivateOrReservedIpv4(literal)) {
      return { ok: false, error: "Refusing to download that image URL (resolved to a private address)." };
    }
    return { ok: true, hostname: host, pinnedAddress: literal.join("."), url };
  }
  if (host.includes(":") || isUnsafeResolvedAddress(host)) {
    return { ok: false, error: "Refusing to download that image URL (resolved to a private address)." };
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, error: "Could not resolve that image host." };
  }
  if (!addresses.length) return { ok: false, error: "Could not resolve that image host." };
  // Happy Eyeballs / dual-stack: validate EVERY answer. Mixed public+private is treated as rebinding.
  const safe: string[] = [];
  for (const address of addresses) {
    if (isUnsafeResolvedAddress(address)) {
      return { ok: false, error: "Refusing to download that image URL (resolved to a private address)." };
    }
    safe.push(normalizeIpString(address));
  }
  if (!safe.length) return { ok: false, error: "Refusing to download that image URL (resolved to a private address)." };
  // Prefer IPv4 when both families are present (stable pin for tests and simple agents).
  const pinned = safe.find((addr) => !addr.includes(":")) ?? safe[0]!;
  return { ok: true, hostname: host, pinnedAddress: pinned, url };
}

export async function fetchPinnedUrl(
  raw: string,
  options: { lookup?: LookupFn; maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ ok: true; bytes: Buffer; contentType: string } | { ok: false; error: string }> {
  const pinned = await resolveAndPinUrl(raw, options.lookup ?? defaultLookup);
  if (!pinned.ok) return pinned;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const { url, hostname, pinnedAddress } = pinned;
  const lib = url.protocol === "https:" ? https : http;
  const path = `${url.pathname}${url.search}`;

  return await new Promise((resolve) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: pinnedAddress,
        servername: hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        method: "GET",
        path,
        headers: { host: hostname, accept: "image/*,*/*;q=0.8" },
        timeout: timeoutMs,
        // Force connect to the pinned address even if Node tries to re-resolve.
        lookup: (_host, _opts, cb) => {
          const family = pinnedAddress.includes(":") ? 6 : 4;
          (cb as (err: Error | null, address: string, family: number) => void)(null, pinnedAddress, family);
        },
      },
      (res) => {
        // Redirects disabled — any 3xx is refusal (re-check would be required otherwise).
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          resolve({ ok: false, error: "Refusing to follow redirects when downloading images." });
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          resolve({ ok: false, error: `Downloading the generated image failed (HTTP ${res.statusCode || 0}).` });
          return;
        }
        const contentType = (res.headers["content-type"] || "image/jpeg").toString().split(";")[0]!.trim();
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            aborted = true;
            req.destroy();
            resolve({ ok: false, error: "Downloaded image exceeded the size cap." });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (aborted) return;
          resolve({ ok: true, bytes: Buffer.concat(chunks), contentType });
        });
        res.on("error", () => {
          if (!aborted) resolve({ ok: false, error: "Could not download the generated image URL." });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Downloading the generated image timed out." });
    });
    req.on("error", () => resolve({ ok: false, error: "Could not download the generated image URL." }));
    req.end();
  });
}
