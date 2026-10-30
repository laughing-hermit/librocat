/**
 * Libro's report: what the library shows, for the people who keep it. A
 * librarian reports to the library's owners; Libro does it every week, and
 * on Free once a month.
 *
 * - Home shows what needs a decision live (`report`).
 * - Every Monday at 08:00 UTC (on Free, the month's first Monday), an hour
 *   after Libro's review (convex/crons.ts), it goes by email to each member
 *   who wants it: admins by default, anyone who turns it on in Settings ›
 *   Account (`setReportEmail`). Each email carries a one-click
 *   unsubscribe that needs no sign-in (RFC 8058): a link signed with an HMAC
 *   of the member's id (`unsubscribe`).
 * - A library with no concepts gets no email.
 */

import { isStale } from "@librocat/core/format";
import { THESAURUS_ID } from "@librocat/core/library";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import { sendEmail } from "./email";
import { authUserId } from "./identity";
import { ROUND_PAGE } from "./libro";
import { pausedIn } from "./membership";
import { openCount, paidFeatures, type Scan, scanConcepts, scannedNote } from "./model";
import { questionsSince, summarize } from "./reference";
import { hmac, sameToken } from "./signing";
import { unreadSources } from "./sources";
import { requireWorkspace } from "./workspaces";

const DAY = 86_400_000;
/** Between one library's report and the next on Monday (reportAll). */
export const REPORT_SPACING_MS = 500;

export type Report = {
  from: number;
  to: number;
  /** A week on paid plans; on Free, the month since its last report (reportAll). */
  period: "week" | "month";
  concepts: number;
  /** The newest five's titles, and their ids in the same order (Home links them). */
  added: { count: number; titles: string[]; ids: string[] };
  updated: number;
  stale: { count: number; ids: string[] };
  shelf: { open: number };
  reading: {
    read_this_week: number;
    never_read: number;
    most: { id: string; title: string; retrievals: number }[];
  };
  questions: {
    asked: number;
    found_nothing: number;
    unanswered: { text: string; count: number }[];
    frequent: { text: string; count: number; answer: string | null }[];
  };
  /** The reading list: kept sources no concept cites yet. */
  unread_sources: { count: number; titles: string[] };
  /** Set when the library is bigger than one pass reads: what the counts covered. */
  covered?: string;
};

/**
 * The previous month's first Monday, at `now`'s time of day: when Free's last
 * report went out (reportAll sends it on the month's first Monday). Pure.
 */
export function previousFirstMonday(now: number): number {
  const d = new Date(now);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) + (now % DAY);
  return first + ((8 - new Date(first).getUTCDay()) % 7) * DAY;
}

/**
 * The week in a library, ending `now`; on Free, the month since its last
 * report. The Overview passes what it already read: a pass over the concepts,
 * and the questions since at least a week ago.
 */
export async function buildReport(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  now = Date.now(),
  given: { scan?: Scan; questions?: Doc<"questions">[] } = {},
): Promise<Report> {
  const period = paidFeatures(ws.plan) ? "week" : "month";
  const from = period === "week" ? now - 7 * DAY : previousFirstMonday(now);
  // The week's news is in what changed lately: one capped pass, newest first.
  const scan = given.scan ?? (await scanConcepts(ctx, ws, "recent"));
  const docs = scan.docs.filter((d) => d.cid !== THESAURUS_ID);
  const live = docs.filter((d) => d.status !== "deprecated");
  const added = docs
    .filter((d) => d._creationTime >= from)
    .sort((a, b) => b._creationTime - a._creationTime);
  const stale = live.filter((d) =>
    isStale((d.frontmatter as Record<string, unknown> | undefined)?.stale_after, now),
  );
  const open = await openCount(ctx, ws._id);
  const week = given.questions
    ? given.questions.filter((q) => q._creationTime > from)
    : await questionsSince(ctx, ws._id, from);
  const asked = summarize(week, 5);
  return {
    from,
    to: now,
    period,
    concepts: scan.whole ? live.length : ws.conceptCount,
    added: {
      count: added.length,
      titles: added.slice(0, 5).map((d) => d.title || d.cid),
      ids: added.slice(0, 5).map((d) => d.cid),
    },
    updated: docs.filter((d) => d._creationTime < from && (d.updatedAt ?? 0) >= from).length,
    stale: { count: stale.length, ids: stale.slice(0, 5).map((d) => d.cid) },
    shelf: { open },
    reading: {
      read_this_week: docs.filter((d) => (d.lastAccessedAt ?? 0) >= from).length,
      never_read: live.filter((d) => !d.accessCount).length,
      most: docs
        .filter((d) => (d.accessCount ?? 0) > 0)
        .sort((a, b) => (b.accessCount ?? 0) - (a.accessCount ?? 0))
        .slice(0, 3)
        .map((d) => ({ id: d.cid, title: d.title || d.cid, retrievals: d.accessCount ?? 0 })),
    },
    questions: {
      asked: asked.asked,
      found_nothing: asked.found_nothing,
      unanswered: asked.unanswered.map(({ text, count }) => ({ text, count })),
      frequent: asked.frequent.slice(0, 3),
    },
    unread_sources: await unreadSources(ctx, ws._id),
    ...(scan.whole
      ? {}
      : { covered: scannedNote(ws, "the most recently changed", scan.docs.length) }),
  };
}

// ---- the email ------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The report as an email: a subject that says what matters, text, and HTML. Pure. */
export function renderReport(
  r: Report,
  opts: { library: string; dashboardUrl: string; unsubscribeUrl: string },
) {
  const headline = [
    r.added.count && plural(r.added.count, "new concept"),
    r.stale.count && `${r.stale.count} past ${r.stale.count === 1 ? "its" : "their"} review date`,
    r.questions.unanswered.length && plural(r.questions.unanswered.length, "unanswered question"),
  ].filter(Boolean);
  const subject = headline.length
    ? `Libro's report: ${headline.join(", ")}`
    : `Libro's report: your library this ${r.period}`;

  const sections: { title: string; lines: string[] }[] = [
    {
      title: `This ${r.period}`,
      lines: [
        r.added.count
          ? `${plural(r.added.count, "new concept")}: ${r.added.titles.map((t) => `"${t}"`).join(", ")}`
          : "No new concepts.",
        ...(r.updated ? [`${plural(r.updated, "concept")} updated.`] : []),
        `${plural(r.reading.read_this_week, "concept")} read by your agents, of ${r.concepts}.`,
      ],
    },
    {
      title: "Needs you",
      lines: [
        ...(r.stale.count
          ? [`${plural(r.stale.count, "concept")} past the review date: ${r.stale.ids.join(", ")}`]
          : []),
        r.shelf.open
          ? `${plural(r.shelf.open, "thing")} need${r.shelf.open === 1 ? "s" : ""} you, in the Library's Needs you.`
          : "Nothing needs you.",
      ],
    },
    {
      title: "What your agents asked",
      lines: r.questions.asked
        ? [
            `${plural(r.questions.asked, "question")}, ${r.questions.found_nothing} found no answer.`,
            ...r.questions.unanswered.map(
              (q) => `No answer yet: "${q.text}"${q.count > 1 ? ` (asked ${q.count} times)` : ""}`,
            ),
            ...r.questions.frequent.map(
              (q) =>
                `Asked most: "${q.text}" (${q.count} times)${q.answer ? `, answered by ${q.answer}` : ""}`,
            ),
          ]
        : [`No questions this ${r.period}.`],
    },
  ];
  if (r.unread_sources.count) {
    sections.push({
      title: "Missing",
      lines: [
        `${plural(r.unread_sources.count, "file")} no concept cites yet: ` +
          `${r.unread_sources.titles.map((t) => `"${t}"`).join(", ")}. Ask your agent to write ` +
          "concepts from them.",
      ],
    });
  }
  if (r.reading.most.length) {
    sections.push({
      title: "Read most",
      lines: r.reading.most.map((m) => `${m.title} (${plural(m.retrievals, "retrieval")})`),
    });
  }
  if (r.covered) sections.push({ title: "Counted over", lines: [r.covered] });

  const text = [
    `Libro's report for ${opts.library}`,
    "",
    ...sections.flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l}`), ""]),
    `Open the library: ${opts.dashboardUrl}`,
    "",
    `You get this because you keep this library. Stop these emails: ${opts.unsubscribeUrl}`,
  ].join("\n");

  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#141B26">`,
    `<p style="font-family:ui-monospace,monospace;color:#1F744F">librocat · Libro's report</p>`,
    `<h1 style="font-size:20px">${esc(opts.library)}</h1>`,
    ...sections.map(
      (s) =>
        `<h2 style="font-size:15px;margin-top:20px">${esc(s.title)}</h2><ul>${s.lines
          .map((l) => `<li>${esc(l)}</li>`)
          .join("")}</ul>`,
    ),
    `<p><a href="${esc(opts.dashboardUrl)}" style="color:#1F744F">Open the library</a></p>`,
    `<p style="font-size:12px;color:#6b7280">You get this because you keep this library. `,
    `<a href="${esc(opts.unsubscribeUrl)}" style="color:#6b7280">Stop these emails</a>.</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}

// ---- unsubscribe tokens -----------------------------------------------------

/** The unsubscribe token for a member: HMAC-SHA256, domain-separated, base64url. */
export const unsubscribeToken = (memberId: string, secret: string): Promise<string> =>
  hmac(secret, `librocat report unsubscribe ${memberId}`);

const siteUrl = () => (process.env.SITE_URL ?? "https://librocat.com").replace(/\/$/, "");

/** Whether a member gets the email: their choice, or on for admins by default. */
const wantsEmail = (m: Doc<"members">) => m.reportEmail ?? m.role === "admin";

/** The signed-in user's membership row in this workspace (a user has one or two). */
async function memberOf(ctx: QueryCtx, userId: string, ws: Id<"workspaces">) {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.find((m) => m.workspaceId === ws) ?? null;
}

// ---- functions ------------------------------------------------------------------

/** Whether the signed-in member gets the report by email (the switch in Settings › Account). */
export async function reportEmail(ctx: QueryCtx, ws: Doc<"workspaces">): Promise<boolean> {
  const userId = await authUserId(ctx);
  const me = userId ? await memberOf(ctx, userId, ws._id) : null;
  return me ? wantsEmail(me) : false;
}

/** The signed-in member's choice for the library the dashboard shows (Settings › Account). */
export const myReportEmail = query({
  args: {},
  handler: async (ctx) => await reportEmail(ctx, await requireWorkspace(ctx)),
});

/** Turn the weekly email on or off for the signed-in member. */
export const setReportEmail = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const ws = await requireWorkspace(ctx);
    const userId = await authUserId(ctx);
    const me = userId ? await memberOf(ctx, userId, ws._id) : null;
    if (!me) throw new Error("not a member of this library");
    await ctx.db.patch(me._id, { reportEmail: enabled });
    return { email: enabled };
  },
});

/** One-click unsubscribe from the email's link: no sign-in, the signed token is the proof. */
export const unsubscribe = mutation({
  args: { member: v.string(), token: v.string() },
  handler: async (ctx, { member, token }) => {
    const secret = process.env.BETTER_AUTH_SECRET;
    const id = ctx.db.normalizeId("members", member);
    if (!secret || !id) return { ok: false };
    if (!sameToken(await unsubscribeToken(id, secret), token)) return { ok: false };
    if (await ctx.db.get(id)) await ctx.db.patch(id, { reportEmail: false });
    return { ok: true };
  },
});

/**
 * Monday's round: one send per library with anything in it, each in its own
 * action. A Free library's comes on the month's first Monday; paid plans (and
 * a self-hosted librocat) get it every week. The Overview shows it live.
 */
export const reportAll = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    /** Reports the round's earlier pages scheduled, so the spacing goes on. */
    scheduled: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, scheduled: before = 0 }) => {
    const firstMonday = new Date().getUTCDate() <= 7;
    // A page at a time: a mutation may schedule at most 1,000 functions (libro.ts ROUND_PAGE).
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: ROUND_PAGE, cursor: cursor ?? null });
    let scheduled = before;
    for (const ws of page.page) {
      if (ws.conceptCount === 0) continue;
      if (!firstMonday && !paidFeatures(ws.plan)) continue;
      // A little apart: Resend takes 10 requests a second, and a library may have several people.
      await ctx.scheduler.runAfter(
        (scheduled - before) * REPORT_SPACING_MS,
        internal.report.sendReport,
        {
          workspaceId: ws._id,
        },
      );
      scheduled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        (scheduled - before) * REPORT_SPACING_MS,
        internal.report.reportAll,
        {
          cursor: page.continueCursor,
          scheduled,
        },
      );
    }
    return { scheduled };
  },
});

/** The report and who should get it (member id and email address). */
export const reportData = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const recipients: { memberId: Id<"members">; email: string }[] = [];
    // Not to someone paused in it (membership.ts pausedIn): they can't open it.
    for (const m of members.filter((m) => wantsEmail(m) && !pausedIn(ws, m.userId))) {
      const user = await authComponent.getAnyUserById(ctx, m.userId);
      if (user?.email) recipients.push({ memberId: m._id, email: user.email });
    }
    // Nobody wants it: no report to build.
    if (recipients.length === 0) return { library: ws.name, report: null, recipients };
    return { library: ws.name, report: await buildReport(ctx, ws), recipients };
  },
});

/** A member's unsubscribe link (for the email, and for tests). */
export const unsubscribeLink = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (_ctx, { memberId }) => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) return null;
    const token = await unsubscribeToken(memberId, secret);
    return `${siteUrl()}/api/unsubscribe?m=${memberId}&t=${token}`;
  },
});

type Data = {
  library: string;
  report: Report | null;
  recipients: { memberId: Id<"members">; email: string }[];
};

/** Send one library's report to everyone who wants it. */
export const sendReport = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<{ sent: number; subject: string | null }> => {
    const data: Data | null = await ctx.runQuery(internal.report.reportData, { workspaceId });
    if (!data?.report || data.report.concepts === 0) return { sent: 0, subject: null };
    const report = data.report;
    let sent = 0;
    let subject: string | null = null;
    for (const r of data.recipients) {
      const unsubscribeUrl: string | null = await ctx.runQuery(internal.report.unsubscribeLink, {
        memberId: r.memberId,
      });
      // No signing secret, no way to unsubscribe: do not send.
      if (!unsubscribeUrl) continue;
      const email = renderReport(report, {
        library: data.library,
        dashboardUrl: `${siteUrl()}/dashboard/concepts?tab=review`,
        unsubscribeUrl,
      });
      subject = email.subject;
      try {
        await sendEmail({
          to: r.email,
          ...email,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        sent += 1;
      } catch (exc) {
        const error = exc instanceof Error ? exc.message : String(exc);
        console.warn(JSON.stringify({ report: { workspaceId, error } }));
      }
    }
    return { sent, subject };
  },
});
