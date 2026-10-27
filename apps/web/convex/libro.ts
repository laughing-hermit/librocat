/**
 * Libro: librocat's librarian, a cat. Libro is library rules and one cheap
 * model, Jev, and it writes nothing: the person's own agent does the writing
 * (merges, descriptions), which it does better.
 *
 * The mechanical pass needs no model: once a week per workspace it reads the
 * library and puts proposals on a review shelf:
 *
 *   supersede  two live concepts carry the same title: the older is
 *              superseded by the newer.
 *   deprecate  a stable concept already carries `superseded_by`, or is old and
 *              was never retrieved: retire it.
 *   synonym    two tags are spellings of one another (plural, hyphen,
 *              underscore, space): file the rarer under the common one in the
 *              thesaurus.
 *
 * After each review, Jev (a model, but a cheap judgment, not generation)
 * screens the library: pairs that say the same thing (pairsScreen), from
 * concepts that share a shelf and tags or title words, and from each
 * concept written since the last review and its nearest by words on any
 * shelf; and what is tied to a date, a version, a
 * price, or a person, for a review date (datesScreen); and tags that mean
 * the same thing though they are spelled apart, `k8s` and `kubernetes`, for a
 * synonym (synonymsScreen). A `gap` proposal (a
 * concept a question that found no answer is about) came from the screens
 * by meaning, until 2026-10-20: the ones still on a shelf are decided as
 * before.
 *
 * The person's own agent works the shelf with them, through the MCP tools
 * `review_shelf`, `propose` (a merge with its draft, which Jev checks), and
 * `decide` (convex/mcp.ts; the knowledge-review skill says how).
 *
 * What Jev does, and what it leaves to the agent: Jev takes work that runs
 * unattended (the review, crons, the source watch), that is a bounded
 * judgment (a probability or a choice, never new text), and that is capped
 * per run or metered. The person's own agent does the writing, the reading
 * of files, the reasoning in several steps, the talking with the person, and
 * the judgments made at write time (`possible_duplicates` on `ingest`), at no
 * cost to librocat. So there is no Jev call per search or per write.
 *
 * Libro proposes, a person decides: nothing changes until a member approves,
 * on the dashboard or through their agent, and every approval is a revision
 * by the proposal's author (`by: "libro"`, or the agent that filed it).
 */

import { assertNoSecrets, isStale, reviewDate, staleAfterOf, stem } from "@librocat/core/format";
import { THESAURUS_ID, type Thesaurus } from "@librocat/core/library";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
} from "./_generated/server";
import { hasAi } from "./ai";
import { type Evaluation, evaluate, type Question, yes } from "./jev";
import {
  bodyOf,
  fileProposal,
  getByCid,
  getConcept,
  MAX_BODY_BYTES,
  OPEN_COUNTED,
  paidFeatures,
  retag,
  scanConcepts,
  setTerm,
  thesaurusOf,
  update,
  type Writer,
  wordNeighbors,
} from "./model";
import { authUserId, requireWritableWorkspace } from "./workspaces";

const KINDS = ["supersede", "deprecate", "synonym", "merge", "stale", "date", "gap"] as const;
type Kind = (typeof KINDS)[number];
type Draft = { title?: string; description?: string; tags?: string[]; body?: string };
type Proposal = { kind: Kind; subject: string; target?: string; reason: string; draft?: Draft };

/** Never-retrieved concepts older than this are pulled for review. */
const NEVER_RETRIEVED_DAYS = 90;

/** Fold a title or tag to a comparison key: lowercase, no punctuation, no plural s. */
export function foldKey(text: string): string {
  const k = text
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  return k.endsWith("s") && k.length > 3 ? k.slice(0, -1) : k;
}

/** Compute the shelf for a workspace from its concepts. Pure, so tests can call it. */
export function proposalsFor(
  docs: Pick<
    Doc<"concepts">,
    "cid" | "title" | "status" | "tags" | "frontmatter" | "_creationTime" | "lastAccessedAt"
  >[],
  preferredTags: Set<string>,
  now = Date.now(),
): Proposal[] {
  const out: Proposal[] = [];
  const live = docs.filter((d) => d.cid !== THESAURUS_ID);

  // supersede: the same folded title on two live concepts. (Not the file
  // name: readme, overview, and index recur on every shelf by design.)
  const byTitle = new Map<string, typeof live>();
  for (const d of live) {
    if (d.status === "deprecated" || !d.title) continue;
    const k = foldKey(d.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), d]);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a._creationTime - b._creationTime);
    const newest = sorted[sorted.length - 1];
    for (const older of sorted.slice(0, -1)) {
      out.push({
        kind: "supersede",
        subject: older.cid,
        target: newest.cid,
        reason: `Same title as ${newest.cid}, which is newer.`,
      });
    }
  }

  // stale: past its own review date (OKF stale_after). The date is the
  // target, so a concept verified and later overdue again comes back.
  for (const d of live) {
    if (d.status === "deprecated") continue;
    const fm = (d.frontmatter ?? {}) as Record<string, unknown>;
    if (!isStale(fm.stale_after, now)) continue;
    const date = staleAfterOf(fm) as string;
    out.push({
      kind: "stale",
      subject: d.cid,
      target: date,
      reason: `Its review date, ${humanDate(date.slice(0, 10))}, has passed. Still true?`,
    });
  }

  // deprecate: stable but superseded, or old and never retrieved.
  const cutoff = now - NEVER_RETRIEVED_DAYS * 86_400_000;
  for (const d of live) {
    if (d.status === "deprecated") continue;
    const fm = (d.frontmatter ?? {}) as Record<string, unknown>;
    if (fm.supersededBy) {
      out.push({
        kind: "deprecate",
        subject: d.cid,
        reason: `Superseded by ${String(fm.supersededBy)} but still ${d.status}.`,
      });
    } else if (d._creationTime < cutoff && (!d.lastAccessedAt || d.lastAccessedAt < cutoff)) {
      out.push({
        kind: "deprecate",
        subject: d.cid,
        reason: `Never retrieved in ${NEVER_RETRIEVED_DAYS} days.`,
      });
    }
  }

  // synonym: two tags with the same folded key; the more frequent (or the
  // preferred one) is the target.
  const count = new Map<string, number>();
  for (const d of live) for (const t of d.tags) count.set(t, (count.get(t) ?? 0) + 1);
  const byFold = new Map<string, string[]>();
  for (const t of count.keys()) byFold.set(foldKey(t), [...(byFold.get(foldKey(t)) ?? []), t]);
  for (const tags of byFold.values()) {
    if (tags.length < 2) continue;
    const ranked = [...tags].sort((a, b) => {
      const pa = preferredTags.has(a) ? 1 : 0;
      const pb = preferredTags.has(b) ? 1 : 0;
      return pb - pa || (count.get(b) ?? 0) - (count.get(a) ?? 0) || a.localeCompare(b);
    });
    const preferred = ranked[0];
    for (const other of ranked.slice(1)) {
      // Two preferred tags are distinct on purpose; the thesaurus would refuse the fold.
      if (preferredTags.has(other)) continue;
      out.push({
        kind: "synonym",
        subject: other,
        target: preferred,
        reason: `"${other}" reads as "${preferred}": ${usedOn(count.get(other) ?? 0, count.get(preferred) ?? 0)}.`,
      });
    }
  }
  return out;
}

/** Run the review for one workspace and file new proposals. Returns how many are new. */
async function reviewWorkspace(ctx: MutationCtx, ws: Doc<"workspaces">): Promise<number> {
  // What changed lately, at most SCAN: a library bigger than one pass is
  // reviewed where it moves.
  const { docs } = await scanConcepts(ctx, ws, "recent");
  const th = await thesaurusOf(ctx, ws._id);
  const preferred = new Set(Object.keys(th));
  let added = 0;
  for (const p of proposalsFor(docs, preferred)) {
    if (await fileProposal(ctx, ws._id, p, "libro")) added += 1;
  }
  return added;
}

/** Apply an approved proposal. Every change is one revision by its proposer. */
async function applyProposal(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  p: Doc<"proposals">,
  date?: string,
) {
  // The proposal's author writes it: Libro, or the agent that filed it.
  const by: Writer = { by: p.by ?? "libro", userId: p.userId, client: p.client };
  if (p.kind === "supersede") {
    if (!p.target) throw new Error("supersede needs a target");
    await update(ctx, ws, p.subject, { superseded_by: p.target }, by);
    return;
  }
  // A suggested review date becomes the concept's OKF stale_after, or the
  // date the person picked instead.
  if (p.kind === "date") {
    const target = date ?? p.target;
    if (!target) throw new Error("date needs a target");
    await update(ctx, ws, p.subject, { stale_after: target }, by);
    return;
  }
  // "Mark stale": its review date is today, so every read says `stale`
  // until someone verifies or updates it.
  if (p.kind === "gap") {
    await update(ctx, ws, p.subject, { stale_after: reviewDate(Date.now(), 0) }, by);
    return;
  }
  // Approving a stale proposal retires the concept; "verify" (decide) keeps it.
  if (p.kind === "deprecate" || p.kind === "stale") {
    await update(ctx, ws, p.subject, { status: "deprecated" }, by);
    return;
  }
  if (p.kind === "merge") {
    if (!p.target) throw new Error("merge needs a target");
    // Rewrite the target with Libro's draft, then supersede the subject.
    await update(ctx, ws, p.target, { ...(p.draft ?? {}) }, by);
    await update(ctx, ws, p.subject, { superseded_by: p.target }, by);
    return;
  }
  // synonym: file `subject` under `target` as a use-for term, and retag the
  // concepts that carry it, so the fold applies to the library, not only to
  // future writes.
  if (!p.target) throw new Error("synonym needs a target");
  const th = await thesaurusOf(ctx, ws._id);
  const term = th[p.target] ?? {};
  await setTerm(
    ctx,
    ws,
    p.target,
    { ...term, use_for: [...new Set([...(term.use_for ?? []), p.subject])] },
    by,
  );
  const { more } = await retag(ctx, ws._id, p.subject, p.target);
  if (more) {
    await ctx.scheduler.runAfter(0, internal.libro.retagMore, {
      workspaceId: ws._id,
      from: p.subject,
      to: p.target,
    });
  }
}

/** The rest of a big retag, a page a transaction (model.ts RETAG_PAGE). */
export const retagMore = internalMutation({
  args: { workspaceId: v.id("workspaces"), from: v.string(), to: v.string() },
  handler: async (ctx, { workspaceId, from, to }) => {
    if (!(await ctx.db.get(workspaceId))) return;
    const { more } = await retag(ctx, workspaceId, from, to);
    if (more) await ctx.scheduler.runAfter(0, internal.libro.retagMore, { workspaceId, from, to });
  },
});

/**
 * "Review now" and the weekly cron share one cooldown, timestamped on the
 * workspace (`libroRunAt`): Jev's screens cost a little each, so a review can
 * start at most once an hour, however often the button is pressed.
 */
const RUN_COOLDOWN_MS = 60 * 60 * 1_000;

/** A ConvexError, so the dashboard can tell "too soon" from a failure (dashboard/libro/actions.ts). */
function cooldownError(ws: Doc<"workspaces">): ConvexError<string> | null {
  if (!ws.libroRunAt) return null;
  const retryAt = ws.libroRunAt + RUN_COOLDOWN_MS;
  if (Date.now() >= retryAt) return null;
  return new ConvexError(
    `Libro just ran for this workspace — try again at ${new Date(retryAt).toISOString()}.`,
  );
}

/**
 * Libraries one run of the weekly round schedules: a mutation may schedule
 * at most 1,000 functions, so the round goes a page at a time (`cursor`).
 */
export const ROUND_PAGE = 200;
/** Between one library's review and the next, so the round doesn't crowd out uploads and cataloging. */
const REVIEW_SPACING_MS = 250;

/**
 * Weekly cron: one review mutation per workspace, so each runs in its own
 * transaction (Convex caps what one mutation may read), a little apart, a
 * page of libraries per run.
 */
export const reviewAll = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: ROUND_PAGE, cursor: cursor ?? null });
    for (const [i, ws] of page.page.entries()) {
      await ctx.scheduler.runAfter(i * REVIEW_SPACING_MS, internal.libro.reviewOne, {
        workspaceId: ws._id,
      });
    }
    // The next page once this one's reviews have started.
    if (!page.isDone) {
      await ctx.scheduler.runAfter(page.page.length * REVIEW_SPACING_MS, internal.libro.reviewAll, {
        cursor: page.continueCursor,
      });
    }
    return { scheduled: page.page.length };
  },
});

/** An idle Free library is still reviewed this often, for concepts nobody reads. */
const IDLE_REVIEW_MS = 28 * 86_400_000;

/**
 * Free is reviewed weekly while the library is being written, and every 28
 * days while it sits idle, so idle libraries cost almost nothing and
 * never-read concepts still reach the shelf.
 */
async function freeReviewDue(ctx: MutationCtx, ws: Doc<"workspaces">): Promise<boolean> {
  const last = ws.libroRunAt ?? 0;
  if (Date.now() - last >= IDLE_REVIEW_MS) return true;
  const written = await ctx.db
    .query("revisions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id).gt("_creationTime", last))
    .first();
  return written !== null;
}

export const reviewOne = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return { proposals: 0 };
    const free = !paidFeatures(ws.plan);
    if (free && !(await freeReviewDue(ctx, ws))) return { proposals: 0, skipped: true };
    // The cron is what the cooldown is measured against, so it always runs
    // regardless of any prior "Review now" click — only the dashboard
    // button is refused, never the weekly pass itself.
    await ctx.db.patch(ws._id, { libroRunAt: Date.now() });
    const proposals = await reviewWorkspace(ctx, ws);
    await scheduleScreens(ctx, ws);
    if (!free) {
      // Source watch: fetch again the kept pages concepts cite (convex/fetching.ts).
      await ctx.scheduler.runAfter(0, internal.fetching.watch, { workspaceId: ws._id });
    }
    return { proposals };
  },
});

// ---- Jev screening --------------------------------------------------------
//
// After each review, on every plan with Jev: code finds pairs of concepts
// that might say the same thing, two ways, and Jev, in one cheap typed
// request, confirms which do. Within a shelf, pairs that share tags or most
// of a title. Across the library, each concept written or changed since the
// last review and its nearest by words (model.ts wordNeighbors: the catalog
// index, stemmed and through the thesaurus), which finds a rewording on
// another shelf that no title comparison would. Confirmed pairs go on the
// review shelf as supersede proposals, like the mechanical ones. Merging two
// of them is writing, so it is the person's agent's: it reads both and files
// a merge with its draft (convex/mcp.ts `propose`).

const SCREEN_PAIRS = 20;
/** Concepts written since the last review that look up their neighbors, newest first. */
const SCREEN_RECENT = 50;
/** Neighbors by words each of those concepts looks up. */
const SCREEN_NEIGHBORS = 5;
export const SAME = 0.85;

/** One side of a pair as Jev reads it. */
export type ScreenConcept = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  created: number;
};

export type ScreenPair = { older: ScreenConcept; newer: ScreenConcept };

/** Jev's question for each pair: one subject, so a reader needs only one? Pure. */
export function sameSubjectQuestions(n: number): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (let i = 0; i < n; i++) {
    questions[`same${i}`] = {
      type: "boolean",
      instructions: `Do \`pairs[${i}].older\` and \`pairs[${i}].newer\` describe the same thing, so a reader needs only one of them?`,
      criteria: {
        true: "the same subject: one duplicates, restates, or is an earlier version of the other",
        false: "related, but distinct subjects that both deserve a concept",
      },
    };
  }
  return questions;
}

/**
 * Ask Jev which pairs are one subject: the ones it is sure of (SAME), or
 * null when Jev could not be asked (the pair screen below).
 */
export async function sameSubject(
  pairs: ScreenPair[],
  plan?: string,
): Promise<{ older: string; newer: string; p: number }[] | null> {
  if (pairs.length === 0) return [];
  const e = await evaluate({ pairs }, sameSubjectQuestions(pairs.length), plan);
  if (!e) return null;
  return pairs
    .map((pair, i) => ({ older: pair.older.id, newer: pair.newer.id, p: yes(e, `same${i}`) }))
    .filter((x) => x.p >= SAME);
}

const titleWords = (t: string) =>
  new Set(
    foldKey(t)
      .split(" ")
      .filter((w) => w.length > 2),
  );

/** What a pair shares: two or more tags, or most of a title's words. 0 is nothing. Pure. */
export function overlap(
  a: Pick<Doc<"concepts">, "title" | "tags">,
  b: Pick<Doc<"concepts">, "title" | "tags">,
): number {
  const sharedTags = a.tags.filter((t) => b.tags.includes(t)).length;
  const wa = titleWords(a.title ?? "");
  const wb = titleWords(b.title ?? "");
  const both = [...wa].filter((w) => wb.has(w)).length;
  const jaccard = wa.size + wb.size - both > 0 ? both / (wa.size + wb.size - both) : 0;
  return sharedTags >= 2 ? 1 + sharedTags : jaccard >= 0.5 ? jaccard : 0;
}

/** A candidate pair: what the two share, and, from the word index, the neighbor's rank (0 is nearest). */
export type Candidate<T> = { a: T; b: T; overlap: number; rank?: number };

/**
 * The candidates from both sources as one list, best first. A pair found
 * both ways is one candidate, with its best rank. A pair scores its overlap,
 * plus 1 / (1 + rank) when the word index found it: the nearest neighbor
 * counts as much as a title that shares all its words, and a pair that
 * shares tags and words comes before either alone. A pair with the same
 * folded title is left out: that one is the mechanical pass's
 * (proposalsFor). Pure.
 */
export function rankCandidates<T extends { cid: string; title?: string }>(
  candidates: Candidate<T>[],
): Candidate<T>[] {
  const byPair = new Map<string, Candidate<T>>();
  for (const c of candidates) {
    if (c.a.cid === c.b.cid) continue;
    if (c.a.title && c.b.title && foldKey(c.a.title) === foldKey(c.b.title)) continue;
    const key = [c.a.cid, c.b.cid].sort().join("\n");
    const seen = byPair.get(key);
    const rank =
      seen?.rank === undefined
        ? c.rank
        : c.rank === undefined
          ? seen.rank
          : Math.min(seen.rank, c.rank);
    byPair.set(key, { ...(seen ?? c), rank });
  }
  const score = (c: Candidate<T>) => c.overlap + (c.rank === undefined ? 0 : 1 / (1 + c.rank));
  return [...byPair.values()].filter((c) => score(c) > 0).sort((x, y) => score(y) - score(x));
}

/**
 * Candidate duplicate pairs (code only). `since` is when the last review
 * ran: the concepts changed after it look up their neighbors by words.
 * Every review compares within shelves again, so a run Jev missed (an
 * outage) leaves those pairs for the next one; a word-index pair comes back
 * when either concept changes.
 */
export const screenCandidates = internalQuery({
  args: { workspaceId: v.id("workspaces"), since: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, since = 0 }) => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return { pairs: [] };
    // Newest first (by_workspace_updated, descending).
    const docs = (await scanConcepts(ctx, ws, "recent")).docs.filter(
      (d) => d.cid !== THESAURUS_ID && d.status !== "deprecated",
    );
    const shelfOf = (cid: string) => (cid.includes("/") ? cid.split("/")[0] : "");
    const candidates: Candidate<Doc<"concepts">>[] = [];
    // Within a shelf: every pair, the 200 most recently changed of each.
    const byShelf = new Map<string, Doc<"concepts">[]>();
    for (const d of docs) byShelf.set(shelfOf(d.cid), [...(byShelf.get(shelfOf(d.cid)) ?? []), d]);
    for (const shelf of byShelf.values()) {
      const group = shelf.slice(0, 200);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i] as Doc<"concepts">;
          const b = group[j] as Doc<"concepts">;
          const score = overlap(a, b);
          if (score > 0) candidates.push({ a, b, overlap: score });
        }
      }
    }
    // Across the library: what changed since the last review, and its
    // nearest by words. At most SCREEN_RECENT lookups of a few rows each.
    const th = await thesaurusOf(ctx, workspaceId);
    const recent = docs.filter((d) => (d.updatedAt ?? d._creationTime) > since);
    for (const a of recent.slice(0, SCREEN_RECENT)) {
      const near = await wordNeighbors(ctx, workspaceId, a, th, SCREEN_NEIGHBORS);
      for (const [rank, b] of near.entries())
        candidates.push({ a, b, overlap: overlap(a, b), rank });
    }
    const pairs: ScreenPair[] = [];
    // Bounded lookups: at most five candidates read per pair screened.
    for (const { a, b } of rankCandidates(candidates).slice(0, SCREEN_PAIRS * 5)) {
      if (pairs.length === SCREEN_PAIRS) break;
      const [older, newer] = a._creationTime <= b._creationTime ? [a, b] : [b, a];
      const known = await ctx.db
        .query("proposals")
        .withIndex("by_workspace_key", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("kind", "supersede")
            .eq("subject", older.cid)
            .eq("target", newer.cid),
        )
        .first();
      if (known) continue;
      const brief = (d: Doc<"concepts">): ScreenConcept => ({
        id: d.cid,
        title: d.title ?? "",
        description: d.description ?? "",
        tags: d.tags,
        created: d._creationTime,
      });
      pairs.push({ older: brief(older), newer: brief(newer) });
    }
    return { pairs };
  },
});

/** File the pairs Jev judged to be one subject, as supersede proposals by "libro". */
export const fileScreened = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    pairs: v.array(v.object({ older: v.string(), newer: v.string(), p: v.number() })),
  },
  handler: async (ctx, { workspaceId, pairs }) => {
    let filed = 0;
    for (const { older, newer, p } of pairs) {
      const reason = `Likely the same subject as ${newer}, which is newer (${Math.round(p * 100)}% sure).`;
      if (
        await fileProposal(
          ctx,
          workspaceId,
          { kind: "supersede", subject: older, target: newer, reason },
          "libro",
        )
      ) {
        filed += 1;
      }
    }
    return filed;
  },
});

/**
 * Jev's pair screen, after each review. It compares within shelves each
 * time and skips a pair already proposed, so a same-shelf pair Jev missed
 * (an outage) waits for the next review (screenCandidates).
 */
export const pairsScreen = internalAction({
  args: { workspaceId: v.id("workspaces"), since: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, since }): Promise<{ confirmed: number; retry?: boolean }> => {
    const { pairs } = await ctx.runQuery(internal.libro.screenCandidates, { workspaceId, since });
    if (pairs.length === 0) return { confirmed: 0 };
    const plan = await ctx.runQuery(internal.workspaces.planOf, { workspaceId });
    const same = await sameSubject(pairs, plan);
    if (same === null) return { confirmed: 0, retry: true };
    if (same.length === 0) return { confirmed: 0 };
    await ctx.runMutation(internal.libro.fileScreened, { workspaceId, pairs: same });
    return { confirmed: same.length };
  },
});

// ---- Review dates: what is tied to a date ---------------------------------
//
// Libro cannot see the world change, so a concept that states something tied
// to a date, a version, a price, or a person should carry a review date (OKF
// stale_after). After each review, Libro reads the concepts written or changed
// since it last looked, newest first. A date the concept writes out that has
// not passed yet needs no judgment: Libro proposes the day after it. For the
// rest Jev answers, in one typed request, which kinds of claim each one makes
// (a price, a version, an owner, a schedule), and code turns the soonest kind
// into a date. Yes/no questions are graded and answered more reliably than a
// choice among overlapping horizons. A person sets the date, picks another,
// or dismisses it, and a dismissed one stays dismissed. Every plan: it is Jev
// only.

/** Concepts read per review, and how sure Jev must be that one makes a kind of claim. */
const DATES_PER_RUN = 20;
export const KIND_SURE = 0.8;

/** Days to a review for each kind of claim, soonest first: a tie goes to the earlier. */
export const KIND_DAYS = { schedule: 30, price: 90, version: 90, owner: 182 } as const;
export type DateKind = keyof typeof KIND_DAYS;

/** Jev's question for each kind, and how a proposal's reason names it. */
const KINDS_ASKED: Record<DateKind, { asks: string; yes: string; no: string; reason: string }> = {
  schedule: {
    asks: "state a deadline, a sprint, a roadmap, or a plan for what happens next",
    yes: "yes: it says when something is due or planned to happen",
    no: "no: it names no deadline, sprint, roadmap, or plan",
    reason: "States a deadline or a plan",
  },
  price: {
    asks: "state a price, a quota, or a plan limit",
    yes: "yes: it gives what something costs, or how much of it is allowed",
    no: "no: it states no price, quota, or limit",
    reason: "States a price",
  },
  version: {
    asks: "name a software version or release that it depends on",
    yes: "yes: it names a version number or a release",
    no: "no: it names no version or release",
    reason: "Names a version",
  },
  owner: {
    asks: "name a person who owns, approves, or is responsible for something",
    yes: "yes: it names who owns, approves, or does something",
    no: "no: it names no person responsible for anything",
    reason: "Names an owner",
  },
};

/** One concept as Libro reads it for time-bound claims. */
type DatesConcept = { id: string; title: string; description: string; body: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;

/** An ISO date from its parts, or null when the day does not exist (February 30). */
function isoOf(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * The soonest date a concept writes out that has not passed yet (today
 * counts), as YYYY-MM-DD, or null. It reads ISO dates (2026-10-15), dates in
 * words (October 15, 2026; Oct 15 2026; 15 October 2026), and quarters (Q4
 * 2026, read as the quarter's last day). Pure.
 */
export function statedDate(text: string, now = Date.now()): string | null {
  const today = new Date(now).toISOString().slice(0, 10);
  const found: string[] = [];
  const add = (d: string | null) => {
    if (d && d >= today) found.push(d);
  };
  const month = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1;
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(isoOf(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  for (const m of text.matchAll(
    new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, "gi"),
  )) {
    add(isoOf(Number(m[3]), month(m[1] as string), Number(m[2])));
  }
  for (const m of text.matchAll(
    new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH},?\s+(\d{4})\b`, "gi"),
  )) {
    add(isoOf(Number(m[3]), month(m[2] as string), Number(m[1])));
  }
  for (const m of text.matchAll(/\bQ([1-4])\s+(\d{4})\b/gi)) {
    const q = Number(m[1]);
    // Day 0 of the next quarter's first month is this quarter's last day.
    add(new Date(Date.UTC(Number(m[2]), q * 3, 0)).toISOString().slice(0, 10));
  }
  return found.sort()[0] ?? null;
}

/** "Jan 19, 2027": the dashboard's date format (src/lib/utils.ts formatDate). Pure. */
export function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const name = MONTHS[(m ?? 1) - 1] as string;
  return `${name[0]?.toUpperCase()}${name.slice(1)} ${d}, ${y}`;
}

/** The day after an ISO date. Pure. */
export function dayAfter(iso: string): string {
  return new Date(Date.parse(iso) + 86_400_000).toISOString().slice(0, 10);
}

/** Jev's yes/no questions per concept: which kinds of time-bound claim it makes. Pure. */
export function datesQuestions(n: number): Record<string, Question> {
  const q: Record<string, Question> = {};
  for (let i = 0; i < n; i++) {
    for (const [kind, k] of Object.entries(KINDS_ASKED)) {
      q[`${kind}${i}`] = {
        type: "boolean",
        instructions: `Does \`concepts[${i}]\` ${k.asks}?`,
        criteria: { true: k.yes, false: k.no },
      };
    }
  }
  return q;
}

/**
 * For each concept, the soonest kind of claim Jev is sure it makes, and how
 * many days out to check it; none sure, no date. Pure.
 */
export function datesPicks(e: Evaluation, ids: string[]) {
  return ids.flatMap((id, i) => {
    for (const kind of Object.keys(KIND_DAYS) as DateKind[]) {
      const p = yes(e, `${kind}${i}`);
      if (p >= KIND_SURE) return [{ id, kind, days: KIND_DAYS[kind], p }];
    }
    return [];
  });
}

/** Why Libro proposes a review date, with the date once, as the dashboard writes it. Pure. */
export function dateReason(
  why: { stated: string } | { kind: DateKind; p: number },
  target: string,
): string {
  const ask = `Check it again by ${humanDate(target)}?`;
  if ("stated" in why) return `Says ${humanDate(why.stated)}. ${ask}`;
  return `${KINDS_ASKED[why.kind].reason} (Libro is ${Math.round(why.p * 100)}% sure). ${ask}`;
}

/** How many concepts each tag of a pair is on: "used on 1 concept each", "on 3 and 1 concepts". */
export function usedOn(a: number, b: number): string {
  if (a === b) return `used on ${a} concept${a === 1 ? "" : "s"} each`;
  return `used on ${a} and ${b} concepts`;
}

/** Whether a concept has an open proposal that would replace or retire it. */
async function aboutToGo(ctx: QueryCtx, workspaceId: Id<"workspaces">, cid: string) {
  for (const kind of ["supersede", "merge", "deprecate"] as const) {
    const open = await ctx.db
      .query("proposals")
      .withIndex("by_workspace_key", (q) =>
        q.eq("workspaceId", workspaceId).eq("kind", kind).eq("subject", cid),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (open) return true;
  }
  return false;
}

/**
 * What to read: live concepts with no review date, changed since Libro last
 * looked, newest first, never one already suggested (an open suggestion
 * waits for a person; a dismissed one stays dismissed). One about to be
 * replaced or retired is left for after that is decided.
 */
export const datesCandidates = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<DatesConcept[]> => {
    const changed = (d: Doc<"concepts">) => d.updatedAt ?? d._creationTime;
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return [];
    const due = (await scanConcepts(ctx, ws, "recent")).docs
      .filter(
        (d) =>
          d.cid !== THESAURUS_ID &&
          d.status !== "deprecated" &&
          !staleAfterOf(d.frontmatter as Record<string, unknown>) &&
          (d.datesCheckedAt ?? 0) < changed(d),
      )
      .sort((a, b) => changed(b) - changed(a));
    const out: DatesConcept[] = [];
    for (const d of due) {
      if (out.length === DATES_PER_RUN) break;
      const suggested = await ctx.db
        .query("proposals")
        .withIndex("by_workspace_key", (q) =>
          q.eq("workspaceId", workspaceId).eq("kind", "date").eq("subject", d.cid),
        )
        .first();
      if (suggested) continue;
      if (await aboutToGo(ctx, workspaceId, d.cid)) continue;
      const b = await bodyOf(ctx, workspaceId, d.cid);
      out.push({
        id: d.cid,
        title: d.title ?? "",
        description: d.description ?? "",
        body: (b?.body ?? "").slice(0, 1500),
      });
    }
    return out;
  },
});

/** Mark what was read, and put a review date on the shelf for what is time-bound. */
export const fileDates = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    checked: v.array(v.string()),
    found: v.array(v.object({ id: v.string(), target: v.string(), reason: v.string() })),
  },
  handler: async (ctx, { workspaceId, checked, found }) => {
    const now = Date.now();
    for (const cid of checked) {
      const row = await getByCid(ctx, workspaceId, cid);
      if (row) await ctx.db.patch(row._id, { datesCheckedAt: now });
    }
    let filed = 0;
    for (const { id, target, reason } of found) {
      const row = await getByCid(ctx, workspaceId, id);
      // A writer may have set a review date in the meantime, or a
      // proposal to replace the concept may have been filed.
      if (!row || staleAfterOf(row.frontmatter as Record<string, unknown>)) continue;
      if (await aboutToGo(ctx, workspaceId, id)) continue;
      if (
        await fileProposal(ctx, workspaceId, { kind: "date", subject: id, target, reason }, "libro")
      ) {
        filed += 1;
      }
    }
    return filed;
  },
});

/** Libro reads what changed for claims tied to a date (above). No key: only the dates written out. */
export const datesScreen = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<{ asked: number; filed: number }> => {
    const concepts = await ctx.runQuery(internal.libro.datesCandidates, { workspaceId });
    if (concepts.length === 0) return { asked: 0, filed: 0 };
    const now = Date.now();
    const found: { id: string; target: string; reason: string }[] = [];
    const ask: DatesConcept[] = [];
    for (const c of concepts) {
      const stated = statedDate(`${c.title}\n${c.description}\n${c.body}`, now);
      if (!stated) {
        ask.push(c);
        continue;
      }
      const target = dayAfter(stated);
      found.push({ id: c.id, target, reason: dateReason({ stated }, target) });
    }
    const checked = found.map((f) => f.id);
    if (ask.length > 0) {
      const today = new Date(now).toISOString().slice(0, 10);
      const plan = await ctx.runQuery(internal.workspaces.planOf, { workspaceId });
      const e = await evaluate({ today, concepts: ask }, datesQuestions(ask.length), plan);
      // Jev unavailable: what it was to read is not marked read, so the next
      // review asks again.
      if (e) {
        const ids = ask.map((c) => c.id);
        checked.push(...ids);
        for (const { id, kind, days, p } of datesPicks(e, ids)) {
          const target = reviewDate(now, days);
          found.push({ id, target, reason: dateReason({ kind, p }, target) });
        }
      }
    }
    if (checked.length === 0) return { asked: 0, filed: 0 };
    const filed: number = await ctx.runMutation(internal.libro.fileDates, {
      workspaceId,
      checked,
      found,
    });
    return { asked: ask.length, filed };
  },
});

// ---- Synonyms by meaning: tags spelled apart ------------------------------
//
// The mechanical pass folds tags that are spellings of one another (the same
// foldKey). Tags that mean the same thing but share no spelling, `k8s` and
// `kubernetes`, need a judgment, so after each review code finds the pairs
// worth asking about and Jev, in one typed request, says which mean the same
// thing here. Code picks the pairs from live concepts: two tags that are
// carried together by at least two concepts, or whose words share a stem.
// It leaves out what the thesaurus already settles (a use-for term, two
// preferred tags, a pair related there) and what was proposed before. A
// confirmed pair goes on the shelf as a synonym proposal; approving it files
// the rarer tag under the more used one, and search then finds both words.

/** Tag pairs Jev reads per review, and how sure it must be that two tags mean one thing. */
const SYNONYM_PAIRS = 20;
export const SAME_TAG = 0.85;
/** Tags that carry one stem compared with one another: the most used, so a common word stays bounded. */
const STEM_GROUP = 10;
/** Concept titles shown with each tag, so Jev reads it in this library's sense. */
const TAG_EXAMPLES = 3;

/** One tag as Jev reads it: how many concepts carry it, and a few of their titles. */
export type TagSide = { tag: string; uses: number; examples: string[] };

/** A pair of tags: `a` is filed under `b` if a person approves (b is preferred, or the more used). */
export type TagPair = { a: TagSide; b: TagSide; together: number };

const tagStems = (tag: string) =>
  new Set(
    tag
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1)
      .map(stem),
  );

/**
 * The tag pairs worth asking Jev about, best first: carried together by two
 * or more live concepts, or sharing a stem. Left out: the same foldKey (the
 * mechanical pass's), a use-for term, two preferred tags, and a pair the
 * thesaurus relates (broader, narrower, related). Ranked by how many
 * concepts carry both, then by how much the two are used. Pure.
 */
export function tagPairs(
  docs: Pick<Doc<"concepts">, "cid" | "title" | "status" | "tags">[],
  th: Thesaurus,
): TagPair[] {
  const uses = new Map<string, number>();
  const examples = new Map<string, string[]>();
  const together = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  for (const d of docs) {
    if (d.cid === THESAURUS_ID || d.status === "deprecated") continue;
    const tags = [...new Set(d.tags)];
    for (const t of tags) {
      uses.set(t, (uses.get(t) ?? 0) + 1);
      const ex = examples.get(t) ?? [];
      if (d.title && ex.length < TAG_EXAMPLES) examples.set(t, [...ex, d.title]);
    }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const k = key(tags[i] as string, tags[j] as string);
        together.set(k, (together.get(k) ?? 0) + 1);
      }
    }
  }
  const byStem = new Map<string, string[]>();
  for (const t of uses.keys()) {
    for (const s of tagStems(t)) byStem.set(s, [...(byStem.get(s) ?? []), t]);
  }
  const candidates = new Set([...together.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  for (const group of byStem.values()) {
    const top = [...group]
      .sort((x, y) => (uses.get(y) ?? 0) - (uses.get(x) ?? 0))
      .slice(0, STEM_GROUP);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++)
        candidates.add(key(top[i] as string, top[j] as string));
    }
  }
  const preferred = new Set(Object.keys(th));
  const useFor = new Set(Object.values(th).flatMap((t) => t.use_for ?? []));
  const relates = (x: string, y: string) => {
    const t = th[x];
    return [...(t?.broader ?? []), ...(t?.narrower ?? []), ...(t?.related ?? [])].includes(y);
  };
  const side = (tag: string): TagSide => ({
    tag,
    uses: uses.get(tag) ?? 0,
    examples: examples.get(tag) ?? [],
  });
  const out: TagPair[] = [];
  for (const k of candidates) {
    const [x, y] = k.split("\n") as [string, string];
    if (foldKey(x) === foldKey(y)) continue;
    if (useFor.has(x) || useFor.has(y)) continue;
    if (preferred.has(x) && preferred.has(y)) continue;
    if (relates(x, y) || relates(y, x)) continue;
    // The target is the preferred tag, else the more used, else the first by name.
    const rank = (t: string) => [preferred.has(t) ? 1 : 0, uses.get(t) ?? 0] as const;
    const [px, ux] = rank(x);
    const [py, uy] = rank(y);
    const xLeads = px !== py ? px > py : ux !== uy ? ux > uy : x < y;
    const [a, b] = xLeads ? [y, x] : [x, y];
    out.push({ a: side(a), b: side(b), together: together.get(k) ?? 0 });
  }
  return out.sort(
    (p, q) =>
      q.together - p.together ||
      q.a.uses + q.b.uses - (p.a.uses + p.b.uses) ||
      p.a.tag.localeCompare(q.a.tag) ||
      p.b.tag.localeCompare(q.b.tag),
  );
}

/** Jev's question for each tag pair: do the two mean the same thing in this library? Pure. */
export function sameTagMeaningQuestions(n: number): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (let i = 0; i < n; i++) {
    questions[`sameTag${i}`] = {
      type: "boolean",
      instructions:
        `In this library, do the tags \`pairs[${i}].a.tag\` and \`pairs[${i}].b.tag\` mean the same ` +
        "thing, so one is a synonym, an abbreviation, or another name for the other? Each tag " +
        "comes with titles of concepts that carry it.",
      criteria: {
        true: "the same meaning: one is a synonym, an abbreviation, or another name for the other",
        false: "related or overlapping, but distinct: one is broader, narrower, or another thing",
      },
    };
  }
  return questions;
}

/**
 * Ask Jev which tag pairs mean one thing: the ones it is sure of (SAME_TAG),
 * or null when Jev could not be asked (the synonym screen below).
 */
export async function sameTagMeaning(
  pairs: TagPair[],
  plan?: string,
): Promise<{ subject: string; target: string; p: number }[] | null> {
  if (pairs.length === 0) return [];
  const e = await evaluate({ pairs }, sameTagMeaningQuestions(pairs.length), plan);
  if (!e) return null;
  return pairs
    .map((pair, i) => ({ subject: pair.a.tag, target: pair.b.tag, p: yes(e, `sameTag${i}`) }))
    .filter((x) => x.p >= SAME_TAG);
}

/**
 * Candidate tag pairs (code only). It reads the same pass of the library as
 * the review, and skips a pair already proposed either way round, so a
 * dismissed one stays dismissed and a run Jev missed (an outage) leaves its
 * pairs for the next review.
 */
export const synonymCandidates = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<TagPair[]> => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return [];
    const { docs } = await scanConcepts(ctx, ws, "recent");
    const th = await thesaurusOf(ctx, workspaceId);
    const out: TagPair[] = [];
    // Bounded lookups: at most five candidates read per pair asked about.
    for (const pair of tagPairs(docs, th).slice(0, SYNONYM_PAIRS * 5)) {
      if (out.length === SYNONYM_PAIRS) break;
      let known = false;
      for (const [subject, target] of [
        [pair.a.tag, pair.b.tag],
        [pair.b.tag, pair.a.tag],
      ] as const) {
        const p = await ctx.db
          .query("proposals")
          .withIndex("by_workspace_key", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("kind", "synonym")
              .eq("subject", subject)
              .eq("target", target),
          )
          .first();
        if (p) known = true;
      }
      if (!known) out.push(pair);
    }
    return out;
  },
});

/** File the tag pairs Jev judged to mean one thing, as synonym proposals by "libro". */
export const fileSynonyms = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    pairs: v.array(v.object({ subject: v.string(), target: v.string(), p: v.number() })),
  },
  handler: async (ctx, { workspaceId, pairs }) => {
    // The thesaurus may have changed while Jev read: a pair it now settles is left out.
    const th = await thesaurusOf(ctx, workspaceId);
    const useFor = new Set(Object.values(th).flatMap((t) => t.use_for ?? []));
    let filed = 0;
    for (const { subject, target, p } of pairs) {
      if (th[subject] || useFor.has(subject) || useFor.has(target)) continue;
      const reason = `"${subject}" reads as "${target}" (Libro is ${Math.round(p * 100)}% sure).`;
      if (
        await fileProposal(ctx, workspaceId, { kind: "synonym", subject, target, reason }, "libro")
      ) {
        filed += 1;
      }
    }
    return filed;
  },
});

/** Jev's synonym screen, after each review (above). Jev down: nothing is filed, and the next review asks again. */
export const synonymsScreen = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<{ confirmed: number; retry?: boolean }> => {
    const pairs = await ctx.runQuery(internal.libro.synonymCandidates, { workspaceId });
    if (pairs.length === 0) return { confirmed: 0 };
    const plan = await ctx.runQuery(internal.workspaces.planOf, { workspaceId });
    const same = await sameTagMeaning(pairs, plan);
    if (same === null) return { confirmed: 0, retry: true };
    if (same.length === 0) return { confirmed: 0 };
    const filed: number = await ctx.runMutation(internal.libro.fileSynonyms, {
      workspaceId,
      pairs: same,
    });
    return { confirmed: filed };
  },
});

// ---- Source watch: does the change matter --------------------------------
//
// On paid plans, the review fetches again the kept pages concepts cite
// (convex/fetching.ts watch). A page changes for many reasons (a date in the
// footer, a new section), so instead of putting every concept that cites it
// up for review, Jev reads what changed and each citing concept's catalog
// record, and only the ones it judges affected come up (`stale`, by Libro).
// Jev down, off, or absent: every citing concept comes up, as before.

/** Citing concepts Jev judges per changed page, and how sure it must be that one is affected. */
export const WATCH_JUDGED = 20;
export const AFFECTED = 0.6;
/** Characters of a change kept per side (what went, what came), and of context around it. */
const CHANGE_CHARS = 400;
const CHANGE_CONTEXT = 60;

/** What changed on a page: the text that went and the text that came, each bounded. */
export type Change = { removed: string; added: string };

/** One citing concept as Jev reads it: its catalog record. */
export type WatchConcept = { id: string; title: string; description: string };

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * A short account of how a page's text changed: the paragraphs only the old
 * text has and the ones only the new text has, without the start and end the
 * two share (a little of it kept for context), each side at most `max`
 * characters. Pure.
 */
export function changeSummary(before: string, after: string, max = CHANGE_CHARS): Change {
  const paras = (t: string) =>
    t
      .split(/\n+/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  const a = paras(before);
  const b = paras(after);
  const inA = new Set(a);
  const inB = new Set(b);
  const removed = a.filter((p) => !inB.has(p)).join("\n");
  const added = b.filter((p) => !inA.has(p)).join("\n");
  let start = 0;
  while (start < removed.length && start < added.length && removed[start] === added[start]) start++;
  let end = 0;
  while (
    end < removed.length - start &&
    end < added.length - start &&
    removed[removed.length - 1 - end] === added[added.length - 1 - end]
  ) {
    end++;
  }
  const from = Math.max(0, start - CHANGE_CONTEXT);
  const trim = Math.max(0, end - CHANGE_CONTEXT);
  const cut = (s: string) => {
    const mid = s.slice(from, s.length - trim);
    return `${from > 0 ? "…" : ""}${clip(mid, max - (from > 0 ? 1 : 0) - (trim > 0 ? 1 : 0))}${trim > 0 ? "…" : ""}`;
  };
  return { removed: removed ? cut(removed) : "", added: added ? cut(added) : "" };
}

/** Jev's question for each citing concept: does this change affect what it says? Pure. */
export function changeAffectsQuestions(n: number): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (let i = 0; i < n; i++) {
    questions[`affects${i}`] = {
      type: "boolean",
      instructions:
        `The page \`page\` changed: \`change.removed\` is text it no longer has, and ` +
        `\`change.added\` is text it has now. Does this change affect what \`concepts[${i}]\` ` +
        "says, so the concept may now be out of date or wrong?",
      criteria: {
        true: "yes: the change touches a fact, a number, a step, or a name the concept states or relies on",
        false: "no: the change is about something the concept does not say",
      },
    };
  }
  return questions;
}

/**
 * Ask Jev which citing concepts a page's change affects: each with its
 * probability, the ones at AFFECTED or over marked `affected`. Null when Jev
 * could not be asked: the watch then puts them all up for review.
 */
export async function changeAffects(
  page: { title: string; location: string },
  change: Change,
  concepts: WatchConcept[],
  plan?: string,
): Promise<{ id: string; p: number; affected: boolean }[] | null> {
  if (concepts.length === 0) return [];
  const e = await evaluate(
    { page, change, concepts },
    changeAffectsQuestions(concepts.length),
    plan,
  );
  if (!e) return null;
  return concepts.map((c, i) => {
    const p = yes(e, `affects${i}`);
    return { id: c.id, p, affected: p >= AFFECTED };
  });
}

/**
 * After each review, on every plan: Jev's pair screen, review dates, and
 * synonyms. Jev only, no generative model.
 */
async function scheduleScreens(ctx: MutationCtx, ws: Doc<"workspaces">) {
  if (hasAi("eval")) {
    // `ws` was read before this review stamped it: its libroRunAt is the last one.
    await ctx.scheduler.runAfter(0, internal.libro.pairsScreen, {
      workspaceId: ws._id,
      since: ws.libroRunAt ?? 0,
    });
    await ctx.scheduler.runAfter(0, internal.libro.datesScreen, { workspaceId: ws._id });
    await ctx.scheduler.runAfter(0, internal.libro.synonymsScreen, { workspaceId: ws._id });
  }
}

/** The kinds a person's agent may file: what reading two concepts can show. */
export const AGENT_KINDS = ["merge", "supersede", "deprecate", "synonym"] as const;

/**
 * File a proposal from a person's agent (convex/mcp.ts `propose`): the same
 * shelf and rules as Libro's own. A merge carries the draft the agent wrote
 * for the target, and Jev checks it against its two sources before anyone
 * approves it. Returns the proposal, or null when the same one is already
 * on the shelf.
 */
export async function proposeOnShelf(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  p: {
    kind: (typeof AGENT_KINDS)[number];
    subject: string;
    target?: string;
    reason: string;
    draft?: Draft;
  },
  by: Writer,
): Promise<Id<"proposals"> | null> {
  if (p.kind !== "deprecate" && !p.target) throw new Error(`${p.kind} needs a target`);
  if (p.target === p.subject) throw new Error("subject and target are the same");
  if (p.kind === "merge" && !p.draft) throw new Error("merge needs a draft of the target");
  if (p.draft) {
    const d = p.draft;
    assertNoSecrets(d.title, d.description, d.body, ...(d.tags ?? []));
    if (new TextEncoder().encode(d.body ?? "").length > MAX_BODY_BYTES) {
      throw new Error(`the draft's body is over ${MAX_BODY_BYTES / 1000} KB`);
    }
  }
  if (p.kind !== "synonym") {
    if (!(await getByCid(ctx, ws._id, p.subject)))
      throw new Error(`concept not found: ${p.subject}`);
    if (p.target && !(await getByCid(ctx, ws._id, p.target))) {
      throw new Error(`concept not found: ${p.target}`);
    }
  }
  const id = await fileProposal(ctx, ws._id, p, by);
  if (id && p.kind === "merge") {
    await ctx.scheduler.runAfter(0, internal.libro.checkDraft, { proposalId: id });
  }
  return id;
}

/** The draft of a merge proposal and the two concepts it merges, for the check. */
export const draftSources = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const p = await ctx.db.get(proposalId);
    if (p?.kind !== "merge" || !p.draft || !p.target) return null;
    const sources = [];
    for (const cid of [p.subject, p.target]) {
      const c = await getConcept(ctx, p.workspaceId, cid);
      if (c) {
        sources.push({
          id: cid,
          title: c.title ?? "",
          description: c.description ?? "",
          body: c.body.slice(0, 6000),
        });
      }
    }
    return { draft: p.draft, sources };
  },
});

export const setSupport = internalMutation({
  args: { proposalId: v.id("proposals"), support: v.number() },
  handler: async (ctx, { proposalId, support }) => {
    if (await ctx.db.get(proposalId)) await ctx.db.patch(proposalId, { support });
  },
});

/** Jev's question about a merge draft: does it say only what its two sources say? */
export const DRAFT_QUESTION: Question = {
  type: "boolean",
  instructions:
    "Is everything `draft` says (its title, description, tags, and body) stated in `sources`, the two concepts it merges?",
  criteria: {
    true: "the draft only combines and restates what the sources say",
    false: "the draft adds, changes, or guesses at something neither source says",
  },
};

/**
 * Check a merge draft with Jev: does it say only what its two source
 * concepts say? The probability goes on the proposal and the shelf shows it,
 * so a draft that invents is caught before anyone approves it. The agent
 * only proposes; a person decides.
 */
export const checkDraft = internalAction({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const found = await ctx.runQuery(internal.libro.draftSources, { proposalId });
    if (!found || found.sources.length < 2) return null;
    const e = await evaluate(
      { draft: found.draft, sources: found.sources },
      { draft_supported: DRAFT_QUESTION },
    );
    if (!e) return null;
    const support = yes(e, "draft_supported");
    await ctx.runMutation(internal.libro.setSupport, { proposalId, support });
    return support;
  },
});

/** "Review now": run the review for the signed-in user's workspace. */
export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWritableWorkspace(ctx);
    const blocked = cooldownError(ws);
    if (blocked) throw blocked;
    await ctx.db.patch(ws._id, { libroRunAt: Date.now() });
    const proposals = await reviewWorkspace(ctx, ws);
    await scheduleScreens(ctx, ws);
    return { proposals };
  },
});

/** A workspace's open shelf, oldest first: the dashboard's and the agent's (`review_shelf`). */
export async function openShelf(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  // The oldest OPEN_COUNTED: a shelf longer than that is worked from its oldest.
  const rows = await ctx.db
    .query("proposals")
    .withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", "open"))
    .take(OPEN_COUNTED);
  return rows.map((r) => ({
    id: r._id,
    kind: r.kind,
    subject: r.subject,
    target: r.target ?? null,
    reason: r.reason,
    by: r.by ?? "libro",
    client: r.client ?? null,
    draft: r.draft ?? null,
    support: r.support ?? null,
    created_at: r._creationTime,
  }));
}

export type Decision = "approve" | "dismiss" | "verify";

/**
 * A review date a person picked when approving: a real YYYY-MM-DD after
 * today, since a date already reached would read as stale at once. Pure.
 */
export function pickedDate(date: string, now = Date.now()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const ok =
    m &&
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().startsWith(date);
  if (!ok) throw new ConvexError(`${date} is not a date: use YYYY-MM-DD`);
  if (date <= new Date(now).toISOString().slice(0, 10)) {
    throw new ConvexError(`${date} has come already: pick a date after today`);
  }
  return date;
}

/**
 * Approve, dismiss, or verify one proposal: a person's decision, made on the
 * dashboard or by their agent on their say-so (convex/mcp.ts `decide`).
 * Approve applies it and records a revision by its proposer.
 */
export async function decideProposal(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  id: Id<"proposals">,
  decision: Decision,
  who: { userId?: string; writer: Writer },
  /** A review date in place of the suggested one, on approving a `date` proposal. */
  date?: string,
): Promise<{ status: string }> {
  const p = await ctx.db.get(id);
  if (!p || p.workspaceId !== ws._id) throw new Error("proposal not found");
  if (p.status !== "open") return { status: p.status };
  if (date !== undefined) {
    if (p.kind !== "date" || decision !== "approve") {
      throw new ConvexError("a date goes only with approving a review date");
    }
    pickedDate(date);
  }
  if (decision === "verify") {
    // "Still true": the person checked it. OKF verified by them, and the
    // next review date one cycle out (core markVerified).
    if (p.kind !== "stale") throw new Error("only a stale concept can be verified");
    await update(ctx, ws, p.subject, { verify: true }, who.writer);
  }
  if (decision === "approve") await applyProposal(ctx, ws, p, date);
  const status =
    decision === "approve" ? "approved" : decision === "verify" ? "verified" : "dismissed";
  const decided = { decidedAt: Date.now(), decidedBy: who.userId ?? "unknown" };
  await ctx.db.patch(id, { status, ...decided });
  if (decision === "approve" && p.kind === "merge") {
    // The merge settles the pair: a screen's supersede of the same two
    // concepts closes with it, approved when it pointed the same way.
    // Looked up by key, either way round, not by reading the shelf.
    for (const [subject, target, status] of [
      [p.subject, p.target, "approved"],
      [p.target, p.subject, "dismissed"],
    ] as const) {
      if (!subject || !target) continue;
      const o = await ctx.db
        .query("proposals")
        .withIndex("by_workspace_key", (q) =>
          q
            .eq("workspaceId", ws._id)
            .eq("kind", "supersede")
            .eq("subject", subject)
            .eq("target", target),
        )
        .first();
      if (o?.status === "open") await ctx.db.patch(o._id, { status, ...decided });
    }
  }
  return { status };
}

/** Approve or dismiss one proposal, on the dashboard; a review date may be changed on approving. */
export const decide = mutation({
  args: {
    id: v.id("proposals"),
    decision: v.union(v.literal("approve"), v.literal("dismiss"), v.literal("verify")),
    date: v.optional(v.string()),
  },
  handler: async (ctx, { id, decision, date }) => {
    const ws = await requireWritableWorkspace(ctx);
    const userId = await authUserId(ctx);
    const writer = { by: "human", ...(userId ? { userId } : {}) };
    return await decideProposal(
      ctx,
      ws,
      id,
      decision,
      { userId: userId ?? undefined, writer },
      date,
    );
  },
});

/**
 * Approve a group at once, on the dashboard: the tag pairs, or the review
 * dates as suggested. Only those two kinds, whose approval rewrites no
 * concept's text; anything else is decided one at a time.
 */
export const approveAll = mutation({
  args: { ids: v.array(v.id("proposals")) },
  handler: async (ctx, { ids }) => {
    if (ids.length > OPEN_COUNTED) throw new ConvexError(`at most ${OPEN_COUNTED} at once`);
    const ws = await requireWritableWorkspace(ctx);
    const userId = await authUserId(ctx);
    const writer = { by: "human", ...(userId ? { userId } : {}) };
    let approved = 0;
    for (const id of ids) {
      const p = await ctx.db.get(id);
      if (!p || p.workspaceId !== ws._id || p.status !== "open") continue;
      if (p.kind !== "synonym" && p.kind !== "date") {
        throw new ConvexError("only tag pairs and review dates are approved together");
      }
      await decideProposal(ctx, ws, id, "approve", { userId: userId ?? undefined, writer });
      approved += 1;
    }
    return { approved };
  },
});
