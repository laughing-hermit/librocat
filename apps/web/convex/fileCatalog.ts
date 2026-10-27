/**
 * Libro reads each file a person adds (attached on the dashboard, or a link
 * they saved) from start to end, a read at a time: whole parts, up to
 * READ_CHARS (about three pages). Each read is one Jev request and one
 * credit:
 * - the first also picks the file's one-line description (one of its own
 *   sentences) and its tags from the library's vocabulary, as indexation.ts
 *   does for a concept;
 * - every read asks, of up to CHECKED concepts, whether that part changes
 *   what they say: every concept of a small library, else the ones a word
 *   search on the read finds (its most frequent words, the file's tags and
 *   name; the thesaurus adds synonyms). Those Jev judges at FLAG or over
 *   come up in Needs you as Outdated, naming the file and the part. A
 *   concept flagged once isn't asked again, and a read that talks about no
 *   concept costs nothing.
 *
 * It flags what a part likely changes; it can't promise every conflict (a
 * concept in other words can slip past the search). The person's agent,
 * writing notes from the file (ingest-document), checks again.
 *
 * Credits (model.ts spendFileCredit): files reach at most half of the
 * month's included credits, then pay-as-you-go where it's on, under the
 * library's cap. Otherwise the file waits (fileReads.waiting), and a daily
 * job goes on once credits renew. A read that ran isn't refunded: the check
 * is the work. Jev's input costs $0.042 per million tokens, so a read costs
 * librocat a small fraction of a cent.
 *
 * Jev selects and judges; it writes nothing. The notes a file holds are the
 * person's agent's to write (Needs you's Missing row). A file an agent
 * attached is left to that agent. Without Jev (a self-hosted librocat's
 * choice) nothing runs and nothing is spent.
 */

import { normalizeTags, specificEntry, type Thesaurus } from "@librocat/core/library";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { DEFAULT_MODELS, hasAi, resolve } from "./ai";
import {
  descriptionCandidates,
  jevPicks,
  jevQuestions,
  type VocabularyTerm,
  vocabularyFor,
} from "./indexation";
import { evaluate, type Question, yes } from "./jev";
import {
  fileProposal,
  refundCredit,
  search,
  spendFileCredit,
  thesaurusOf,
  titleStemOf,
  topCounts,
} from "./model";

/** A read: whole parts of a file, up to this many characters (at least one part). */
export const READ_CHARS = 8_000;
/** Concepts a read is checked against, at most: a library this small has all of its own checked. */
export const CHECKED = 20;
/**
 * How sure Jev must be that a part changes a concept to flag it: lower than
 * a page watch's (libro.ts AFFECTED), since a missed conflict costs more
 * than one the person dismisses.
 */
export const FLAG = 0.5;
/** Tags a file is filed under, at most. */
const MAX_TAGS = 3;
/** Reads one run makes before it schedules the next, so a long file never runs out of time. */
const READS_PER_RUN = 10;
/** Vocabulary tags asked about, as indexation.ts asks. */
const JEV_TAGS = 40;

/** After a file is read: Libro reads it, if it's a person's and Jev is there. */
export async function scheduleFileCatalog(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  sourceId: Id<"sources">,
) {
  if (!hasAi("eval")) return;
  await ctx.scheduler.runAfter(0, internal.fileCatalog.read, { workspaceId, sourceId });
}

/** Jev's question for each concept: does this part of a new file change what it says? Pure. */
export function fileChangesQuestions(n: number): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (let i = 0; i < n; i++) {
    questions[`affects${i}`] = {
      type: "boolean",
      instructions:
        "A file was just added to the library: `concept.title` is its name and " +
        "`change.added` one part of it. Does that part change what `concepts[" +
        i +
        "]` says, so the concept may now be out of date or wrong?",
      criteria: {
        true: "yes: the part states a different fact, number, step, or name than the concept does",
        false:
          "no: the part agrees with the concept, or is about something the concept does not say",
      },
    };
  }
  return questions;
}

/** Words too common to tell what a read is about. */
const COMMON = new Set(
  (
    "this that with from have will they their there which what when were been into your " +
    "about more than then them these those also each only other some such most over after " +
    "before would could should while where here every first just very must does done many " +
    "much same both well like make made used uses using page pages part"
  ).split(" "),
);

/**
 * A read's word search: its most frequent words of four letters or more
 * (the common ones left out), then the file's tags and name, which go last
 * because a query keeps its last 16 words (stemQuery). Pure, exported for
 * tests.
 */
export function readQuery(text: string, title: string, tags: string[] = []): string {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!COMMON.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const tail = [...tags, title];
  const room = Math.max(4, 16 - tail.join(" ").split(/\s+/).length);
  const top = [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, room)
    .map(([w]) => w);
  return [...top, ...tail].join(" ");
}

/**
 * How many parts the next read takes, from the start of `lengths` (their
 * text sizes, in order): whole parts up to `max` characters, at least one.
 * Pure, exported for tests.
 */
export function readSpan(lengths: number[], max = READ_CHARS): number {
  let size = 0;
  let n = 0;
  for (const len of lengths) {
    if (n > 0 && size + len > max) break;
    size += len;
    n += 1;
  }
  return n;
}

/**
 * Read Jev's answers back: the description and tags it picked (the first
 * read's), and the concepts it judged the read changes, at FLAG or over.
 * Pure, exported for tests.
 */
export function filePicks(
  answers: Parameters<typeof jevPicks>[0],
  candidates: string[],
  vocabulary: VocabularyTerm[],
  thesaurus: Thesaurus,
  concepts: { id: string }[],
) {
  const picked = jevPicks(answers, candidates, vocabulary);
  const tags = picked.tags ? specificEntry(picked.tags, thesaurus).slice(0, MAX_TAGS) : [];
  const affected = concepts
    .map((c, i) => ({ id: c.id, p: yes(answers, `affects${i}`) }))
    .filter((c) => c.p >= FLAG);
  return { description: picked.description, tags, affected };
}

const rowOf = (ctx: QueryCtx, sourceId: Id<"sources">) =>
  ctx.db
    .query("fileReads")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .unique();

/** A file Libro read to its end: its row goes, and its page says so. */
async function finish(ctx: MutationCtx, row: Doc<"fileReads">, src: Doc<"sources">) {
  await ctx.db.delete(row._id);
  await ctx.db.patch(src._id, { libroRead: src.parts });
}

/**
 * The concepts a read is checked against: every live one in a library of
 * CHECKED or fewer, else the ones its word search finds first.
 */
async function candidatesFor(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  query: string,
  flagged: Set<string>,
) {
  const keep = (c: { id: string; type?: string; status?: string }) =>
    c.type !== "Source" && c.id !== "thesaurus" && c.status !== "deprecated" && !flagged.has(c.id);
  if (ws.conceptCount <= CHECKED + 1) {
    const all = await ctx.db
      .query("concepts")
      .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws._id))
      .take(CHECKED + 1);
    return all
      .map((d) => ({
        id: d.cid,
        type: d.type,
        status: d.status,
        title: d.title,
        description: d.description,
      }))
      .filter(keep)
      .slice(0, CHECKED)
      .map((c) => ({ id: c.id, title: c.title ?? c.id, description: c.description ?? "" }));
  }
  const found = await search(ctx, ws._id, { query, limit: CHECKED * 2 });
  return found
    .filter(keep)
    .slice(0, CHECKED)
    .map((c) => ({ id: c.id, title: c.title, description: c.description ?? "" }));
}

/**
 * The next read of a file: its parts, the concepts it talks about, and a
 * credit for it. `done` when the file is read (or isn't Libro's to read),
 * `waiting` when no credit is left (a daily job goes on later), `skipped`
 * when the read talks about no concept (nothing asked, nothing spent).
 */
export const reserveRead = internalMutation({
  args: { workspaceId: v.id("workspaces"), sourceId: v.id("sources") },
  handler: async (ctx, { workspaceId, sourceId }) => {
    const ws = await ctx.db.get(workspaceId);
    const src = await ctx.db.get(sourceId);
    if (!ws || !src || src.workspaceId !== workspaceId) return { done: true as const };
    if (src.client || src.status === "failed") return { done: true as const };
    let row = await rowOf(ctx, sourceId);
    if (!row) {
      // Read to its end before: nothing more to do.
      if (src.libroRead !== undefined) return { done: true as const };
      const id = await ctx.db.insert("fileReads", { workspaceId, sourceId, next: 1, flagged: [] });
      row = (await ctx.db.get(id)) as Doc<"fileReads">;
    }
    if (row.next > src.parts) {
      await finish(ctx, row, src);
      return { done: true as const };
    }

    // The read: whole parts from `next`, up to READ_CHARS.
    const ahead: Doc<"sourceParts">[] = [];
    let size = 0;
    const parts = ctx.db
      .query("sourceParts")
      .withIndex("by_source_n", (q) => q.eq("sourceId", sourceId).gte("n", row.next));
    for await (const p of parts) {
      if (ahead.length > 0 && size + p.text.length > READ_CHARS) break;
      ahead.push(p);
      size += p.text.length;
    }
    const to = ahead.at(-1)?.n ?? src.parts;
    const text = ahead
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join("\n\n");
    const first = row.next === 1;

    // The concepts this read is checked against, not flagged already.
    const concepts = text
      ? await candidatesFor(
          ctx,
          ws,
          readQuery(text, src.title, src.tags ?? []),
          new Set(row.flagged),
        )
      : [];
    if (!first && concepts.length === 0) {
      // Nothing to ask: on to the next read, for free.
      if (to >= src.parts) await finish(ctx, row, src);
      else {
        await ctx.db.patch(row._id, { next: to + 1 });
        await ctx.db.patch(src._id, { libroRead: to });
      }
      return { skipped: true as const };
    }

    const spent = await spendFileCredit(ctx, ws);
    if (!spent) {
      if (!row.waiting) await ctx.db.patch(row._id, { waiting: true });
      return { waiting: true as const };
    }
    if (row.waiting) await ctx.db.patch(row._id, { waiting: undefined });
    const thesaurus = first ? await thesaurusOf(ctx, workspaceId) : {};
    const vocabulary = first
      ? vocabularyFor("", [], thesaurus, 100, await topCounts(ctx, workspaceId, "tag", 200))
      : [];
    return {
      job: {
        kind: spent.kind,
        period: spent.period,
        plan: ws.plan,
        first,
        to,
        total: src.parts,
        file: { sid: src.sid, title: src.title, text },
        candidates: first ? descriptionCandidates(text) : [],
        vocabulary,
        thesaurus,
        concepts,
      },
    };
  },
});

/** Read a person's file, a read at a time, until it's done or waits; then go on in a new run. */
export const read = internalAction({
  args: { workspaceId: v.id("workspaces"), sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    for (let i = 0; i < READS_PER_RUN; i++) {
      const next = await ctx.runMutation(internal.fileCatalog.reserveRead, args);
      if ("done" in next || "waiting" in next) return;
      if ("skipped" in next) continue;
      const { job } = next;
      const asFile = {
        type: "Note",
        title: job.file.title,
        description: null,
        tags: [],
        body: job.file.text,
      };
      const questions = {
        ...(job.first ? jevQuestions(asFile, job.candidates, job.vocabulary) : {}),
        ...fileChangesQuestions(job.concepts.length),
      };
      const e = await evaluate(
        {
          concept: { type: "Note", title: job.file.title, body: job.file.text },
          ...(job.first ? { tags: job.vocabulary.slice(0, JEV_TAGS) } : {}),
          change: { removed: "", added: job.file.text },
          concepts: job.concepts,
        },
        questions,
        job.plan,
      );
      const picked = e
        ? filePicks(e, job.candidates, job.vocabulary, job.thesaurus, job.concepts)
        : null;
      console.log(
        JSON.stringify({
          fileRead: e
            ? { cost: e.cost, to: job.to, of: job.total, affected: picked?.affected.length ?? 0 }
            : null,
        }),
      );
      await ctx.runMutation(internal.fileCatalog.applyRead, {
        ...args,
        kind: job.kind,
        period: job.period,
        to: job.to,
        result: picked
          ? {
              ...(picked.description ? { description: picked.description } : {}),
              tags: picked.tags,
              affected: picked.affected,
              by: [resolve("eval", job.plan)?.model ?? DEFAULT_MODELS.eval],
            }
          : null,
      });
      // Libro couldn't be asked: the read waits for the daily job.
      if (!picked) return;
      if (job.kind === "overage") {
        await ctx.scheduler.runAfter(0, internal.stripe.reportOverage, {
          workspaceId: args.workspaceId,
          cid: `source:${job.file.sid}:${job.to}`,
        });
      }
    }
    await ctx.scheduler.runAfter(0, internal.fileCatalog.read, args);
  },
});

/**
 * Apply one read: the first read's description and tags on the file, the
 * concepts it changes up for review (naming the file and the part), and the
 * file's progress. When Libro couldn't be asked (`result` null), the credit
 * comes back and the file waits for the daily job.
 */
export const applyRead = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    sourceId: v.id("sources"),
    kind: v.union(v.literal("credit"), v.literal("overage")),
    period: v.string(),
    to: v.number(),
    result: v.union(
      v.null(),
      v.object({
        description: v.optional(v.string()),
        tags: v.array(v.string()),
        affected: v.array(v.object({ id: v.string(), p: v.number() })),
        by: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { workspaceId, sourceId, kind, period, to, result }) => {
    const ws = await ctx.db.get(workspaceId);
    const src = await ctx.db.get(sourceId);
    const row = await rowOf(ctx, sourceId);
    if (!ws) return null;
    if (!result || !src || !row) {
      await refundCredit(ctx, ws, kind, period);
      if (row) await ctx.db.patch(row._id, { waiting: true });
      return null;
    }
    const th = await thesaurusOf(ctx, workspaceId);
    const tags = normalizeTags(result.tags, th).slice(0, MAX_TAGS);
    if (result.description || tags.length > 0) {
      await ctx.db.patch(sourceId, {
        ...(result.description ? { description: result.description } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        // Its tags are words search finds it by, as its title is.
        titleStem: titleStemOf([src.title, ...tags].join(" ")),
        cataloged: {
          ...(result.description ? { description: "transcribed" as const } : {}),
          ...(tags.length > 0 ? { tags: "selected" as const } : {}),
          by: result.by,
          at: Date.now(),
        },
      });
    }
    const where = src.parts > 1 ? `; see its part ${to} of ${src.parts}` : "";
    for (const { id, p } of result.affected) {
      await fileProposal(
        ctx,
        workspaceId,
        {
          kind: "stale",
          subject: id,
          target: `source:${src.sid}`,
          reason:
            `The file “${src.title}” may change this (Libro is ${Math.round(p * 100)}% sure${where}). ` +
            "Still true? Verify it, or retire it.",
        },
        "libro",
      );
    }
    if (to >= src.parts) {
      await finish(ctx, row, src);
    } else {
      await ctx.db.patch(row._id, {
        next: to + 1,
        flagged: [...row.flagged, ...result.affected.map((a) => a.id)],
      });
      await ctx.db.patch(sourceId, { libroRead: to });
    }
    return null;
  },
});

/** Daily: the files waiting for credits go on (a file whose credits haven't renewed waits again, for free). */
export const resumeWaiting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const waiting = await ctx.db
      .query("fileReads")
      .withIndex("by_waiting", (q) => q.eq("waiting", true))
      .take(500);
    for (const row of waiting) {
      await ctx.scheduler.runAfter(0, internal.fileCatalog.read, {
        workspaceId: row.workspaceId,
        sourceId: row.sourceId,
      });
    }
    return { resumed: waiting.length };
  },
});
