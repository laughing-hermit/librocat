/**
 * The ready-reference file. Dana, _A Library Primer_, ch. XIII: "Many
 * questions come up again and again. Of these, and of the references which
 * answered them, notes should be kept." Every MCP `search` is a question put
 * to the library. It is logged with what it found and the concept the asker
 * opened next (its answer). Two things follow:
 *
 * - a question asked again gets its earlier answer first (`ready_reference`
 *   on that hit), saving the reader's time;
 * - a question that found nothing marks a gap in the collection: something
 *   agents needed and nobody wrote down. Libro's report and the Overview show
 *   these gaps (convex/report.ts).
 *
 * Questions are grouped by their words (foldQuestion), so "rotate the Stripe
 * keys" and "Stripe key: rotate" are one question. Filing one calls no
 * model: it is part of the search's own transaction.
 *
 * Questions are kept RETENTION_DAYS (the privacy page says so); a question
 * that looks like it carries a secret is never kept.
 */

import { findSecret } from "@librocat/core/format";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { takeUpTo } from "./size";

export const RETENTION_DAYS = 90;
const DAY = 86_400_000;
/** An answer is the first result the same asker opens this soon after asking. */
const ANSWER_WINDOW_MS = 10 * 60_000;
const MAX_TEXT = 300;
const KEEP_RESULTS = 5;

/** Who asked: the signed-in person, and the agent they asked through. */
export type Asker = { userId?: string; client?: string };

const STOPWORDS = new Set(
  (
    "a an and any are as at be by can could do does for from get how i if in into is it its " +
    "me my of on or our please should so tell that the their there these this to use using " +
    "was we what when where which who why will with would you your"
  ).split(" "),
);

/**
 * A question's grouping key: its content words, lowercased, plural "s"
 * dropped, deduplicated, and sorted, so "rotate the Stripe keys" and "Stripe
 * key: rotate" are one question. Pure, exported for tests.
 */
export function foldQuestion(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  const key = [...new Set(words)].sort().join(" ");
  return key || text.trim().toLowerCase().slice(0, MAX_TEXT);
}

/** Log one question. Returns its id, or null when it is not kept. */
export async function logQuestion(
  ctx: MutationCtx,
  ws: Id<"workspaces">,
  text: string,
  results: string[],
  asker: Asker,
): Promise<Id<"questions"> | null> {
  const t = text.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
  // Never keep a credential, even one pasted into a search.
  if (!t || findSecret(t)) return null;
  return await ctx.db.insert("questions", {
    workspaceId: ws,
    text: t,
    key: foldQuestion(t),
    hits: results.length,
    results: results.slice(0, KEEP_RESULTS),
    ...(asker.userId ? { userId: asker.userId } : {}),
    ...(asker.client ? { client: asker.client } : {}),
  });
}

/**
 * The asker opened `cid`: if it was among the results of their question in
 * the last few minutes, it is that question's answer (the first one opened).
 */
export async function linkAnswer(
  ctx: MutationCtx,
  ws: Id<"workspaces">,
  cid: string,
  asker: Asker,
): Promise<void> {
  const recent = await ctx.db
    .query("questions")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", ws).gt("_creationTime", Date.now() - ANSWER_WINDOW_MS),
    )
    .order("desc")
    .take(20);
  const asked = recent.find(
    (r) => r.userId === asker.userId && r.client === asker.client && r.results.includes(cid),
  );
  if (asked && !asked.answeredBy) await ctx.db.patch(asked._id, { answeredBy: cid });
}

/**
 * The concept that most often answered this question before, if any, over
 * the last 50 questions filed under its key (foldQuestion): the same words,
 * asked in any order, get the same answer.
 */
export async function readyReference(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  key: string,
): Promise<string | null> {
  const past = await ctx.db
    .query("questions")
    .withIndex("by_workspace_key", (q) => q.eq("workspaceId", ws).eq("key", key))
    .order("desc")
    .take(50);
  const votes = new Map<string, number>();
  for (const p of past)
    if (p.answeredBy) votes.set(p.answeredBy, (votes.get(p.answeredBy) ?? 0) + 1);
  let best: string | null = null;
  for (const [cid, n] of votes) if (best === null || n > (votes.get(best) ?? 0)) best = cid;
  return best;
}

/** Put the earlier answer first, marked, when the search found it again. Pure. */
export function promote<T extends { id: string }>(
  hits: T[],
  cid: string,
): (T & { ready_reference?: true })[] {
  const i = hits.findIndex((h) => h.id === cid);
  if (i < 0) return hits;
  const hit = hits[i] as T;
  return [{ ...hit, ready_reference: true as const }, ...hits.slice(0, i), ...hits.slice(i + 1)];
}

// ---- reading the file ---------------------------------------------------------

type Row = {
  text: string;
  key: string;
  hits: number;
  answeredBy?: string;
  _creationTime: number;
};

/** Found no answer: the search found nothing at all. */
export const unanswered = (r: { hits: number }) => r.hits === 0;

/**
 * What the questions show: the ones asked most (and what answered them) and
 * the ones whose latest asking found no answer (the gaps). Pure, exported
 * for tests; rows in any order.
 */
export function summarize(rows: Row[], limit = 10) {
  const groups = new Map<
    string,
    {
      key: string;
      text: string;
      count: number;
      last: number;
      gap: boolean;
      answers: Map<string, number>;
    }
  >();
  for (const r of [...rows].sort((a, b) => a._creationTime - b._creationTime)) {
    const g = groups.get(r.key) ?? {
      key: r.key,
      text: r.text,
      count: 0,
      last: 0,
      gap: false,
      answers: new Map<string, number>(),
    };
    g.count += 1;
    g.text = r.text;
    g.last = r._creationTime;
    g.gap = unanswered(r);
    if (r.answeredBy) g.answers.set(r.answeredBy, (g.answers.get(r.answeredBy) ?? 0) + 1);
    groups.set(r.key, g);
  }
  const all = [...groups.values()];
  const byCount = (a: { count: number; last: number }, b: { count: number; last: number }) =>
    b.count - a.count || b.last - a.last;
  const topAnswer = (answers: Map<string, number>) =>
    [...answers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    asked: rows.length,
    distinct: groups.size,
    found_nothing: rows.filter(unanswered).length,
    answered: rows.filter((r) => r.answeredBy).length,
    frequent: all
      .filter((g) => g.count >= 2)
      .sort(byCount)
      .slice(0, limit)
      .map((g) => ({ text: g.text, count: g.count, answer: topAnswer(g.answers) })),
    unanswered: all
      .filter((g) => g.gap)
      .sort(byCount)
      .slice(0, limit)
      .map((g) => ({ key: g.key, text: g.text, count: g.count, last_asked: g.last })),
  };
}

/** The workspace's questions since `since`, newest first: at most 1,000, and about 2 MB. */
export async function questionsSince(ctx: QueryCtx, ws: Id<"workspaces">, since: number) {
  // ponytail: capped read; a maintained aggregate if a library asks more than this a month.
  const { docs } = await takeUpTo(
    ctx.db
      .query("questions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws).gt("_creationTime", since))
      .order("desc"),
    1_000,
    2_000_000,
  );
  return docs;
}

/** Forget questions older than RETENTION_DAYS, in batches. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_DAYS * DAY;
    const old = await ctx.db
      .query("questions")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(500);
    for (const q of old) await ctx.db.delete(q._id);
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.reference.prune, {});
    return { questions: old.length };
  },
});
