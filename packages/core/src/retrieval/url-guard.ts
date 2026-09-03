import { lookup } from "node:dns/promises";
import net from "node:net";
import { RetrievalError } from "./errors.js";

/**
 * SSRF protection for outbound fetches (brief Section 11).
 *
 *  - only http/https
 *  - no credentials in the URL
 *  - when `blockPrivate` is set, the resolved IP(s) must all be public
 *
 * The batch command in Section 9 may point at `http://localhost:PORT/...`, so
 * `blockPrivate` is a config toggle rather than always-on. In production it is
 * on; the local-fixtures run turns it off explicitly.
 */

export interface UrlGuardOptions {
  blockPrivate: boolean;
  /** Injected in tests so we don't hit real DNS. */
  resolve?: (hostname: string) => Promise<string[]>;
}

const PRIVATE_V4 = [
  { net: "0.0.0.0", bits: 8 },
  { net: "10.0.0.0", bits: 8 },
  { net: "100.64.0.0", bits: 10 }, // carrier-grade NAT
  { net: "127.0.0.0", bits: 8 }, // loopback
  { net: "169.254.0.0", bits: 16 }, // link-local
  { net: "172.16.0.0", bits: 12 },
  { net: "192.0.0.0", bits: 24 },
  { net: "192.168.0.0", bits: 16 },
  { net: "198.18.0.0", bits: 15 }, // benchmarking
  { net: "255.255.255.255", bits: 32 },
];

function v4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inV4Range(ip: string, range: { net: string; bits: number }): boolean {
  const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(range.net) & mask);
}

export function isPrivateAddress(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return PRIVATE_V4.some((r) => inV4Range(ip, r));
  if (type === 6) {
    const addr = ip.toLowerCase();
    if (addr === "::1" || addr === "::") return true;
    if (addr.startsWith("fe80:") || addr.startsWith("fc") || addr.startsWith("fd")) return true;
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }
  return true; // not a literal IP -> caller must resolve first
}

export interface SafeUrl {
  url: URL;
  /** Resolved IPs, when a DNS check was performed. */
  addresses: string[];
}

export async function assertSafeUrl(input: string, opts: UrlGuardOptions): Promise<SafeUrl> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RetrievalError("INVALID_URL", input, `Not a valid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RetrievalError("INVALID_URL", input, `Unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new RetrievalError("INVALID_URL", input, "Credentials in URL are not allowed");
  }

  if (!opts.blockPrivate) return { url, addresses: [] };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new RetrievalError("BLOCKED_ADDRESS", input, `Refusing private address ${hostname}`);
    }
    return { url, addresses: [hostname] };
  }

  const resolver =
    opts.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));

  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new RetrievalError("NETWORK", input, `DNS lookup failed for ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new RetrievalError("NETWORK", input, `No addresses for ${hostname}`);
  }
  for (const addr of addresses) {
    if (isPrivateAddress(addr)) {
      throw new RetrievalError(
        "BLOCKED_ADDRESS",
        input,
        `${hostname} resolves to private address ${addr}`,
      );
    }
  }
  return { url, addresses };
}
