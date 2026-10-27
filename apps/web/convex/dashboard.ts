/**
 * The dashboard's pages that read a library, one counted call a page
 * (metered.ts): Home and a concept's page. A session calling Convex
 * directly counts the same as the dashboard does. The small reads (who you
 * are, your libraries, the team) stay queries, so Billing always opens.
 */

import { THESAURUS_ID } from "@librocat/core/library";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx } from "./_generated/server";
import { surfaced } from "./errors";
import { linker } from "./files";
import { openShelf } from "./libro";
import { metered } from "./metered";
import * as model from "./model";
import { questionsSince, summarize } from "./reference";
import { describe, LIST_SOURCES, newestSources, roomBytes } from "./sources";
import { authUserId, requireWorkspace, requireWritableWorkspace } from "./workspaces";

const DAY = 86_400_000;
/** The most questions, and sources, the Library's Needs you lists as needing an agent (it pages them). */
const NEEDS = 50;
/** The newest sources Home looks through for ones no concept cites. */
const WAITING_SCAN = 50;
/** How long the week's questions, added up (questionWeeks), stand for them while none is newer. */
const WEEK_FRESH = 60 * 60_000;

/** The concepts a review item names: a tag pair names none, and only some kinds have a second. */
function conceptsNamed(p: { kind: string; subject: string; target: string | null }): string[] {
  if (p.kind === "synonym") return [];
  const second = p.target && ["merge", "supersede", "deprecate"].includes(p.kind);
  return second && p.target ? [p.subject, p.target] : [p.subject];
}

/** What the dashboard reads of a week's questions (reference.ts summarize). */
type Week = Pick<ReturnType<typeof summarize>, "asked" | "found_nothing" | "unanswered">;

/** "Answered this week": the questions that found something, of all asked, as Libro's report counts them. Pure. */
export function answeredOf(week: Week) {
  return { asked: week.asked, answered: week.asked - week.found_nothing };
}

/** Shown unless dismissed since it last happened (asked again, or the source changed). Pure. */
export const undismissed = (at: number, dismissedAt: number | undefined) =>
  dismissedAt === undefined || at > dismissedAt;

/** The week's questions with no answer yet, as Libro's report lists them, less the dismissed. Pure. */
export function gapsOf(week: Week, dismissed: Map<string, number>, max = NEEDS) {
  return week.unanswered
    .filter((g) => undismissed(g.last_asked, dismissed.get(g.key)))
    .slice(0, max)
    .map(({ key, text, count, last_asked }) => ({ key, text, count, at: last_asked }));
}

/** When each of `keys` was dismissed, if it was: one indexed lookup a key. */
async function dismissals(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  kind: "question" | "source",
  keys: string[],
) {
  const out = new Map<string, number>();
  for (const key of keys) {
    const d = await ctx.db
      .query("dismissedGaps")
      .withIndex("by_workspace_kind_key", (q) =>
        q.eq("workspaceId", ws._id).eq("kind", kind).eq("key", key),
      )
      .first();
    if (d) out.set(key, d.at);
  }
  return out;
}

/**
 * This week's questions, added up as Libro's report does (reference.ts
 * summarize), kept in questionWeeks: a look reads that row and the newest
 * question, and reads the week again (up to 1,000 questions) only when a
 * question is newer than the row, or the row is WEEK_FRESH old (the week
 * moves on). What it keeps comes from each question's words and hits, which
 * never change once asked, so nothing else can make it stale.
 */
async function weekOf(ctx: MutationCtx, ws: Doc<"workspaces">, now: number): Promise<Week> {
  const latest = await ctx.db
    .query("questions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .order("desc")
    .first();
  const newest = latest?._creationTime ?? 0;
  const kept = await ctx.db
    .query("questionWeeks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .unique();
  if (kept && kept.newest === newest && now - kept.at < WEEK_FRESH) return kept;
  const { asked, found_nothing, unanswered } = summarize(
    await questionsSince(ctx, ws._id, now - 7 * DAY),
    20,
  );
  const week = { at: now, newest, asked, found_nothing, unanswered };
  if (kept) await ctx.db.patch(kept._id, week);
  else await ctx.db.insert("questionWeeks", { workspaceId: ws._id, ...week });
  return week;
}

/**
 * What agents asked this week, with the same read and selection as Libro's
 * report (reference.ts summarize): how many found something, and the ones
 * with no answer yet.
 */
export async function questionsOf(ctx: MutationCtx, ws: Doc<"workspaces">, now: number) {
  const week = await weekOf(ctx, ws, now);
  const dismissed = await dismissals(
    ctx,
    ws,
    "question",
    week.unanswered.map((g) => g.key),
  );
  return { ...answeredOf(week), gaps: gapsOf(week, dismissed) };
}

/**
 * Files waiting for an agent: sources added in the last 30 days that no
 * concept cites (model.isCited), newest first, less the dismissed. Looks
 * through the newest WAITING_SCAN at most.
 */
export async function waitingOf(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  now: number,
  newest?: Doc<"sources">[],
) {
  const since = now - 30 * DAY;
  // The Library's newest sources hold these (the same order, and more of
  // them), so it passes them instead of a second read.
  const recent = newest
    ? newest.filter((s) => s.updatedAt >= since).slice(0, WAITING_SCAN)
    : await ctx.db
        .query("sources")
        .withIndex("by_workspace_updated", (q) =>
          q.eq("workspaceId", ws._id).gte("updatedAt", since),
        )
        .order("desc")
        .take(WAITING_SCAN);
  const ready = recent.filter(
    (s) => s._creationTime >= since && s.status !== "processing" && s.status !== "failed",
  );
  const dismissed = await dismissals(
    ctx,
    ws,
    "source",
    ready.map((s) => s.sid),
  );
  const out: { id: string; title: string; at: number }[] = [];
  for (const s of ready) {
    if (out.length === NEEDS) break;
    if (!undismissed(s.updatedAt, dismissed.get(s.sid))) continue;
    if (!(await model.isCited(ctx, ws._id, s))) {
      out.push({ id: s.sid, title: s.title, at: s.updatedAt });
    }
  }
  return out;
}

/**
 * Stop showing a question or a source on Home until it is asked again or the
 * source changes. Any member may: it changes nothing in the library.
 */
export const dismissGap = mutation({
  args: { kind: v.union(v.literal("question"), v.literal("source")), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { kind, key }) => {
    const ws = await requireWritableWorkspace(ctx);
    if (!key || key.length > 300) throw new ConvexError("not a question or a source");
    const at = Date.now();
    const had = await ctx.db
      .query("dismissedGaps")
      .withIndex("by_workspace_kind_key", (q) =>
        q.eq("workspaceId", ws._id).eq("kind", kind).eq("key", key),
      )
      .first();
    if (had) await ctx.db.patch(had._id, { at });
    else await ctx.db.insert("dismissedGaps", { workspaceId: ws._id, kind, key, at });
    return null;
  },
});

type Shelf = Awaited<ReturnType<typeof openShelf>>;
type Counts = Awaited<ReturnType<typeof model.statusOf>>;

/**
 * The library's counts, its review shelf, this week's questions, and the
 * files waiting. The Library passes what it has read already (the shelf,
 * the counts, the newest sources), so each is read once.
 */
async function overviewOf(
  c: MutationCtx,
  ws: Doc<"workspaces">,
  read: { shelf?: Shelf; status?: Counts; newest?: Doc<"sources">[] } = {},
) {
  const shelf = read.shelf ?? (await openShelf(c, ws._id));
  const now = Date.now();
  return {
    status: read.status ?? (await model.statusOf(c, ws, shelf.length)),
    shelf,
    titles: await model.titlesOf(c, ws._id, shelf.flatMap(conceptsNamed), new Map()),
    questions: await questionsOf(c, ws, now),
    waiting: await waitingOf(c, ws, now, read.newest),
  };
}

/** What needs the person, with the library's counts (the Library returns it too). */
export const overview = mutation({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    return await metered(ctx, ws, (c) => surfaced(() => overviewOf(c, ws)));
  },
});

/**
 * The Library in one counted call: a page of concepts (searched, or listed by
 * Convex's cursor) through its filters, what each filter offers (types and
 * tags with their counts, the newest files), how much the files use, its
 * counts, and, when asked (`review`), what needs the person.
 */
export const library = mutation({
  args: {
    query: v.optional(v.string()),
    type: v.optional(v.string()),
    tag: v.optional(v.string()),
    shelf: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    /** Also what needs the person: the Library's first page, or its Needs you tab. */
    review: v.optional(v.boolean()),
    /**
     * The concepts and files by when each last changed or came in, newest
     * or oldest first (the Library's sort). None: concepts by id (A–Z).
     */
    order: v.optional(v.union(v.literal("newest"), v.literal("oldest"))),
  },
  handler: async (ctx, { query, cursor, review, order, ...filters }) => {
    const ws = await requireWorkspace(ctx);
    const me = (await authUserId(ctx)) ?? undefined;
    return await metered(ctx, ws, (c) =>
      surfaced(async () => {
        let page: { concepts: Concept[]; cursor: string | null };
        if (query?.trim()) {
          // As many as a search returns: the Library pages through them.
          const found: Concept[] = await model.search(c, ws._id, {
            query,
            ...filters,
            me,
            limit: model.SEARCH_MAX,
          });
          page = { concepts: found, cursor: null };
        } else {
          page = order
            ? await model.recentPage(c, ws._id, { ...filters, me, cursor, order })
            : await model.listPage(c, ws._id, { ...filters, me, cursor });
        }
        // Each thing read once: the shelf gives the counts its size, the
        // counts give the filters their options, and the newest sources are
        // both the Files and where Needs you looks for files waiting.
        const shelf = review ? await openShelf(c, ws._id) : undefined;
        const status = await model.statusOf(c, ws, shelf?.length);
        const newest = await newestSources(c, ws, LIST_SOURCES);
        // Files oldest first are a read of their own, only when asked.
        const files = order === "oldest" ? await newestSources(c, ws, LIST_SOURCES, true) : newest;
        return {
          ...page,
          // The thesaurus is librocat's own (Libro keeps it): not a row of the list.
          concepts: page.concepts.filter((c) => c.id !== THESAURUS_ID),
          // A search that filled its limit has more past it: the Library says so.
          capped: query?.trim() ? page.concepts.length >= model.SEARCH_MAX : false,
          types: status.by_type,
          tags: status.by_tag,
          sources: files.map(describe),
          // Of the library's room: on a Team, less what its other libraries keep.
          ...(await roomBytes(c, ws)),
          maxFileBytes: model.SELF_HOST ? null : model.maxFileBytes(ws.plan),
          canSaveLinks: model.paidFeatures(ws.plan),
          // The numbers over the list: a few counted rows.
          status,
          // Needs you, read only when asked.
          review: shelf ? await overviewOf(c, ws, { shelf, status, newest }) : null,
        };
      }),
    );
  },
});

type Concept = Awaited<ReturnType<typeof model.listPage>>["concepts"][number] & {
  snippet?: string;
  /** When it last changed, in a list sorted by it (model.recentPage). */
  updated_at?: number;
};

/**
 * A concept's page: the concept, its links both ways, its history (each
 * revision with its person), one revision, the open proposals about it, and
 * a download link for each of its sources that keeps a file (at most 20).
 */
export const concept = mutation({
  args: { id: v.string(), revision: v.optional(v.string()) },
  handler: async (ctx, { id, revision }) => {
    const ws = await requireWorkspace(ctx);
    return await metered(ctx, ws, (c) =>
      surfaced(async () => {
        const concept = await model.getConcept(c, ws._id, id);
        if (!concept) {
          return {
            concept: null,
            graph: null,
            history: null,
            revision: null,
            proposals: [],
            titles: {},
            downloads: {} as Record<string, string>,
          };
        }
        const proposals = (await openShelf(c, ws._id)).filter(
          (p) => p.kind !== "synonym" && (p.subject === id || p.target === id),
        );
        return {
          concept,
          graph: await model.graphOf(c, ws._id, id, 1),
          history: await model.history(c, ws._id, id, { people: true }),
          // A revision that isn't there shows the page without it.
          revision:
            revision === undefined
              ? null
              : await model.history(c, ws._id, id, { revision }).catch(() => null),
          proposals,
          titles: await model.titlesOf(c, ws._id, proposals.flatMap(conceptsNamed), new Map()),
          downloads: await downloadsOf(c, ws, concept.stored_sources),
        };
      }),
    );
  },
});

/**
 * A download link for each of a concept's sources that keeps a file, by the
 * source's id: one link per source; a file too big for one link downloads
 * from its own page. Making a link reads nothing more; serving it counts.
 */
async function downloadsOf(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  sources: { cite: string; id: string }[],
): Promise<Record<string, string>> {
  const link = linker(ctx, ws);
  const out: Record<string, string> = {};
  for (const s of sources) {
    const src = await model.sourceByRef(ctx, ws._id, s.cite);
    if (!src?.storageId) continue;
    const { download_url } = await link(src.storageId, src.filename ?? src.title);
    if (download_url) out[s.id] = download_url;
  }
  return out;
}
