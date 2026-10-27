/**
 * Which pages librocat may fetch itself (convex/fetching.ts, the reading list
 * and source watch): public http(s) pages only. Never this machine, a private
 * network, or a link-local address such as a cloud's metadata service. A
 * self-hosted librocat may allow private addresses with
 * LIBROCAT_FETCH_PRIVATE=1, for pages on its own network.
 *
 * Pure: the Node action checks each resolved address with it at connect time
 * too, so a name that resolves to a private address is refused as well.
 */

/** IPv4 dotted quad to its four numbers, or null. */
function v4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return n.every((x) => x <= 255) ? n : null;
}

function privateV4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && (b as number) >= 64 && (b as number) <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && (b as number) >= 16 && (b as number) <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a as number) >= 224 // multicast and reserved
  );
}

/** Whether an IP address is one librocat must not fetch from. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const four = v4(addr);
  if (four) return privateV4(four);
  if (!addr.includes(":")) return true; // not an address: refuse
  if (addr === "::" || addr === "::1") return true;
  // An IPv4 address inside IPv6 (::ffff:10.0.0.1, 64:ff9b::a00:1): judge the IPv4 part.
  const tail = addr.split(":").pop() ?? "";
  const dotted = v4(tail);
  if (dotted && (addr.startsWith("::ffff:") || addr.startsWith("64:ff9b:")))
    return privateV4(dotted);
  const mapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mapped) {
    const hi = Number.parseInt(mapped[1] as string, 16);
    const lo = Number.parseInt(mapped[2] as string, 16);
    return privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  }
  const first = Number.parseInt(addr.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local, fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local, fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x2001 && addr.startsWith("2001:db8:")) // documentation
  );
}

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|home\.arpa)$/i;

/**
 * A URL librocat may fetch, or an error that says why not: http(s) only, no
 * credentials in it, and no private address or local name unless allowed.
 */
export function checkFetchUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`"${raw}" is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`librocat fetches http and https pages only, not ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("a URL with a password in it is not fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error(`"${raw}" names no host`);
  if (!allowPrivate) {
    const literal = v4(host) || host.includes(":");
    if ((literal && isPrivateAddress(host)) || LOCAL_NAMES.test(host)) {
      throw new Error(`${host} is a private address: librocat fetches public pages only`);
    }
  }
  return url;
}

/** The big sites that refuse apps, by the name people know them by. */
const SITES: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "x.com": "X",
  "twitter.com": "X",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "tiktok.com": "TikTok",
};

/** A site as a person names it: "LinkedIn" for www.linkedin.com, else its host. */
export function siteName(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const [domain, name] of Object.entries(SITES)) {
    if (h === domain || h.endsWith(`.${domain}`)) return name;
  }
  return h;
}

/** Statuses a site answers an app it won't serve with (999 is LinkedIn's). */
const REFUSED = new Set([401, 403, 429, 451, 999]);

/**
 * Why a page couldn't be read, by the status its site answered, in words a
 * person and an agent can both act on.
 */
export function refusalMessage(host: string, status: number): string {
  const site = siteName(host);
  if (REFUSED.has(status)) {
    return (
      `${site} doesn't let apps read its pages. Save it another way: print it to a PDF and ` +
      "attach that, or have your agent read it in a browser and save its text."
    );
  }
  if (status === 404 || status === 410)
    return `${site} has no page at that address. Check the link.`;
  return `${site} isn't answering right now. Try again in a minute.`;
}

/** Why a site couldn't be reached at all: a name that doesn't exist, or no answer. */
export function unreachableMessage(host: string, code?: string): string {
  if (code === "ENOTFOUND") return `${siteName(host)} can't be found. Check the link.`;
  return `${siteName(host)} isn't answering right now. Try again in a minute.`;
}
