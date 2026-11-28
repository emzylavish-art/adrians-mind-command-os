import https from "node:https";
import { isIPv4 } from "node:net";
import { defaultDnsLookup, isPrivateAddressLiteral } from "../../src/lib/mind/mcp/http-dns-pin.ts";

function publicV4(address) {
  if (!isIPv4(address) || isPrivateAddressLiteral(address)) return false;
  const [a,b,c] = address.split(".").map(Number);
  return !(a === 192 && (b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113);
}

export async function resolveBrowserPin(host, lookup = defaultDnsLookup) {
  const addresses = await lookup(host);
  if (!addresses.length || addresses.some(ip => isPrivateAddressLiteral(ip))) throw new Error("Restricted website address");
  const pin = addresses.find(publicV4);
  if (!pin || addresses.filter(isIPv4).some(ip => !publicV4(ip))) throw new Error("A public IPv4 address is required");
  return pin;
}

export function readBrowserResource(url, pin, signal) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: pin, servername: url.hostname, path: url.pathname + url.search, method: "GET",
      agent: false, headers: { Host: url.hostname, Accept: "*/*", "Accept-Encoding": "identity" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    }, response => {
      const contentType = response.headers["content-type"] ?? "";
      const encodable = /^(text\/(html|css|plain)|image\/(jpeg|png|webp|gif|svg\+xml|avif|x-icon)|font\/(woff2?|ttf|otf))(?:[;\s]|$)/i.test(contentType);
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300 || !encodable || response.headers["content-encoding"]) {
        response.destroy();
        reject(new Error("Website resource unavailable"));
        return;
      }
      let size = 0;
      const parts = [];
      response.on("data", bytes => {
        size += bytes.length;
        if (size > 1_500_000) response.destroy(new Error("Website resource too large"));
        else parts.push(bytes);
      });
      response.once("aborted", () => reject(new Error("Website response interrupted")));
      response.once("error", reject);
      response.once("end", () => resolve({ contentType, body: Buffer.concat(parts) }));
    });
    request.once("error", reject);
    request.end();
  });
}
