/**
 * Source copies: the text of a document, page, or transcript an agent read,
 * kept beside the concepts written from it (Karpathy's LLM wiki keeps its
 * raw sources the same way). Concepts are what agents search; a kept source
 * is what they quote from when a summary isn't enough, and what a teammate's
 * agent reads when the original sits on someone else's laptop.
 *
 * - The text arrives from the `add_source` tool, for text an agent already
 *   has, or from a dashboard import.
 * - A file can come with it, or instead (convex/attachments.ts): the
 *   dashboard or `add_source` with `file` get an upload URL, and
 *   the file goes straight to Convex storage. Code reads its text where it
 *   has one; a picture is kept as it is. No model reads it.
 * - It is split into parts of about a page (`sourceParts`), searched for
 *   passages by words, and found by its title too, so a picture or a scan
 *   with no text is found (`sourceHits`). Storage is capped per plan
 *   (SOURCE_BYTES in model.ts).
 * - A concept cites a copy in its OKF `sources` by the copy's URL, or as
 *   `source:<sid>`. When a kept copy's text changes, the concepts that cite
 *   it come up for review, the way `files_changed` does for code.
 */

import { markSources, stemQuery } from "@librocat/core/format";
import {
  accepted,
  checkSourceId,
  deriveSourceId,
  type FileKind,
  fileKind,
  findSecretLine,
  hashText,
  isUrl,
  MAX_SOURCE_BYTES,
  mimeOf,
  normalizeCite,
  normalizeText,
  previewable,
  refusal,
  refusalKind,
  sourceCite,
  splitParts,
  utf8Bytes,
} from "@librocat/core/sources";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { surfaced } from "./errors";
import { scheduleFileCatalog } from "./fileCatalog";
import { type Link, linker, transferUsed } from "./files";
import { authUserId } from "./identity";
import { type Change, changeSummary, WATCH_JUDGED, type WatchConcept } from "./libro";
import { limitCalls, takeTransfer, transferLeft } from "./limits";
import { metered } from "./metered";
import * as model from "./model";
import { requireWorkspace, requireWritableWorkspace } from "./workspaces";

export const KINDS = [
  "md",
  "txt",
  "html",
  "pdf",
  "docx",
  "document",
  "sheet",
  "slides",
  "transcript",
  "image",
  "file",
  "other",
] as const;

export interface SourceInput {
  title: string;
  text: string;
  /** Where the original lives: a URL, or a path. */
  location?: string;
  kind?: string;
  /** Replace this kept source (its id), or give a new one this id. */
  id?: string;
}

const mb = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`;

/** How a source's text was made, from its kind if known, else from where it came from. */
function kindOf(kind: string | undefined, location: string | undefined): string {
  if (kind && (KINDS as readonly string[]).includes(kind)) return kind;
  const ext = location?.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1];
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "pdf" || ext === "docx") return ext;
  if (ext === "odt" || ext === "rtf" || ext === "epub") return "document";
  if (ext === "xlsx" || ext === "xlsm" || ext === "ods") return "sheet";
  if (ext === "pptx" || ext === "odp") return "slides";
  if (ext === "vtt" || ext === "srt") return "transcript";
  if (ext === "txt") return "txt";
  if (ext === "html" || ext === "htm" || (location && isUrl(location))) return "html";
  return "other";
}

export function describe(src: Doc<"sources">) {
  return {
    id: src.sid,
    cite: sourceCite(src),
    title: src.title,
    ...(src.location ? { location: src.location } : {}),
    kind: src.kind,
    bytes: src.bytes,
    parts: src.parts,
    ...(src.storageId
      ? {
          file: {
            name: src.filename ?? src.title,
            mime: src.mime ?? "application/octet-stream",
            bytes: src.fileBytes ?? 0,
          },
          status: src.status ?? "ready",
        }
      : {}),
    ...(src.error ? { note: src.error } : {}),
    // What Jev picked when it read a person's file (fileCatalog.ts).
    ...(src.description ? { description: src.description } : {}),
    ...(src.tags?.length ? { tags: src.tags } : {}),
    updated_at: src.updatedAt,
  };
}

const bySid = (ctx: QueryCtx, ws: Id<"workspaces">, sid: string) =>
  ctx.db
    .query("sources")
    .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws).eq("sid", sid))
    .unique();

/** A free id: the derived one, or it with -2, -3, ... when another source holds it. */
async function freeSid(ctx: QueryCtx, ws: Id<"workspaces">, sid: string): Promise<string> {
  if (!(await bySid(ctx, ws, sid))) return sid;
  let n = 2;
  while (await bySid(ctx, ws, `${sid}-${n}`)) n += 1;
  return `${sid}-${n}`;
}

/** A source's text parts (its file's parts stay). */
async function deleteParts(ctx: MutationCtx, sourceId: Id<"sources">) {
  const parts = await ctx.db
    .query("sourceParts")
    .withIndex("by_source_n", (q) => q.eq("sourceId", sourceId))
    .collect();
  for (const p of parts) if (!p.media) await ctx.db.delete(p._id);
}

/** The strings a concept may cite a kept source by. */
const citesOf = (src: Doc<"sources">) => new Set(model.citesOfSource(src));

/**
 * Keep a source's text. The same text again returns the kept copy. An
 * explicit `id` that exists, or the URL of a kept copy, replaces that copy;
 * if its text changed, every concept that cites it comes up for review,
 * unless `review` is false (the source watch, which asks Jev which first).
 */
export async function addSource(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  input: SourceInput,
  by: model.Writer,
  { review = true }: { review?: boolean } = {},
) {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new Error("a source needs a title");
  const text = normalizeText(input.text);
  if (!text) throw new Error("a source needs its text");
  const bytes = utf8Bytes(text);
  if (bytes > MAX_SOURCE_BYTES) {
    throw new Error(
      `this source is ${mb(bytes)} of text, and one source holds at most ` +
        `${mb(MAX_SOURCE_BYTES)} (about 1,000 pages): split it, or keep the parts your ` +
        "concepts draw on.",
    );
  }
  const secret = findSecretLine(text);
  if (secret) {
    throw new Error(
      `${secret.line ? `line ${secret.line}` : "the text"} looks like ${secret.label}: ` +
        "librocat never stores secrets. Take it out of the text and add the source again.",
    );
  }
  const raw = input.location?.trim();
  const location = raw ? (isUrl(raw) ? normalizeCite(raw) : raw.slice(0, 500)) : undefined;
  const hash = hashText(text);
  const explicit = input.id ? checkSourceId(input.id) : undefined;

  // What this replaces: the copy with this id, else the copy of this URL.
  let target = explicit ? await bySid(ctx, ws._id, explicit) : null;
  if (!target && !explicit && location && isUrl(location)) {
    target = await ctx.db
      .query("sources")
      .withIndex("by_workspace_location", (q) =>
        q.eq("workspaceId", ws._id).eq("location", location),
      )
      .order("desc")
      .first();
  }
  if (!target && !explicit) {
    const same = await ctx.db
      .query("sources")
      .withIndex("by_workspace_hash", (q) => q.eq("workspaceId", ws._id).eq("hash", hash))
      .first();
    if (same) return { ...describe(same), existing: true };
  }
  if (target && target.hash === hash) return { ...describe(target), existing: true };

  const used = ws.sourceBytes ?? 0;
  const after = used - (target?.bytes ?? 0) + bytes;
  // On a Team, its libraries share the plan's storage and text (model.ts roomOf).
  const room = await model.roomOf(ctx, ws);
  if (after > room.bytes) {
    throw new Error(
      `source text quota reached: this library keeps ${mb(used)} of ${mb(room.bytes)}` +
        `${model.sharedNote(room, mb(model.sourceQuota(ws.plan)))}, and this source is ` +
        `${mb(bytes)}. Delete sources on the dashboard's Library › Sources, or upgrade on the ` +
        "Billing page.",
    );
  }
  const freed = target?.bytes ?? 0;
  if (bytes > freed && !textFits(ws, room, bytes, freed))
    throw new Error(textFull(ws, room, bytes));

  const parts = splitParts(text);
  // An attached file keeps its own parts after the new text (a description
  // added to a picture): they follow it, renumbered.
  const fileParts = target?.storageId
    ? (
        await ctx.db
          .query("sourceParts")
          .withIndex("by_source_n", (q) => q.eq("sourceId", target._id))
          .collect()
      ).filter((p) => p.media)
    : [];
  const w: { userId?: string; client?: string } = typeof by === "string" ? {} : by;
  const fields = {
    title,
    titleStem: model.titleStemOf(title),
    kind: target?.storageId ? target.kind : kindOf(input.kind, location),
    bytes,
    parts: parts.length + fileParts.length,
    // A file's source keeps its file's fingerprint: the same file again is the same source.
    hash: target?.storageId ? target.hash : hash,
    updatedAt: Date.now(),
    ...(w.userId ? { userId: w.userId } : {}),
    ...(w.client ? { client: w.client } : {}),
  };
  let src: Doc<"sources">;
  if (target) {
    await deleteParts(ctx, target._id);
    for (const [i, p] of fileParts.entries())
      await ctx.db.patch(p._id, { n: parts.length + i + 1 });
    await ctx.db.patch(target._id, { ...fields, ...(location ? { location } : {}) });
    src = (await ctx.db.get(target._id)) as Doc<"sources">;
  } else {
    const sid = explicit ?? (await freeSid(ctx, ws._id, deriveSourceId(title, hash)));
    const id = await ctx.db.insert("sources", {
      workspaceId: ws._id,
      sid,
      ...(location ? { location } : {}),
      ...fields,
    });
    src = (await ctx.db.get(id)) as Doc<"sources">;
  }
  for (const [i, part] of parts.entries()) {
    await ctx.db.insert("sourceParts", {
      workspaceId: ws._id,
      sourceId: src._id,
      n: i + 1,
      text: part,
    });
  }
  await ctx.db.patch(ws._id, {
    sourceBytes: after,
    textBytes: Math.max(0, (ws.textBytes ?? 0) - freed + bytes),
    sourceCount: (ws.sourceCount ?? 0) + (target ? 0 : 1),
  });

  // A kept copy whose text changed: the concepts written from it may be out of date.
  let marked: string[] = [];
  if (target && review) {
    const cites = citesOf(src);
    const r = await model.reviewCiters(
      ctx,
      ws,
      (fm) => markSources(fm, (res) => cites.has(normalizeCite(res))),
      (hit) => `The source ${hit.join(", ")} changed. Still true? Verify it, or retire it.`,
      undefined,
      by,
      // Its citers, from the catalog index: no pass over the library.
      await model.citersOf(ctx, ws._id, src),
    );
    marked = r.marked.map((m) => m.id);
  }
  return {
    ...describe(src),
    ...(target ? { replaced: true } : {}),
    ...(marked.length > 0 ? { marked } : {}),
  };
}

/** Delete a kept source: its text and its files. */
export async function removeSource(ctx: MutationCtx, ws: Doc<"workspaces">, ref: string) {
  const src = await model.sourceByRef(ctx, ws._id, ref);
  if (!src) throw new Error(`no kept source "${ref}" in this library`);
  await dropSource(ctx, src);
  await ctx.db.patch(ws._id, {
    sourceBytes: Math.max(0, (ws.sourceBytes ?? 0) - src.bytes - (src.fileBytes ?? 0)),
    textBytes: Math.max(0, (ws.textBytes ?? 0) - src.bytes),
    sourceCount: Math.max(0, (ws.sourceCount ?? 0) - 1),
  });
  return { deleted: src.sid, cite: sourceCite(src) };
}

/** A source's rows and files, gone: parts, the original, and any picture converted from it. */
export async function dropSource(ctx: MutationCtx, src: Doc<"sources">) {
  const parts = await ctx.db
    .query("sourceParts")
    .withIndex("by_source_n", (q) => q.eq("sourceId", src._id))
    .collect();
  for (const p of parts) {
    if (p.media?.storageId) await deleteFile(ctx, p.media.storageId);
    await ctx.db.delete(p._id);
  }
  if (src.storageId) await deleteFile(ctx, src.storageId);
  // Libro's reading of it, if it's still going (fileCatalog.ts).
  const reading = await ctx.db
    .query("fileReads")
    .withIndex("by_source", (q) => q.eq("sourceId", src._id))
    .unique();
  if (reading) await ctx.db.delete(reading._id);
  await ctx.db.delete(src._id);
}

/** Delete a stored file, if it is still there. */
async function deleteFile(ctx: MutationCtx, id: Id<"_storage">) {
  if (await ctx.db.system.get(id)) await ctx.storage.delete(id);
}

/** Convex full-text search takes at most 16 terms. */
const searchTerms = (q: string) => q.trim().split(/\s+/).slice(0, 16).join(" ");

async function passages(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  query: string,
  sourceId: Id<"sources"> | undefined,
  limit: number,
) {
  const hits = await ctx.db
    .query("sourceParts")
    .withSearchIndex("search_text", (q) => {
      const s = q.search("text", searchTerms(query)).eq("workspaceId", ws);
      return sourceId ? s.eq("sourceId", sourceId) : s;
    })
    .take(limit);
  const out = [];
  for (const h of hits) {
    const src = await ctx.db.get(h.sourceId);
    if (src)
      out.push({ id: src.sid, cite: sourceCite(src), title: src.title, part: h.n, text: h.text });
  }
  return out;
}

/** How many of the newest sources the list reads to put the unread ones first: a page. */
export const LIST_SOURCES = 200;

/**
 * The library's newest kept sources, the ones no concept cites yet (unread)
 * first. `before` (an updatedAt) starts the page past the one before it, and
 * `next` is where the page after this one starts, if there is one. `pull`
 * pages through every source by id instead (`cursor`).
 */
export async function listSources(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  limit: number,
  before?: number,
) {
  const rows = await ctx.db
    .query("sources")
    .withIndex("by_workspace_updated", (q) =>
      before === undefined
        ? q.eq("workspaceId", ws._id)
        : q.eq("workspaceId", ws._id).lt("updatedAt", before),
    )
    .order("desc")
    .take(LIST_SOURCES);
  const listed = [];
  for (const src of rows) {
    listed.push({ ...describe(src), unread: !(await model.isCited(ctx, ws._id, src)) });
  }
  const sources = listed
    .sort((a, b) => Number(b.unread) - Number(a.unread) || b.updated_at - a.updated_at)
    .slice(0, limit);
  const next = rows.length === LIST_SOURCES ? (rows.at(-1)?.updatedAt ?? null) : null;
  return { sources, next };
}

/**
 * The newest kept sources, newest first, for the Library's Files (each
 * through `describe`) and its Needs you's files waiting, read once for
 * both: no catalog lookup a source, so they cost one read each. `oldest`:
 * the oldest, oldest first, for Files sorted that way.
 */
export async function newestSources(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  limit: number,
  oldest = false,
) {
  return await ctx.db
    .query("sources")
    .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", ws._id))
    .order(oldest ? "asc" : "desc")
    .take(limit);
}

/** The live concepts that cite a kept source (the catalog index). */
const citedBy = (ctx: QueryCtx, ws: Id<"workspaces">, src: Doc<"sources">) =>
  model.citersOf(ctx, ws, src);

/**
 * Read kept sources. No `ref`: the list (unread first), or, with a `query`,
 * passages from every source. A `ref` (`source:<id>`, its URL, or its id):
 * the source and its first part; with a `query`, its best passages; with a
 * `part`, that part.
 */
export async function getSource(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  args: {
    ref?: string;
    query?: string;
    part?: number;
    parts?: number;
    limit?: number;
    cursor?: string;
  },
  link: Link,
) {
  if (!args.ref) {
    if (args.query?.trim())
      return { passages: await passages(ctx, ws._id, args.query, undefined, 5) };
    const limit = Math.min(args.limit ?? 50, 200);
    if (args.cursor === undefined) return { sources: (await listSources(ctx, ws, limit)).sources };
    // Every source in id order, a page at a time: for copying a library.
    const page = await ctx.db
      .query("sources")
      .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws._id))
      .paginate({ cursor: args.cursor || null, numItems: limit });
    return {
      sources: page.page.map(describe),
      cursor: page.isDone ? null : page.continueCursor,
    };
  }
  const src = await requireSource(ctx, ws._id, args.ref);
  if (args.query?.trim()) {
    return { ...describe(src), passages: await passages(ctx, ws._id, args.query, src._id, 3) };
  }
  return await readPart(ctx, ws._id, src, args.part, args.parts, link);
}

async function requireSource(ctx: QueryCtx, ws: Id<"workspaces">, ref: string) {
  const src = await model.sourceByRef(ctx, ws, ref);
  if (!src) {
    throw new Error(
      `no kept source "${ref}": call get_source without \`ref\` to list them, or keep ` +
        "it with `add_source`",
    );
  }
  return src;
}

/** The most parts one read returns: about 50 pages. */
const MAX_PARTS_READ = 50;

/**
 * Parts of a kept source, from `part` (default 1), `count` of them (default
 * one); the first read (no `part`) also says who cites it.
 */
async function readPart(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  src: Doc<"sources">,
  part: number | undefined,
  count: number | undefined,
  link: Link,
) {
  count ??= 1;
  const name = src.filename ?? src.title;
  // A file still being read (or with nothing to read yet): what it is, no parts.
  if (src.parts === 0 && part === undefined) {
    return {
      ...describe(src),
      ...(src.storageId ? await link(src.storageId, name) : {}),
      cited_by: await citedBy(ctx, ws, src),
      part: 0,
      text: "",
    };
  }
  const n = part ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > src.parts) {
    throw new Error(`"${src.sid}" has parts 1 to ${src.parts}`);
  }
  const last = Math.min(src.parts, n + Math.max(1, Math.min(count, MAX_PARTS_READ)) - 1);
  const rows = await ctx.db
    .query("sourceParts")
    .withIndex("by_source_n", (q) => q.eq("sourceId", src._id).gte("n", n).lte("n", last))
    .collect();
  const media = [];
  for (const r of rows) {
    if (!r.media) continue;
    // A picture converted for the model is a JPEG of its own; a PDF's pages are the source's file.
    const own = r.media.storageId;
    const file = own ?? src.storageId;
    // A part links its file when one link serves it; a bigger file's parts are the source's.
    const url = file ? (await link(file, own ? `${name}.jpg` : name)).download_url : undefined;
    media.push({
      part: r.n,
      mime: r.media.mime,
      ...(r.media.pages ? { pages: r.media.pages } : {}),
      ...(url ? { download_url: url } : {}),
    });
  }
  return {
    ...describe(src),
    ...(src.storageId ? await link(src.storageId, name) : {}),
    ...(part === undefined ? { cited_by: await citedBy(ctx, ws, src) } : {}),
    part: n,
    ...(last > n ? { to_part: last } : {}),
    text: rows.map((r) => r.text).join("\n\n"),
    ...(media.length > 0 ? { media } : {}),
    ...(last < src.parts ? { next_part: last + 1 } : {}),
  };
}

// ---- the dashboard's Library › Sources (session-scoped) -------------------------------------

export const list = mutation({
  // `before`: the page past the one before it (the dashboard's Older sources).
  args: { before: v.optional(v.number()) },
  handler: async (ctx, { before }) => {
    const ws = await requireWorkspace(ctx);
    // Counted by what it reads (metered.ts), as every read of a library is.
    return await metered(ctx, ws, (c) =>
      surfaced(async () => ({
        ...(await listSources(c, ws, LIST_SOURCES, before)),
        // Of the library's room: on a Team, less what its other libraries keep (model.ts roomOf).
        ...(await roomBytes(c, ws)),
        maxFileBytes: model.SELF_HOST ? null : model.maxFileBytes(ws.plan),
        // Saving a link for librocat to fetch (the reading list) is a paid feature.
        canSaveLinks: model.paidFeatures(ws.plan),
      })),
    );
  },
});

/** The plan of the library the dashboard shows (convex/fetching.ts saveLink checks it). */
export const plan = query({
  args: {},
  handler: async (ctx) => (await requireWorkspace(ctx)).plan,
});

/**
 * Count the dashboard's "Save a link" against the library it shows, before
 * librocat fetches the page (fetching.ts saveLink): a call and a write, as
 * `add_source` with a URL counts.
 */
export const countSave = internalMutation({
  args: {},
  handler: async (ctx) => {
    await limitCalls(ctx, await requireWritableWorkspace(ctx), { writes: 1 });
  },
});

/** Keep a fetched page's text in the library the dashboard shows (counted by `countSave`). */
export const save = internalMutation({
  args: {
    title: v.string(),
    text: v.string(),
    location: v.optional(v.string()),
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ws = await requireWritableWorkspace(ctx);
    const userId = (await authUserId(ctx)) ?? undefined;
    const kept = await surfaced(() => addSource(ctx, ws, args, { by: "human", userId }));
    // A page a person saved: Jev reads it, as it reads a file they attach (fileCatalog.ts).
    const src = await bySid(ctx, ws._id, kept.id);
    if (src && !("existing" in kept && kept.existing)) {
      await scheduleFileCatalog(ctx, ws._id, src._id);
    }
    return kept;
  },
});

/**
 * The dashboard's "Save a link" to a file (a PDF, an Office file, a
 * picture): fetching.ts stored it, and it's attached as if uploaded,
 * counted already (countSave).
 */
export const saveFile = internalMutation({
  args: {
    storageId: v.string(),
    name: v.string(),
    title: v.optional(v.string()),
    location: v.string(),
  },
  handler: async (ctx, { storageId, name, title, location }) => {
    const ws = await requireWritableWorkspace(ctx);
    const userId = (await authUserId(ctx)) ?? undefined;
    return await surfaced(() =>
      attachFile(ctx, ws, { storageId, filename: name, title, location }, { by: "human", userId }),
    );
  },
});

// ---- source watch (convex/fetching.ts) ----------------------------------------------

const WEEK = 7 * 86_400_000;
/** Pages one review fetches again, at most. */
const WATCH_MAX = 50;

/** The kept pages concepts cite that weren't checked in a week (`force`: all of them). */
export const watchDue = internalQuery({
  args: { workspaceId: v.id("workspaces"), force: v.optional(v.boolean()) },
  handler: async (ctx, { workspaceId, force }) => {
    const rows = await ctx.db
      .query("sources")
      .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", workspaceId))
      .take(1000);
    const now = Date.now();
    const due = rows
      .filter(
        (src) =>
          src.location !== undefined &&
          isUrl(src.location) &&
          (force || now - (src.checkedAt ?? src.updatedAt) >= WEEK),
      )
      .sort((a, b) => (a.checkedAt ?? a.updatedAt) - (b.checkedAt ?? b.updatedAt));
    const out: { sid: string; location: string }[] = [];
    for (const src of due) {
      if (out.length === WATCH_MAX) break;
      // Only pages a concept cites: the catalog index says.
      if (await model.isCited(ctx, workspaceId, src)) {
        out.push({ sid: src.sid, location: src.location as string });
      }
    }
    return out;
  },
});

/**
 * A kept page, fetched again: the same text only records the check; new text
 * replaces the copy. Nothing comes up for review here: the watch asks Jev
 * which citing concepts the change affects, then calls `reviewWatched`. So
 * a changed page returns its title, what changed (a bounded summary), and
 * the first WATCH_JUDGED citing concepts with their catalog records.
 */
export const applyWatch = internalMutation({
  args: { workspaceId: v.id("workspaces"), sid: v.string(), text: v.string() },
  handler: async (
    ctx,
    { workspaceId, sid, text },
  ): Promise<
    | { changed: false }
    | {
        changed: true;
        page: { title: string; location: string };
        change: Change;
        citing: WatchConcept[];
      }
  > => {
    const ws = await ctx.db.get(workspaceId);
    const src = ws ? await bySid(ctx, workspaceId, sid) : null;
    if (!ws || !src) return { changed: false };
    let error: string | undefined;
    let out:
      | { changed: false }
      | {
          changed: true;
          page: { title: string; location: string };
          change: Change;
          citing: WatchConcept[];
        } = { changed: false };
    if (hashText(normalizeText(text)) !== src.hash) {
      // The old text, read before it is replaced, for the change's summary.
      const before = (
        await ctx.db
          .query("sourceParts")
          .withIndex("by_source_n", (q) => q.eq("sourceId", src._id))
          .collect()
      )
        .filter((p) => !p.media)
        .map((p) => p.text)
        .join("\n\n");
      try {
        const r = await addSource(
          ctx,
          ws,
          { title: src.title, text, location: src.location, kind: src.kind, id: src.sid },
          "libro",
          { review: false },
        );
        if ("replaced" in r && r.replaced === true) {
          const citing: WatchConcept[] = [];
          for (const cid of await model.citersOf(ctx, workspaceId, src, WATCH_JUDGED)) {
            if (citing.length === WATCH_JUDGED) break;
            const d = await model.getByCid(ctx, workspaceId, cid);
            if (d && d.status !== "deprecated") {
              citing.push({ id: cid, title: d.title ?? "", description: d.description ?? "" });
            }
          }
          out = {
            changed: true,
            page: { title: src.title, location: src.location ?? "" },
            change: changeSummary(before, normalizeText(text)),
            citing,
          };
        }
      } catch (exc) {
        error = exc instanceof Error ? exc.message : String(exc);
      }
    }
    // A page that fetched fine clears the last check's error.
    await ctx.db.patch(src._id, { checkedAt: Date.now(), checkError: error?.slice(0, 300) });
    return out;
  },
});

/**
 * After a watched page changed: put up for review the citing concepts Jev
 * judged `affected`, with its reason, and every citing concept it did not
 * judge (`judged` leaves them out: past WATCH_JUDGED, or all of them when
 * Jev could not be asked), as before. Those Jev judged unaffected are left
 * as they are: the page's check is already recorded.
 */
export const reviewWatched = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    sid: v.string(),
    judged: v.array(v.string()),
    affected: v.array(v.object({ id: v.string(), p: v.number() })),
  },
  handler: async (ctx, { workspaceId, sid, judged, affected }) => {
    const ws = await ctx.db.get(workspaceId);
    const src = ws ? await bySid(ctx, workspaceId, sid) : null;
    if (!ws || !src) return { marked: 0 };
    const cites = citesOf(src);
    const mark = (fm: Record<string, unknown>) =>
      markSources(fm, (res) => cites.has(normalizeCite(res)));
    const page = src.location ?? src.title;
    let marked = 0;
    for (const { id, p } of affected) {
      const r = await model.reviewCiters(
        ctx,
        ws,
        mark,
        () =>
          `The page ${page} changed in a way that touches this concept (Libro is ${Math.round(p * 100)}% sure). Still true? Verify it, or retire it.`,
        undefined,
        "libro",
        [id],
      );
      marked += r.marked.length;
    }
    const seen = new Set(judged);
    const rest = (await model.citersOf(ctx, workspaceId, src)).filter((cid) => !seen.has(cid));
    if (rest.length > 0) {
      const r = await model.reviewCiters(
        ctx,
        ws,
        mark,
        (hit) => `The source ${hit.join(", ")} changed. Still true? Verify it, or retire it.`,
        undefined,
        "libro",
        rest,
      );
      marked += r.marked.length;
    }
    return { marked };
  },
});

/** A kept page that couldn't be fetched: tried again at the next review. */
export const markChecked = internalMutation({
  args: { workspaceId: v.id("workspaces"), sid: v.string(), error: v.string() },
  handler: async (ctx, { workspaceId, sid, error }) => {
    const src = await bySid(ctx, workspaceId, sid);
    if (src)
      await ctx.db.patch(src._id, { checkedAt: Date.now(), checkError: error.slice(0, 300) });
  },
});

/**
 * The reading list: kept sources no concept cites yet (Libro's report, the
 * Overview), counted over the newest 1,000.
 */
export async function unreadSources(ctx: QueryCtx, ws: Id<"workspaces">) {
  const rows = await ctx.db
    .query("sources")
    .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", ws))
    .order("desc")
    .take(1000);
  const unread = [];
  for (const src of rows) if (!(await model.isCited(ctx, ws, src))) unread.push(src);
  return { count: unread.length, titles: unread.slice(0, 5).map((s) => s.title) };
}

/**
 * One kept source, for the dashboard's source page: a mutation, because the
 * file links it makes expire (files.ts), and a link's expiry needs the clock.
 */
export const read = mutation({
  args: { id: v.string(), part: v.optional(v.number()) },
  handler: async (ctx, { id, part }) => {
    const ws = await requireWorkspace(ctx);
    return await metered(ctx, ws, async (c) => {
      const link = linker(c, ws);
      const src = await surfaced(() => requireSource(c, ws._id, `source:${id}`));
      const out = await surfaced(async () => readPart(c, ws._id, src, part, undefined, link));
      // How far Libro has read a person's file (fileCatalog.ts), for its page.
      const reading = await c.db
        .query("fileReads")
        .withIndex("by_source", (q) => q.eq("sourceId", src._id))
        .unique();
      const libro =
        reading || src.libroRead !== undefined
          ? {
              read: Math.min(src.libroRead ?? 0, src.parts),
              total: src.parts,
              done: !reading,
              waiting: reading?.waiting === true,
            }
          : undefined;
      // The page names the concepts drawn from it, each with its description,
      // and says whether it shows the file as it is (its Preview tab).
      const titled = {
        ...out,
        ...(libro ? { libro } : {}),
        previewable: previewable(out),
        cited_concepts: out.cited_by ? await citedConcepts(c, ws._id, out.cited_by) : undefined,
      };
      return link.capped() ? { ...titled, file_transfer: transferUsed(ws) } : titled;
    });
  },
});

/** The most concepts a source's page names: a row read each. */
const CITED_SHOWN = 200;

/** The concepts that cite a source, for its page: each id, title, and description. */
async function citedConcepts(ctx: QueryCtx, ws: Id<"workspaces">, cids: string[]) {
  const out: { id: string; title: string; description: string | null }[] = [];
  for (const cid of cids.slice(0, CITED_SHOWN)) {
    const d = await model.getByCid(ctx, ws, cid);
    if (d) out.push({ id: cid, title: d.title || cid, description: d.description ?? null });
  }
  return out;
}

/** Delete a kept source from the dashboard: a call and a write, as `delete` counts. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const ws = await requireWritableWorkspace(ctx);
    await limitCalls(ctx, ws, { writes: 1 });
    return await surfaced(() => removeSource(ctx, ws, `source:${id}`));
  },
});

/**
 * Every kept source with its whole text, a page of sources at a time, for the
 * export's library part. Files come in their own parts (`exportFiles`).
 */
export const exportPage = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const ws = await requireWorkspace(ctx);
    return await metered(ctx, ws, async (c) => {
      // Two at a time: a source's text runs to 2 MB.
      const page = await c.db
        .query("sources")
        .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws._id))
        .paginate({ cursor, numItems: 2 });
      const sources = [];
      for (const src of page.page) {
        const parts = await c.db
          .query("sourceParts")
          .withIndex("by_source_n", (q) => q.eq("sourceId", src._id))
          .collect();
        sources.push({ ...describe(src), text: parts.map((p) => p.text).join("\n\n") });
      }
      return { sources, cursor: page.isDone ? null : page.continueCursor };
    });
  },
});

/**
 * The attached files' ids and sizes, a page at a time, in id order: what the
 * export cuts into file parts (src/lib/export-parts.ts). Metadata only.
 */
export const exportFileSizes = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const ws = await requireWorkspace(ctx);
    return await metered(ctx, ws, async (c) => {
      const page = await c.db
        .query("sources")
        .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws._id))
        .paginate({ cursor, numItems: 500 });
      const files = page.page
        .filter((src) => src.storageId)
        .map((src) => ({ id: src.sid, bytes: src.fileBytes ?? 0 }));
      return { files, cursor: page.isDone ? null : page.continueCursor };
    });
  },
});

/**
 * One file part of the export: the attached files with ids from `from` to
 * `to`, a page at a time, each with its links (files.ts), which the export
 * fetches right away: they count against the library's file transfer as
 * they serve.
 */
export const exportFiles = mutation({
  args: { from: v.string(), to: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }) => {
    const ws = await requireWorkspace(ctx);
    return await metered(ctx, ws, async (c) => {
      const page = await c.db
        .query("sources")
        .withIndex("by_workspace_sid", (q) =>
          q.eq("workspaceId", ws._id).gte("sid", from).lte("sid", to),
        )
        .paginate({ cursor, numItems: 4 });
      const link = linker(c, ws);
      const sources = [];
      for (const src of page.page) {
        if (!src.storageId) continue;
        sources.push({
          ...describe(src),
          ...(await link(src.storageId, src.filename ?? src.title)),
        });
      }
      return { sources, cursor: page.isDone ? null : page.continueCursor };
    });
  },
});

// ---- attached files ------------------------------------------------------------------

/** The kind a source is recorded as, for a file of this type. */
function kindForFile(kind: FileKind, mime: string): string {
  if (kind === "text")
    return mime === "text/markdown" ? "md" : mime === "text/vtt" ? "transcript" : "txt";
  if (kind === "other") return "file";
  return kind;
}

/** What a library keeps of its room, for the dashboard; no ceilings when self-hosted. */
export async function roomBytes(ctx: QueryCtx, ws: Doc<"workspaces">) {
  const room = model.SELF_HOST ? null : await model.roomOf(ctx, ws);
  return {
    bytes: ws.sourceBytes ?? 0,
    maxBytes: room ? room.bytes : null,
    textBytes: ws.textBytes ?? 0,
    maxTextBytes: room ? room.textBytes : null,
  };
}

/** Whether a file of `size` bytes fits: the plan's largest file, and the library's storage. */
function checkFileFits(ws: Doc<"workspaces">, room: model.Room, size: number) {
  if (!Number.isFinite(size) || size <= 0) throw new Error("a file needs its size, in bytes");
  const max = model.maxFileBytes(ws.plan);
  if (size > max) {
    throw new Error(
      `this file is ${mb(size)}, and a library on ${ws.plan} attaches files of up to ` +
        `${mb(max)}. Split it, or upgrade on the Billing page.`,
    );
  }
  const used = ws.sourceBytes ?? 0;
  if (used + size > room.bytes) {
    throw new Error(
      `storage quota reached: this library keeps ${mb(used)} of ${mb(room.bytes)}` +
        `${model.sharedNote(room, mb(model.sourceQuota(ws.plan)))}, and this file is ` +
        `${mb(size)}. Delete sources on the dashboard's Library › Sources, or upgrade on the ` +
        "Billing page.",
    );
  }
}

/**
 * Whether `bytes` more of text fit the library's text ceiling (model.ts
 * TEXT_BYTES), `freed` being the text it replaces. Text lives in the
 * database, so it has a ceiling of its own inside the storage quota.
 */
function textFits(ws: Doc<"workspaces">, room: model.Room, bytes: number, freed = 0): boolean {
  return (ws.textBytes ?? 0) - freed + bytes <= room.textBytes;
}

/** Why `bytes` of text don't fit. */
function textFull(ws: Doc<"workspaces">, room: model.Room, bytes: number): string {
  const used = ws.textBytes ?? 0;
  return (
    `text quota reached: this library keeps ${mb(used)} of text, of the ` +
    `${mb(room.textBytes)} its plan allows${model.sharedNote(room, mb(model.textQuota(ws.plan)))}, ` +
    `and this is ${mb(bytes)}. Text lives ` +
    "in the database, so it has its own room inside the storage quota; attached files still " +
    "fit, kept without their text. Delete sources on the dashboard's Library › Sources, or " +
    "upgrade on the Billing page."
  );
}

/** Refuse a file before it's sent when the library's file transfer can't take it now. */
async function checkTransfer(ctx: MutationCtx, ws: Doc<"workspaces">, size: number) {
  const left = await transferLeft(ctx, ws);
  if (!left || size <= left.left) return;
  // The allowance refills evenly over 30 days.
  throw new Error(transferUsed(ws, ((size - left.left) / left.included) * 30 * 86_400_000));
}

/**
 * Refuse a file librocat doesn't keep, before a byte is sent, and count it by
 * its kind and door alone (the weekly funnel email reports them). Returns
 * why, for the caller to return rather than throw: a throw would undo the
 * count.
 */
export async function refuseFile(
  ctx: MutationCtx,
  file: { name: string; type?: string },
  door: "dashboard" | "agent",
): Promise<string> {
  const mime = mimeOf(file.name, file.type);
  await ctx.db.insert("refusals", { kind: refusalKind(mime, file.name), door });
  return refusal(mime);
}

/**
 * A place to send a file's bytes: an upload URL straight to Convex storage
 * (a request through the MCP route couldn't carry a big file). Checked
 * against the plan first, and again with the file's real size when it is
 * attached.
 */
export async function requestUpload(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  file: { name: string; type?: string; size: number },
) {
  const type = mimeOf(file.name, file.type);
  // Text and pictures only: refused before a byte is sent.
  if (!accepted(type)) throw new Error(refusal(type));
  checkFileFits(ws, await model.roomOf(ctx, ws), file.size);
  await checkTransfer(ctx, ws, file.size);
  return {
    upload_url: await ctx.storage.generateUploadUrl(),
    content_type: type,
    next:
      `POST the file's bytes to upload_url with Content-Type: ${type} (for example ` +
      `curl -X POST -H 'Content-Type: ${type}' --data-binary @<file> '<upload_url>'). ` +
      'The reply is {"storageId": "..."}; then call add_source with that storage_id, the ' +
      "file's name, and a title. The URL works for an hour.",
  };
}

export interface FileInput {
  storageId: string;
  /** The file's name, for its type and the reader; defaults to the title. */
  filename?: string;
  title?: string;
  /** Its text, read by the uploader: used instead of librocat reading it. */
  text?: string;
  location?: string;
  /** The id it had in the library it came from (an import), so its citations hold. */
  id?: string;
}

const noUpload = (id: string) =>
  `no uploaded file "${id}": call add_source with \`file\` for an upload URL, send the ` +
  "file there, then pass the storageId it returns";

/**
 * Attach an uploaded file as a source: checked, recorded, and read in the
 * background (convex/attachments.ts): its text where code can read it, and a
 * picture kept as a part of its own. The same file again returns the source
 * it already is.
 */
export async function attachFile(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  input: FileInput,
  by: model.Writer,
) {
  const storageId = ctx.db.system.normalizeId("_storage", input.storageId);
  const meta = storageId ? await ctx.db.system.get(storageId) : null;
  if (!storageId || !meta) throw new Error(noUpload(input.storageId));
  const wanted = input.id ? checkSourceId(input.id) : undefined;
  const taken = await ctx.db
    .query("sources")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  // Another library's file is no upload of this one's.
  if (taken && taken.workspaceId !== ws._id) throw new Error(noUpload(input.storageId));
  if (taken) return { ...describe(taken), existing: true };
  const hash = hashText(meta.sha256);
  const same = await ctx.db
    .query("sources")
    .withIndex("by_workspace_hash", (q) => q.eq("workspaceId", ws._id).eq("hash", hash))
    .first();
  if (same) {
    await ctx.storage.delete(storageId);
    return { ...describe(same), existing: true };
  }

  const filename = (input.filename ?? input.title ?? "file").trim().slice(0, 200) || "file";
  const mime = mimeOf(filename, meta.contentType);
  // Text and pictures only: anything else goes, with why.
  if (!accepted(mime)) {
    await ctx.storage.delete(storageId);
    throw new Error(refusal(mime));
  }
  const text = input.text ? normalizeText(input.text) : "";
  const textBytes = utf8Bytes(text);
  if (textBytes > MAX_SOURCE_BYTES) throw new Error(`the text is over ${mb(MAX_SOURCE_BYTES)}`);
  const secret = text ? findSecretLine(text) : null;
  const fileBytes = meta.size;
  const room = await model.roomOf(ctx, ws);
  try {
    if (secret) {
      throw new Error(
        `${secret.line ? `line ${secret.line}` : "the text"} looks like ${secret.label}: ` +
          "librocat never stores secrets. Take it out and attach the file again.",
      );
    }
    checkFileFits(ws, room, fileBytes + textBytes);
    // Reading the file to index it is egress: it counts against the file transfer.
    const moved = await takeTransfer(ctx, ws, fileBytes);
    if (!moved.ok) throw new Error(transferUsed(ws, moved.retryAfter));
  } catch (exc) {
    await ctx.storage.delete(storageId);
    throw exc;
  }
  // Text past the library's text ceiling stays out; the file is kept, found by its title.
  const keptText = textFits(ws, room, textBytes) ? text : "";

  const title = (input.title ?? filename).replace(/\s+/g, " ").trim().slice(0, 200) || filename;
  const raw = input.location?.trim();
  const location = raw ? (isUrl(raw) ? normalizeCite(raw) : raw.slice(0, 500)) : undefined;
  const textParts = keptText ? splitParts(keptText) : [];
  const w: { userId?: string; client?: string } = typeof by === "string" ? {} : by;
  const id = await ctx.db.insert("sources", {
    workspaceId: ws._id,
    sid: await freeSid(ctx, ws._id, wanted ?? deriveSourceId(title, hash)),
    title,
    titleStem: model.titleStemOf(title),
    ...(location ? { location } : {}),
    kind: kindForFile(fileKind(mime), mime),
    bytes: keptText ? textBytes : 0,
    parts: textParts.length,
    hash,
    storageId,
    mime,
    filename,
    fileBytes,
    status: "processing",
    updatedAt: Date.now(),
    ...(w.userId ? { userId: w.userId } : {}),
    ...(w.client ? { client: w.client } : {}),
  });
  for (const [i, part] of textParts.entries()) {
    await ctx.db.insert("sourceParts", { workspaceId: ws._id, sourceId: id, n: i + 1, text: part });
  }
  await ctx.db.patch(ws._id, {
    sourceBytes: (ws.sourceBytes ?? 0) + fileBytes + (keptText ? textBytes : 0),
    textBytes: (ws.textBytes ?? 0) + (keptText ? textBytes : 0),
    sourceCount: (ws.sourceCount ?? 0) + 1,
  });
  await ctx.scheduler.runAfter(0, internal.attachments.process, { sourceId: id });
  return describe((await ctx.db.get(id)) as Doc<"sources">);
}

/**
 * An upload URL for the library the dashboard shows. It and `attach` each
 * count a call and a write, as `add_source` does for an agent's file.
 */
export const uploadUrl = mutation({
  args: { name: v.string(), type: v.optional(v.string()), size: v.number() },
  handler: async (ctx, file) => {
    const ws = await requireWritableWorkspace(ctx);
    if (!accepted(mimeOf(file.name, file.type))) {
      return { error: await refuseFile(ctx, file, "dashboard") };
    }
    await limitCalls(ctx, ws, { writes: 1 });
    return await surfaced(() => requestUpload(ctx, ws, file));
  },
});

/** Attach a file the dashboard uploaded; an import brings its old id and location too. */
export const attach = mutation({
  args: {
    storageId: v.string(),
    name: v.string(),
    title: v.optional(v.string()),
    id: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, name, title, id, location }) => {
    const ws = await requireWritableWorkspace(ctx);
    await limitCalls(ctx, ws, { writes: 1 });
    const userId = (await authUserId(ctx)) ?? undefined;
    return await surfaced(() =>
      attachFile(
        ctx,
        ws,
        { storageId, filename: name, title, id, location },
        { by: "human", userId },
      ),
    );
  },
});

const DAY = 86_400_000;
/** Stored files one run of `pruneUnattached` looks at. */
const PRUNE_PAGE = 200;

/** Whether a source or a converted picture holds a stored file. */
async function heldFile(ctx: QueryCtx, id: Id<"_storage">): Promise<boolean> {
  const source = await ctx.db
    .query("sources")
    .withIndex("by_storage", (q) => q.eq("storageId", id))
    .first();
  if (source) return true;
  const part = await ctx.db
    .query("sourceParts")
    .withIndex("by_media_storage", (q) => q.eq("media.storageId", id))
    .first();
  return part !== null;
}

/**
 * Delete stored files that nothing holds: uploads never attached (an agent
 * that stopped between the upload and `add_source`), and pictures whose
 * conversion stopped before it was recorded. An upload is attached within
 * seconds, so a file is left a day first. Daily over the files from one to
 * three days old (each is seen twice); `migrations:pruneUnattached` passes
 * `from: 0` once for older ones. PRUNE_PAGE files a run, each run scheduling
 * the next.
 */
export const pruneUnattached = internalMutation({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const to = args.to ?? Date.now() - DAY;
    const from = args.from ?? to - 2 * DAY;
    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", from).lt("_creationTime", to))
      .paginate({ cursor: args.cursor ?? null, numItems: PRUNE_PAGE });
    let deleted = 0;
    for (const file of page.page) {
      if (await heldFile(ctx, file._id)) continue;
      await ctx.storage.delete(file._id);
      deleted += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.sources.pruneUnattached, {
        from,
        to,
        cursor: page.continueCursor,
      });
    }
    return { looked: page.page.length, deleted };
  },
});

// ---- reading a file (convex/attachments.ts) -------------------------------------------

/** What the reader needs to know about a source it reads. */
export const fileJob = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const src = await ctx.db.get(sourceId);
    if (!src?.storageId) return null;
    return {
      workspaceId: src.workspaceId,
      storageId: src.storageId,
      mime: src.mime ?? "application/octet-stream",
      title: src.title,
      hasText: src.bytes > 0,
    };
  },
});

const mediaPart = v.object({
  mime: v.string(),
  /** A file of the part's own: a picture converted to JPEG (attachments.ts). */
  storageId: v.optional(v.id("_storage")),
});

/**
 * What the reader found: the file's text (when the uploader sent none) and
 * the file's own parts (a picture), after the text. `storedBytes`: the size
 * of the files the reader stored for its parts (a converted picture), which
 * the library's storage counts. A secret in the text: the files go, and the
 * source says why.
 */
export const storeFileParts = internalMutation({
  args: {
    sourceId: v.id("sources"),
    text: v.string(),
    media: v.array(mediaPart),
    note: v.optional(v.string()),
    storedBytes: v.optional(v.number()),
  },
  handler: async (ctx, { sourceId, text, media, note, storedBytes = 0 }) => {
    const src = await ctx.db.get(sourceId);
    const ws = src ? await ctx.db.get(src.workspaceId) : null;
    if (!src || !ws) {
      for (const m of media) if (m.storageId) await deleteFile(ctx, m.storageId);
      return;
    }
    const clean = normalizeText(text);
    const secret = clean ? findSecretLine(clean) : null;
    if (secret) {
      for (const m of media) if (m.storageId) await deleteFile(ctx, m.storageId);
      if (src.storageId) await deleteFile(ctx, src.storageId);
      await ctx.db.patch(ws._id, {
        sourceBytes: Math.max(0, (ws.sourceBytes ?? 0) - (src.fileBytes ?? 0)),
      });
      await ctx.db.patch(sourceId, {
        storageId: undefined,
        fileBytes: 0,
        status: "failed",
        error:
          `${secret.line ? `line ${secret.line} of its text` : "its text"} looks like ` +
          `${secret.label}: librocat never stores secrets, so the file was deleted.`,
      });
      return;
    }
    const existing = await ctx.db
      .query("sourceParts")
      .withIndex("by_source_n", (q) => q.eq("sourceId", sourceId))
      .collect();
    let texts = clean ? splitParts(clean.slice(0, MAX_SOURCE_BYTES)) : [];
    // Text past the library's text ceiling stays out: the file is kept, found by its title.
    let textNote: string | undefined;
    if (texts.length > 0) {
      const read = utf8Bytes(texts.join("\n\n"));
      const room = await model.roomOf(ctx, ws);
      if (!textFits(ws, room, read, src.bytes)) {
        textNote = `Its text isn't kept: ${textFull(ws, room, read)}`;
        texts = [];
      }
    }
    // Text first, then the file's own parts.
    let n = 0;
    for (const t of texts) {
      n += 1;
      await ctx.db.insert("sourceParts", { workspaceId: ws._id, sourceId, n, text: t });
    }
    for (const p of existing) {
      if (p.media) {
        n += 1;
        await ctx.db.patch(p._id, { n });
      } else if (texts.length > 0) {
        await ctx.db.delete(p._id);
      } else {
        n += 1;
        await ctx.db.patch(p._id, { n });
      }
    }
    for (const m of media) {
      n += 1;
      await ctx.db.insert("sourceParts", { workspaceId: ws._id, sourceId, n, text: "", media: m });
    }
    const textBytes = texts.length > 0 ? utf8Bytes(texts.join("\n\n")) : src.bytes;
    const error = note ?? textNote;
    await ctx.db.patch(sourceId, {
      bytes: textBytes,
      parts: n,
      fileBytes: (src.fileBytes ?? 0) + storedBytes,
      ...(error ? { error } : {}),
    });
    await ctx.db.patch(ws._id, {
      sourceBytes: (ws.sourceBytes ?? 0) - src.bytes + textBytes + storedBytes,
      textBytes: Math.max(0, (ws.textBytes ?? 0) - src.bytes + textBytes),
    });
  },
});

/** The reader is done: the file is ready, or it failed, and why. */
export const finishFile = internalMutation({
  args: { sourceId: v.id("sources"), failed: v.optional(v.string()) },
  handler: async (ctx, { sourceId, failed }) => {
    const src = await ctx.db.get(sourceId);
    if (!src) return;
    await ctx.db.patch(sourceId, {
      ...(src.status === "failed" ? {} : { status: failed ? "failed" : "ready" }),
      ...(failed ? { error: failed.slice(0, 300) } : {}),
    });
    // A person's file, read: Jev reads it too (fileCatalog.ts).
    if (!failed && src.status !== "failed" && !src.client) {
      await scheduleFileCatalog(ctx, src.workspaceId, sourceId);
    }
  },
});

// ---- search: kept sources after the concepts (convex/mcp.ts searchWords) --------------

/** A search hit from a kept source: which part, and what it holds. */
export type SourceHit = {
  id: string;
  /** The part to read with `get_source`; 0 when the source has none (a file kept as it is). */
  part: number;
  type: "Source";
  title: string;
  snippet: string;
  file?: { mime: string };
};

/** A line of a part for a search hit: its text's start, or what the file part is. */
function snippetOf(part: Doc<"sourceParts">): string {
  if (part.text.trim()) return part.text.trim().slice(0, 200);
  const m = part.media;
  if (!m) return "";
  if (m.pages) return `pages ${m.pages[0]}–${m.pages[1]} of the PDF`;
  return m.mime.startsWith("image/") ? "the image" : "the file";
}

/**
 * A kept source as a search hit, at `part`: the part that matched the
 * query's words, or its first, or none for a source with no parts (a file
 * kept as it is, found by its title). Pure, exported for tests.
 */
export function hitOf(
  src: Pick<Doc<"sources">, "sid" | "title" | "mime">,
  part: Doc<"sourceParts"> | null,
): SourceHit {
  const mime = part ? part.media?.mime : src.mime;
  return {
    id: `source:${src.sid}`,
    part: part?.n ?? 0,
    type: "Source",
    title: src.title,
    snippet: part ? snippetOf(part) : src.mime?.startsWith("image/") ? "the image" : "the file",
    ...(mime ? { file: { mime } } : {}),
  };
}

/**
 * The kept sources that best answer a query, after the concepts, by words:
 * the ones whose title matches it first (a match in a concept's catalog
 * record weighs more than one in its body, model.ts search), with their part
 * that matched, else their first; then the rest whose parts match. One hit
 * per source, at most `limit`. A title search reads small rows, so a picture
 * or a scan with no text is found by what its title says.
 */
export async function sourceHits(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  query: string,
  limit = 5,
): Promise<SourceHit[]> {
  const terms = searchTerms(query);
  if (!terms) return [];
  // Each source's best part by its text, best first.
  const matched = await ctx.db
    .query("sourceParts")
    .withSearchIndex("search_text", (q) => q.search("text", terms).eq("workspaceId", ws))
    .take(limit);
  const best = new Map<Id<"sources">, Doc<"sourceParts">>();
  for (const part of matched) if (!best.has(part.sourceId)) best.set(part.sourceId, part);
  const stemmed = stemQuery(query);
  const titled = stemmed
    ? await ctx.db
        .query("sources")
        .withSearchIndex("search_title", (q) =>
          q.search("titleStem", stemmed).eq("workspaceId", ws),
        )
        .take(limit)
    : [];
  const out: SourceHit[] = [];
  const seen = new Set<Id<"sources">>();
  for (const src of titled) {
    seen.add(src._id);
    const part =
      best.get(src._id) ??
      (await ctx.db
        .query("sourceParts")
        .withIndex("by_source_n", (q) => q.eq("sourceId", src._id))
        .first());
    // One with nothing to read or fetch (a file deleted for a secret in its text) is no hit.
    if (part || src.storageId) out.push(hitOf(src, part));
  }
  for (const [sourceId, part] of best) {
    if (out.length >= limit) break;
    if (seen.has(sourceId)) continue;
    const src = await ctx.db.get(sourceId);
    if (src) out.push(hitOf(src, part));
  }
  return out.slice(0, limit);
}
