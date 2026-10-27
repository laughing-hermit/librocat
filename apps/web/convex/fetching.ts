"use node";

/**
 * The only pages librocat fetches itself, on paid plans (and self-hosted):
 * - the reading list: a link saved on the dashboard, or `add_source` with a
 *   URL and no text, is fetched once and kept as a source (convex/sources.ts);
 * - source watch: in Libro's weekly review, the kept pages that concepts cite
 *   are fetched again; when a page's text changed, the copy is replaced, Jev
 *   reads what changed, and the citing concepts it affects come up for review
 *   (all of them when Jev can't be asked).
 * Everything else an agent reads, it reads itself.
 *
 * Public pages only (convex/fetchGuard.ts): the URL is checked, and every
 * address a name resolves to is checked at connect time, redirects included,
 * so a public name pointing at a private address is refused too. At most
 * 10 s and 5 MB a page. A link to a file librocat keeps (a PDF, an Office
 * file, a picture) is kept as that file, as if it were attached: at most
 * 30 s and 50 MB (the plan's file limit, if smaller).
 */

import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import type * as net from "node:net";
import { accepted, htmlToText, mimeOf, refusal } from "@librocat/core/sources";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { surfaced } from "./errors";
import {
  checkFetchUrl,
  isPrivateAddress,
  refusalMessage,
  siteName,
  unreachableMessage,
} from "./fetchGuard";
import { changeAffects } from "./libro";
import { READ_ONLY } from "./membership";
import { maxFileBytes, paidFeatures } from "./model";

const TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 5_000_000;
/** A linked file: longer to download, and at most this big, whatever the plan allows. */
const FILE_TIMEOUT_MS = 30_000;
const MAX_LINKED_FILE_BYTES = 50_000_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "librocat (+https://librocat.com)";

const allowPrivate = () => process.env.LIBROCAT_FETCH_PRIVATE === "1";

/** dns.lookup, refusing any private address a name resolves to. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const bad = allowPrivate() ? undefined : addresses.find((a) => isPrivateAddress(a.address));
    if (bad) {
      return callback(
        new Error(`${hostname} resolves to a private address: librocat fetches public pages only`),
        "",
        4,
      );
    }
    if ((options as { all?: boolean }).all) {
      return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    }
    const first = addresses[0];
    if (!first) return callback(new Error(`${hostname} has no address`), "", 4);
    callback(null, first.address, first.family);
  });
};

type Fetched = { url: URL; type: string; body: Buffer };

/** A page's type: HTML or text (or none said), which librocat reads as a page. */
const isPage = (type: string) => !type || type.includes("html") || type.startsWith("text/");

/** A linked file's name: the URL's last segment, else the site's name. */
const fileNameOf = (url: URL) => {
  const last = decodeURIComponent(url.pathname.split("/").pop() ?? "").trim();
  return last || url.hostname;
};

/** A network error in a person's words: a name that doesn't exist, or a site that won't answer. */
const reachable = (url: URL, err: Error & { code?: string }) =>
  ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"].includes(
    err.code ?? "",
  )
    ? new Error(unreachableMessage(url.hostname, err.code))
    : err;

/**
 * GET a public URL, following a few redirects. A page is read up to 5 MB;
 * a file librocat keeps, up to `fileCap` bytes (0: pages only). A file it
 * doesn't keep is refused before its bytes come down.
 */
function get(url: URL, redirects: number, deadline: number, fileCap = 0): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9,*/*;q=0.1",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("the page redirects too often"));
          try {
            const next = checkFetchUrl(
              new URL(res.headers.location, url).toString(),
              allowPrivate(),
            );
            resolve(get(next, redirects + 1, deadline, fileCap));
          } catch (exc) {
            reject(exc);
          }
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(refusalMessage(url.hostname, status)));
        }
        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        if (!isPage(type) && fileCap > 0 && !accepted(mimeOf(fileNameOf(url), type))) {
          res.resume();
          return reject(new Error(refusal(mimeOf(fileNameOf(url), type))));
        }
        const cap = isPage(type) || fileCap === 0 ? MAX_PAGE_BYTES : fileCap;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > cap) {
            const mb = Math.round(cap / 1_000_000);
            req.destroy(
              new Error(
                isPage(type) || fileCap === 0
                  ? `the page is over ${mb} MB`
                  : `the file is over ${mb} MB, the most librocat keeps from a link: download it and attach it`,
              ),
            );
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ url, type, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error(unreachableMessage(url.hostname))),
      Math.max(0, deadline - Date.now()),
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", (err) => reject(reachable(url, err)));
    req.end();
  });
}

/** A link's content: a page's title and text, or a file librocat keeps. */
type Link =
  | { page: { title: string; text: string; kind: string } }
  | { file: { bytes: Buffer; mime: string; name: string } };

/** The page's title and readable text. */
function pageOf({ url, type, body: bytes }: Fetched) {
  const body = bytes.toString("utf8");
  if (type.includes("html") || /^\s*<(!doctype html|html)/i.test(body)) {
    const { title, text } = htmlToText(body);
    return { title: title ?? url.toString(), text, kind: "html" };
  }
  const heading = /^#{1,3}[ \t]+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    title: heading || url.toString(),
    text: body,
    kind: type.includes("markdown") ? "md" : "txt",
  };
}

/**
 * A public link: a page (HTML or text), or, with `fileCap`, a file librocat
 * keeps (a PDF, an Office file, a picture), its bytes to store as if attached.
 */
export async function fetchLink(raw: string, fileCap: number): Promise<Link> {
  const url = checkFetchUrl(raw, allowPrivate());
  const timeout = fileCap > 0 ? FILE_TIMEOUT_MS : TIMEOUT_MS;
  const got = await get(url, 0, Date.now() + timeout, fileCap);
  const looksHtml = /^\s*<(!doctype html|html)/i.test(got.body.subarray(0, 512).toString("utf8"));
  if (isPage(got.type) || looksHtml) return { page: pageOf(got) };
  if (fileCap === 0) {
    throw new Error(
      `${siteName(url.hostname)} sent a ${got.type.split(";")[0]} file, not a page: ` +
        "librocat keeps the text of web pages from a link here",
    );
  }
  const name = fileNameOf(got.url);
  return { file: { bytes: got.body, mime: mimeOf(name, got.type), name } };
}

/** A public page's title and readable text (source watch: pages only). */
export async function fetchPage(raw: string) {
  const link = await fetchLink(raw, 0);
  if ("page" in link) return link.page;
  throw new Error("not a page");
}

/** The most a link's file may be on `plan`: its file limit, and never over 50 MB. */
const linkedFileCap = (plan: Parameters<typeof maxFileBytes>[0]) =>
  Math.min(maxFileBytes(plan), MAX_LINKED_FILE_BYTES);

const PAID_ONLY =
  "librocat fetches pages for you on paid plans. On Free, fetch the page yourself and " +
  "pass its text to `add_source` with the URL as `location`.";

/** `add_source` with a URL and no text: fetch the page and keep it (the reading list). */
export const addSourceFromUrl = action({
  args: {
    library: v.optional(v.string()),
    location: v.string(),
    title: v.optional(v.string()),
    id: v.optional(v.string()),
  },
  handler: async (ctx, { library, location, title, id }): Promise<unknown> =>
    surfaced(async () => {
      const scope = await ctx.runQuery(internal.mcp.searchScope, { library });
      // Before anything is counted, fetched, or stored.
      if (!scope.canWrite) throw new ConvexError(READ_ONLY);
      if (!paidFeatures(scope.plan)) throw new ConvexError(PAID_ONLY);
      // Counted before the fetch: a library past its ceilings fetches nothing.
      await ctx.runMutation(api.mcp.meter, { ...(library ? { library } : {}), writes: 1 });
      const link = await fetchLink(location, linkedFileCap(scope.plan));
      if ("file" in link) {
        // A linked file is kept as the file, as if the agent had uploaded it.
        const { bytes, mime, name } = link.file;
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(bytes)], { type: mime }),
        );
        return await ctx.runMutation(internal.mcp.addFetched, {
          ...(library ? { library } : {}),
          title: title?.trim() || name,
          location,
          storageId,
          filename: name,
          ...(id ? { id } : {}),
        });
      }
      const page = link.page;
      return await ctx.runMutation(internal.mcp.addFetched, {
        ...(library ? { library } : {}),
        title: title?.trim() || page.title,
        text: page.text,
        location,
        kind: page.kind,
        ...(id ? { id } : {}),
      });
    }),
});

/** The dashboard's "Save a link": the same, for the library the dashboard shows. */
export const saveLink = action({
  args: { url: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, { url, title }): Promise<unknown> =>
    surfaced(async () => {
      const plan = await ctx.runQuery(api.sources.plan, {});
      if (!paidFeatures(plan)) throw new ConvexError(PAID_ONLY);
      // Counted before the fetch: a library past its ceilings fetches nothing.
      await ctx.runMutation(internal.sources.countSave, {});
      const link = await fetchLink(url, linkedFileCap(plan));
      if ("file" in link) {
        // A link to a PDF, an Office file, or a picture: kept as that file, as if attached.
        const { bytes, mime, name } = link.file;
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(bytes)], { type: mime }),
        );
        return await ctx.runMutation(internal.sources.saveFile, {
          storageId,
          name,
          location: url,
          ...(title?.trim() ? { title: title.trim() } : {}),
        });
      }
      const page = link.page;
      return await ctx.runMutation(internal.sources.save, {
        title: title?.trim() || page.title,
        text: page.text,
        location: url,
        kind: page.kind,
      });
    }),
});

/** What one watch did: pages checked, changed, failed; concepts put up for review, or judged unaffected. */
type WatchSummary = {
  checked: number;
  changed: number;
  failed: number;
  reviewed: number;
  unaffected: number;
  fallback: number;
};

/**
 * Source watch, from Libro's review on paid plans: fetch again the kept
 * pages that concepts cite and weren't checked in a week (`force`: all of
 * them, for tests). A changed page replaces its copy, and Jev, in one typed
 * request a page, reads what changed against each citing concept's catalog
 * record: only the ones it judges affected (AFFECTED) come up for review.
 * When Jev can't be asked (an outage, or no Jev on a self-hosted librocat),
 * every citing concept comes up, as it did before Jev judged.
 */
export const watch = internalAction({
  args: { workspaceId: v.id("workspaces"), force: v.optional(v.boolean()) },
  handler: async (ctx, { workspaceId, force }): Promise<WatchSummary> => {
    const due = await ctx.runQuery(internal.sources.watchDue, { workspaceId, force });
    let changed = 0;
    let failed = 0;
    let reviewed = 0;
    let unaffected = 0;
    // Pages whose change Jev could not judge: all their citers came up.
    let fallback = 0;
    for (const s of due) {
      try {
        const page = await fetchPage(s.location);
        const r = await ctx.runMutation(internal.sources.applyWatch, {
          workspaceId,
          sid: s.sid,
          text: page.text,
        });
        if (!r.changed) continue;
        changed++;
        const plan = await ctx.runQuery(internal.workspaces.planOf, { workspaceId });
        const judged = await changeAffects(r.page, r.change, r.citing, plan);
        if (judged === null) fallback++;
        else unaffected += judged.filter((j) => !j.affected).length;
        const out = await ctx.runMutation(internal.sources.reviewWatched, {
          workspaceId,
          sid: s.sid,
          judged: (judged ?? []).map((j) => j.id),
          affected: (judged ?? []).filter((j) => j.affected).map(({ id, p }) => ({ id, p })),
        });
        reviewed += out.marked;
      } catch (exc) {
        failed++;
        await ctx.runMutation(internal.sources.markChecked, {
          workspaceId,
          sid: s.sid,
          error: exc instanceof Error ? exc.message : String(exc),
        });
      }
    }
    const summary: WatchSummary = {
      checked: due.length,
      changed,
      failed,
      reviewed,
      unaffected,
      fallback,
    };
    console.log(JSON.stringify({ sourceWatch: { workspaceId, ...summary } }));
    return summary;
  },
});
