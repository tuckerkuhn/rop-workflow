import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

/**
 * Fetch a public https page for the app to read (a funding call's link), and nothing else: every
 * address the name resolves to is checked at the moment of connecting (so a name cannot point to
 * this network, or switch to it after a check), redirects are followed by hand and checked the same
 * way, and the body stops at `max` bytes instead of being read whole first.
 */

export class FetchRefused extends Error {}

/** Loopback, private, link-local (cloud metadata), shared, multicast and reserved addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("64:ff9b") || x.startsWith("2001:db8");
  }
  return true;
}

function checkUrl(u: URL) {
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost" || (u.port && u.port !== "443"))
    throw new FetchRefused("The link must be a public web address starting with https://.");
}

// Resolves the name and refuses it if any address is on a private network; the socket then uses
// exactly the checked address.
const safeLookup = ((hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return cb(Object.assign(new Error("private address"), { code: "EPRIVATE" }), "");
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as never;

export type Fetched = { status: number; type: string; body: Buffer; url: URL };

function once(u: URL, max: number, timeoutMs: number, headers: Record<string, string>): Promise<Fetched & { location: string | null }> {
  return new Promise((resolve, reject) => {
    const req = request(u, { method: "GET", lookup: safeLookup, headers, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const type = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, type, body: Buffer.alloc(0), url: u, location });
      }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > max) {
        res.destroy();
        return reject(new FetchRefused("too large"));
      }
      const parts: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > max) {
          res.destroy();
          reject(new FetchRefused("too large"));
        } else parts.push(c);
      });
      res.on("end", () => resolve({ status, type, body: Buffer.concat(parts), url: u, location: null }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EPRIVATE" ? new FetchRefused("The link must be a public web address starting with https://.") : e));
    req.end();
  });
}

/** Throws FetchRefused for a refused address or a body over `max`; other errors are network failures. */
export async function safeFetch(link: string, { max = 4_000_000, timeoutMs = 15_000, headers = {} as Record<string, string>, redirects = 5 } = {}): Promise<Fetched> {
  let u = new URL(link);
  for (let hop = 0; ; hop++) {
    checkUrl(u);
    const r = await once(u, max, timeoutMs, headers);
    if (!r.location) return r;
    if (hop >= redirects) throw new FetchRefused("Too many redirects.");
    u = new URL(r.location, u);
  }
}
