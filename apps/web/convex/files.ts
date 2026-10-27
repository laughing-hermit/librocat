/**
 * Kept files, served by librocat itself, so no storage URL leaves Convex. A
 * file link is signed, lasts one to two hours, and counts the bytes it
 * serves against its library's file transfer a month as it serves them
 * (limits.ts): a link someone shares stops working when it expires, and
 * every byte fetched with it until then was counted. An HTTP action answers
 * at most 20 MiB, so a bigger file comes in parts, a link each, to join in
 * order.
 *
 *   GET <CONVEX_SITE_URL>/files/<token>/<name>   (http.ts)
 *
 * `get_source` (mcp.ts) and the dashboard's source page (sources.ts `read`)
 * hand links out, from mutations: a link's expiry needs the real clock.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  httpAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { takeTransfer, transferAllowance, transferLeft, waitFor } from "./limits";
import { hmac, sameToken } from "./signing";

/** The most one link serves: an HTTP action's response is at most 20 MiB. */
export const PART_BYTES = 16 * 1024 * 1024;
const HOUR = 3600;

/** What a link serves: bytes `start` to `end` of a library's stored file, until `exp` (seconds). */
export type FileLink = {
  workspaceId: string;
  storageId: string;
  start: number;
  end: number;
  exp: number;
};

/** A file's links: `download_url` for a file one link serves, else `download_parts`, in order. */
export type Links = { download_url?: string; download_parts?: string[] };
export type Link = (storageId: Id<"_storage">, name: string) => Promise<Links>;

/**
 * When a link made at `nowMs` expires, in seconds: the top of the hour after
 * next. It lasts one to two hours, and is the same URL all hour, so a
 * browser's cache keeps a picture it showed.
 */
export const linkExpiry = (nowMs: number) => (Math.floor(nowMs / 1000 / HOUR) + 2) * HOUR;

/** The byte spans a file of `size` is served in: the whole file, or parts of PART_BYTES. */
export function partsOf(size: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let start = 0; start < size; start += PART_BYTES) {
    spans.push([start, Math.min(size, start + PART_BYTES)]);
  }
  return spans;
}

const signed = (body: string) => `librocat file link ${body}`;

/** A link's token: what it serves, and until when, signed with `secret`. */
export async function signLink(link: FileLink, secret: string): Promise<string> {
  const body = [link.workspaceId, link.storageId, link.start, link.end, link.exp].join(".");
  return `${body}.${await hmac(secret, signed(body))}`;
}

/** What a token serves: "forged" unless `secret` signed it as it is, "expired" past its time. */
export async function readLink(
  token: string,
  secret: string,
  nowMs: number,
): Promise<FileLink | "forged" | "expired"> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return "forged";
  const body = token.slice(0, dot);
  if (!sameToken(token.slice(dot + 1), await hmac(secret, signed(body)))) return "forged";
  const fields = body.split(".");
  if (fields.length !== 5) return "forged";
  const [workspaceId = "", storageId = "", ...numbers] = fields;
  const [start = -1, end = -1, exp = -1] = numbers.map(Number);
  if (![start, end, exp].every(Number.isSafeInteger) || start < 0 || end <= start) return "forged";
  if (exp * 1000 <= nowMs) return "expired";
  return { workspaceId, storageId, start, end, exp };
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set on this Convex deployment");
  return s;
}

/** "07" of 12: a part's number, as wide as the count (two digits at least), so names sort. */
const numbered = (n: number, of: number) => String(n).padStart(Math.max(2, String(of).length), "0");

/**
 * Links to a library's files, for an agent or the dashboard. A file bigger
 * than what's left of the library's file transfer for now gets none, and
 * `capped()` says so; the link itself counts what it serves.
 */
export function linker(ctx: MutationCtx, ws: Doc<"workspaces">): Link & { capped: () => boolean } {
  const exp = linkExpiry(Date.now());
  const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
  const made = new Map<string, Promise<Links>>();
  let room: Promise<number | null> | undefined;
  let capped = false;
  const make = async (storageId: Id<"_storage">, name: string): Promise<Links> => {
    const meta = await ctx.db.system.get(storageId);
    if (!meta || meta.size <= 0) return {};
    room ??= transferLeft(ctx, ws).then((d) => (d ? d.left : null));
    const left = await room;
    if (left !== null && meta.size > left) {
      capped = true;
      return {};
    }
    const spans = partsOf(meta.size);
    const urls = await Promise.all(
      spans.map(async ([start, end], i) => {
        const token = await signLink({ workspaceId: ws._id, storageId, start, end, exp }, secret());
        const file =
          spans.length === 1
            ? name
            : `${name}.part-${numbered(i + 1, spans.length)}-of-${numbered(spans.length, spans.length)}`;
        return `${site}/files/${token}/${encodeURIComponent(file)}`;
      }),
    );
    const [only] = urls;
    return urls.length === 1 && only ? { download_url: only } : { download_parts: urls };
  };
  const link: Link = (storageId, name) => {
    const key = `${storageId}/${name}`;
    let links = made.get(key);
    if (!links) {
      links = make(storageId, name);
      made.set(key, links);
    }
    return links;
  };
  return Object.assign(link, { capped: () => capped });
}

/**
 * Why a library's files can't move for now: no file links, a link that won't
 * serve, or a file that can't be attached (`retryAfter`, ms, when known).
 */
export function transferUsed(ws: Doc<"workspaces">, retryAfter?: number): string {
  const gb = Math.round(transferAllowance(ws.plan) / 1_000_000_000);
  // A Team's libraries share its month (teamCover.ts poolKey).
  const team = ws.plan === "team";
  return (
    `${team ? "This library's Team" : "This library"} has used its file transfer for now ` +
    `(${gb} GB a month of files downloaded or attached${team ? ", shared by its libraries" : ""}, ` +
    "refilled day by day)" +
    (retryAfter === undefined
      ? ": the text is here, without file links, which come back as the allowance refills."
      : `: more comes back in ${waitFor(retryAfter)}.`) +
    (ws.plan === "team" ? "" : " A bigger plan allows more: see the Billing page.")
  );
}

/** Count a link's bytes against its library's file transfer, before they're served. */
export const take = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    start: v.number(),
    end: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal(404) }),
    v.object({ status: v.literal(429), message: v.string(), retryAfter: v.number() }),
    v.object({ status: v.literal(200), size: v.number(), contentType: v.string() }),
  ),
  handler: async (ctx, { workspaceId, storageId, start, end }) => {
    const ws = await ctx.db.get(workspaceId);
    const meta = await ctx.db.system.get(storageId);
    if (!ws || !meta || end > meta.size) return { status: 404 as const };
    const taken = await takeTransfer(ctx, ws, end - start);
    if (!taken.ok) {
      const retryAfter = taken.retryAfter ?? 0;
      return { status: 429 as const, message: transferUsed(ws, retryAfter), retryAfter };
    }
    return {
      status: 200 as const,
      size: meta.size,
      contentType: meta.contentType ?? "application/octet-stream",
    };
  },
});

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...headers,
    },
  });

/** Save-as for a link's name: printable, 200 characters at most, with an ASCII fallback. */
function disposition(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it strips
  const clean = name.replace(/[\u0000-\u001f\u007f"\\/]/g, "_").slice(0, 200) || "file";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** A link's bytes, streamed: the whole file, or a part read by its range alone. */
async function bytesOf(ctx: ActionCtx, link: FileLink, size: number) {
  const id = link.storageId as Id<"_storage">;
  if (link.start === 0 && link.end === size) return await ctx.storage.get(id);
  const url = await ctx.storage.getUrl(id);
  if (!url) return null;
  const res = await fetch(url, { headers: { Range: `bytes=${link.start}-${link.end - 1}` } });
  if (res.status === 206 && res.body) return res.body;
  await res.body?.cancel();
  // A storage that ignores ranges (an older self-hosted backend): read up to the part.
  return (await ctx.storage.get(id))?.slice(link.start, link.end) ?? null;
}

/** GET /files/<token>/<name>: a file link (http.ts). */
export const serve = httpAction(async (ctx, req) => {
  const [token = "", rawName = ""] = new URL(req.url).pathname.slice("/files/".length).split("/");
  const link = await readLink(token, secret(), Date.now());
  if (link === "forged") return text(403, "This isn't a librocat file link.");
  if (link === "expired") {
    return text(410, "This file link expired: get_source hands out a new one.");
  }
  const taken = await ctx.runMutation(internal.files.take, {
    workspaceId: link.workspaceId as Id<"workspaces">,
    storageId: link.storageId as Id<"_storage">,
    start: link.start,
    end: link.end,
  });
  const gone = "This file is gone: it was deleted, or replaced by a newer copy.";
  if (taken.status === 404) return text(404, gone);
  if (taken.status === 429) {
    return text(429, taken.message, {
      "Retry-After": String(Math.max(1, Math.ceil(taken.retryAfter / 1000))),
    });
  }
  const body = await bytesOf(ctx, link, taken.size);
  if (!body) return text(404, gone);
  let name = "file";
  try {
    name = decodeURIComponent(rawName) || name;
  } catch {
    // A name that doesn't decode: the default.
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": taken.contentType,
      "Content-Length": String(link.end - link.start),
      "Content-Disposition": disposition(name),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": `private, max-age=${Math.max(0, link.exp - Math.floor(Date.now() / 1000))}`,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Disposition",
    },
  });
});
