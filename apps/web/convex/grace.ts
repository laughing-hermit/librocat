/**
 * What a paid plan's end does to its owner's libraries (the Terms, "Plans
 * and limits"), as Supabase does with projects: they're held to Free's
 * limits at once, paused rather than deleted, and kept for a year.
 *
 * - At once: Free's limits apply. A library over them takes no new concepts
 *   or files until it's under them; its teammates pause (membership.ts
 *   pausedIn). An email says what follows, with the export link.
 * - Day PAUSE_DAYS: the libraries past Free's one pause (`pausedAt`): no
 *   agent reaches them, and the dashboard only opens, exports, or deletes
 *   them. The one with the most concepts stays active.
 * - Month 12 (KEEP_DAYS): what's still over is deleted, after two more
 *   emails, 30 and 7 days before: the paused libraries, then what changed
 *   least recently in the one kept, until it fits (graceTrim.ts).
 *
 * A plan, any time, brings a library back whole, and so does room for it
 * on Free (resumeRoom). Nothing within Free's limits is deleted. One grace
 * per owner: another library dropping to Free starts it again. A
 * self-hosted librocat has no plans.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { authComponent } from "./auth";
import { sendEmail } from "./email";
import { ensureWorkspace } from "./membership";
import {
  conceptQuota,
  freeLibraries,
  revisionsKept,
  SELF_HOST,
  sourceQuota,
  textQuota,
} from "./model";

const DAY = 86_400_000;
/** Days after a paid plan ends that the libraries past Free's one pause. */
export const PAUSE_DAYS = 30;
/** Days after it ends that what's still over Free's limits is deleted. */
export const KEEP_DAYS = 365;
const PAUSE_MS = PAUSE_DAYS * DAY;
const KEEP_MS = KEEP_DAYS * DAY;
/** The emails before anything is deleted: this long before. */
const WARNINGS = { soon: 30 * DAY, last: 7 * DAY } as const;

const siteUrl = () => (process.env.SITE_URL ?? "https://librocat.com").replace(/\/$/, "");

type Usage = Pick<
  Doc<"workspaces">,
  "conceptCount" | "sourceBytes" | "textBytes" | "revisionCount"
>;

/** How far a library is over Free's limits, each 0 when it's within. Pure. */
export function overFree(ws: Usage) {
  return {
    concepts: Math.max(0, ws.conceptCount - conceptQuota("free")),
    bytes: Math.max(0, (ws.sourceBytes ?? 0) - sourceQuota("free")),
    textBytes: Math.max(0, (ws.textBytes ?? 0) - textQuota("free")),
    revisions: Math.max(0, (ws.revisionCount ?? 0) - revisionsKept("free")),
  };
}
export type Over = ReturnType<typeof overFree>;
const isOver = (o: Over) => o.concepts > 0 || o.bytes > 0 || o.textBytes > 0 || o.revisions > 0;

type Ranked = Pick<Doc<"workspaces">, "_id" | "_creationTime" | "conceptCount" | "pausedAt">;

/**
 * Which of an owner's Free libraries stay active, Free having
 * freeLibraries(): one not paused, then the one picked when the grace
 * started, then those with the most concepts, the oldest first. Pure.
 */
export function keptOf<W extends Ranked>(free: W[], keep?: Id<"workspaces">) {
  const order = [...free].sort(
    (a, b) =>
      Number(a.pausedAt !== undefined) - Number(b.pausedAt !== undefined) ||
      Number(b._id === keep) - Number(a._id === keep) ||
      b.conceptCount - a.conceptCount ||
      a._creationTime - b._creationTime,
  );
  return { kept: order.slice(0, freeLibraries()), extra: order.slice(freeLibraries()) };
}

/** An owner's libraries on Free, but one being deleted: its members go first (workspaces.ts). */
async function freeLibrariesOf(ctx: QueryCtx, ownerId: string) {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const out: Doc<"workspaces">[] = [];
  for (const ws of owned) {
    if (ws.plan !== "free") continue;
    const member = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
      .first();
    if (member) out.push(ws);
  }
  return out;
}

/** Where an owner stands against Free: the libraries past its one, and what's over in those kept. */
async function graceWork(ctx: QueryCtx, ownerId: string, keep?: Id<"workspaces">) {
  const { kept, extra } = keptOf(await freeLibrariesOf(ctx, ownerId), keep);
  const over = kept.map((ws) => ({ ws, over: overFree(ws) })).filter((k) => isOver(k.over));
  return { kept, extra, over, any: extra.length > 0 || over.length > 0 };
}

const graceOf = (ctx: QueryCtx, ownerId: string) =>
  ctx.db
    .query("graces")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .unique();

/**
 * A paid plan of `ownerId`'s ended (billing.ts setStatus, workspaces.ts
 * deleteLibrary): when anything is over Free's limits, their grace starts,
 * or starts again, with its emails, its pause, and its end scheduled. Each
 * scheduled step does nothing once a later start replaces this one.
 */
export async function startGrace(ctx: MutationCtx, ownerId: string) {
  if (SELF_HOST) return;
  const work = await graceWork(ctx, ownerId);
  if (!work.any) return;
  const since = Date.now();
  const keep = work.kept[0]?._id;
  const row = await graceOf(ctx, ownerId);
  if (row?.since === since) return;
  if (row) await ctx.db.patch(row._id, { since, keep });
  else await ctx.db.insert("graces", { ownerId, since, keep });
  const at = { ownerId, since };
  await ctx.scheduler.runAfter(0, internal.grace.notify, { ...at, kind: "start" });
  await ctx.scheduler.runAfter(PAUSE_MS, internal.grace.pause, at);
  await ctx.scheduler.runAfter(KEEP_MS - WARNINGS.soon, internal.grace.notify, {
    ...at,
    kind: "soon",
  });
  await ctx.scheduler.runAfter(KEEP_MS - WARNINGS.last, internal.grace.notify, {
    ...at,
    kind: "last",
  });
  await ctx.scheduler.runAfter(KEEP_MS, internal.grace.expire, at);
}

/**
 * Room for a paused library on Free (its owner deleted another, or gave one
 * a plan): the paused ones with the most concepts come back, while it lasts.
 */
export async function resumeRoom(ctx: MutationCtx, ownerId: string) {
  if (SELF_HOST) return;
  const free = await freeLibrariesOf(ctx, ownerId);
  let active = free.filter((w) => w.pausedAt === undefined).length;
  const paused = free
    .filter((w) => w.pausedAt !== undefined)
    .sort((a, b) => b.conceptCount - a.conceptCount || a._creationTime - b._creationTime);
  for (const w of paused) {
    if (active >= freeLibraries()) break;
    await ctx.db.patch(w._id, { pausedAt: undefined });
    active += 1;
  }
}

/**
 * The grace a library is in, for its dashboard: when the libraries past
 * Free's one pause (or since when this one is), when what's still over is
 * deleted, whether this one is past Free's one, and which one stays. Null
 * when it isn't in one.
 */
export async function graceFor(ctx: QueryCtx, ws: Doc<"workspaces">) {
  if (ws.plan !== "free" || SELF_HOST) return null;
  const row = await graceOf(ctx, ws.ownerId);
  if (!row) return null;
  const work = await graceWork(ctx, ws.ownerId, row.keep);
  const extra = work.extra.some((w) => w._id === ws._id);
  const over = work.over.find((o) => o.ws._id === ws._id)?.over ?? null;
  if (!extra && !over) return null;
  return {
    pausesAt: row.since + PAUSE_MS,
    paused: ws.pausedAt !== undefined,
    deletesAt: row.since + KEEP_MS,
    extra,
    kept: work.kept[0]?.name ?? null,
    over,
  };
}

const day = (at: number) =>
  new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
const count = (n: number, one: string) =>
  `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;
const names = (list: string[]) =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;

/** What's over in a library, in words: "3 concepts, 1.2 GB of documents and pictures". Pure. */
export function overWords(o: Over) {
  return [
    o.concepts > 0 && count(o.concepts, "concept"),
    o.bytes > 0 && `${size(o.bytes)} of documents and pictures`,
    o.bytes === 0 && o.textBytes > 0 && `${size(o.textBytes)} of their text`,
    o.revisions > 0 && count(o.revisions, "old revision"),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The grace's emails, all to the owner: when the plan ends (`start`), and
 * 30 (`soon`) and 7 (`last`) days before what's still over is deleted.
 * Pure.
 */
export function graceEmail(o: {
  kind: "start" | "soon" | "last";
  pausesAt: number;
  deletesAt: number;
  over: { name: string; over: Over }[];
  kept: string | null;
  extra: string[];
  libraryUrl: string;
  billingUrl: string;
}): { subject: string; text: string } {
  const deletes = day(o.deletesAt);
  const trimmed = o.over.map((l) => l.name);
  const goes = [
    o.extra.length > 0 &&
      `${names(o.extra)}, ${o.extra.length === 1 ? "the library" : "the libraries"} past Free's one`,
    trimmed.length > 0 && `what changed least recently in ${names(trimmed)}, until it fits`,
  ]
    .filter(Boolean)
    .join(", then ");
  const ways = [
    "Until then, you can:",
    `- Export a library, from its Settings: ${o.libraryUrl}`,
    "- Delete what you don't need, so you choose what stays.",
    `- Choose a plan, and everything is back as it was: ${o.billingUrl}`,
  ].join("\n");
  const footer = "You get this because you own these libraries on librocat.";
  if (o.kind === "start") {
    return {
      subject: "Your paid plan ended: your libraries are on Free",
      text: [
        "Your paid plan ended, so your libraries are on Free: one library, with up to 1,000 concepts and 100 MB of documents and pictures.",
        ...(o.extra.length > 0
          ? [
              `On ${day(o.pausesAt)}, ${names(o.extra)} ${o.extra.length === 1 ? "pauses" : "pause"}, since Free has one library and ${o.kept ?? "another"} has the most concepts. No agent reaches a paused library; you can still open, export, or delete it.`,
            ]
          : []),
        ...o.over.map(
          (l) =>
            `${l.name} is ${overWords(l.over)} over Free's limits: new concepts and files wait until it's under them.`,
        ),
        `If it's still so on ${deletes}, what's over Free's limits is deleted: ${goes}. We'll email you 30 days and 7 days before. Nothing within Free's limits is deleted.`,
        ways,
        footer,
      ].join("\n\n"),
    };
  }
  return {
    subject:
      o.kind === "soon"
        ? `In 30 days: what's over Free's limits is deleted on ${deletes}`
        : `7 days left: what's over Free's limits is deleted on ${deletes}`,
    text: [
      `On ${deletes}, what's still over Free's limits in your libraries is deleted: ${goes}. Nothing within Free's limits is deleted.`,
      ways,
      footer,
    ].join("\n\n"),
  };
}

const kind = v.union(v.literal("start"), v.literal("soon"), v.literal("last"));

/** The grace's email now, and its address: null once this grace is replaced or over, or nothing is over. */
export const notice = internalQuery({
  args: { ownerId: v.string(), since: v.number(), kind },
  handler: async (ctx, { ownerId, since, kind }) => {
    const row = await graceOf(ctx, ownerId);
    if (row?.since !== since) return null;
    const work = await graceWork(ctx, ownerId, row.keep);
    if (!work.any) return null;
    const user = await authComponent.getAnyUserById(ctx, ownerId);
    if (!user?.email) return null;
    return {
      to: user.email,
      ...graceEmail({
        kind,
        pausesAt: since + PAUSE_MS,
        deletesAt: since + KEEP_MS,
        over: work.over.map(({ ws, over }) => ({ name: ws.name, over })),
        kept: work.kept[0]?.name ?? null,
        extra: work.extra.map((w) => w.name),
        libraryUrl: `${siteUrl()}/dashboard/library`,
        billingUrl: `${siteUrl()}/dashboard/billing`,
      }),
    };
  },
});

/** Email the owner (startGrace schedules each). */
export const notify = internalAction({
  args: { ownerId: v.string(), since: v.number(), kind },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const email = await ctx.runQuery(internal.grace.notice, args);
    if (!email) return null;
    try {
      await sendEmail(email);
    } catch (exc) {
      const error = exc instanceof Error ? exc.message : String(exc);
      console.warn(
        JSON.stringify({ graceNotice: { ownerId: args.ownerId, kind: args.kind, error } }),
      );
    }
    return null;
  },
});

/** Day 30: the libraries past Free's one pause, and the one kept is active. */
export const pause = internalMutation({
  args: { ownerId: v.string(), since: v.number() },
  returns: v.null(),
  handler: async (ctx, { ownerId, since }) => {
    const row = await graceOf(ctx, ownerId);
    if (row?.since !== since) return null;
    const work = await graceWork(ctx, ownerId, row.keep);
    const now = Date.now();
    for (const ws of work.extra) {
      if (ws.pausedAt === undefined) await ctx.db.patch(ws._id, { pausedAt: now });
    }
    for (const ws of work.kept) {
      if (ws.pausedAt !== undefined) await ctx.db.patch(ws._id, { pausedAt: undefined });
    }
    return null;
  },
});

/** Month 12: what's still over Free's limits goes, unless a later start replaced this grace. */
export const expire = internalMutation({
  args: { ownerId: v.string(), since: v.number() },
  returns: v.null(),
  handler: async (ctx, { ownerId, since }) => {
    const row = await graceOf(ctx, ownerId);
    if (row?.since !== since) return null;
    const work = await graceWork(ctx, ownerId, row.keep);
    await ctx.db.delete(row._id);
    for (const ws of work.extra) await removeLibrary(ctx, ws);
    for (const { ws } of work.over) {
      await ctx.scheduler.runAfter(0, internal.graceTrim.trim, { workspaceId: ws._id });
    }
    return null;
  },
});

/**
 * A library past Free's one goes as Delete library does (workspaces.ts
 * deleteLibrary): its members first, so nothing reaches it, then its rows
 * in slices. Everyone in it keeps a library; its owner, the one kept.
 */
async function removeLibrary(ctx: MutationCtx, ws: Doc<"workspaces">) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .collect();
  for (const m of members) await ctx.db.delete(m._id);
  for (const m of members) await ensureWorkspace(ctx, m.userId, undefined, ws._id);
  await ctx.scheduler.runAfter(0, internal.account.teardownLibraries, { workspaceIds: [ws._id] });
}
