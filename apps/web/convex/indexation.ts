/**
 * Automatic indexation: the library's cataloging service, paid for with index
 * credits (INDEX_CREDITS in model.ts). Jev selects; nothing is written. The
 * writing is the person's own agent's, which does it better (the
 * librocat-write skill asks it for a description and tags on every write).
 *
 * writeRow (model.ts) schedules `index` after an `ingest`/`update` that left
 * the catalog record incomplete (no description, or no tags). The action:
 *   1. reserves one credit in a mutation (atomic: included credit first, then
 *      pay-as-you-go overage, else nothing happens);
 *   2. code gathers candidates, the concept's own sentences and the library's
 *      vocabulary: tags used on the concept's shelf first, then the rest,
 *      then the thesaurus's unused preferred tags, each with its scope note
 *      and the titles already filed under it (the shelf list a cataloger
 *      checks before choosing a heading);
 *   3. Jev (jev.ts), in one typed request, selects the sentence that best
 *      summarizes the concept and the tags that fit. Selection, not
 *      generation: a transcribed sentence cannot invent a fact;
 *   4. applies the result to the row — never overwriting what a writer set —
 *      under Cutter's rule of specific entry (a broader tag goes when a
 *      narrower one is there), records how each field was filled in
 *      `cataloged`, or refunds the credit when nothing could be filled;
 *   5. reports an overage indexation to Stripe as a meter event.
 *
 * A concept Libro couldn't catalog, because Jev couldn't be asked (down, or
 * slow) or no credit was left, waits (`catalogWaiting`): a daily job
 * (resumeWaiting) tries again, spending its credit as any cataloging does.
 * One Jev answered but found nothing to pick for isn't asked again: that
 * would pay for the same answer twice.
 *
 * Which Jev, and where: ai.ts. Without Jev (a self-hosted librocat's choice)
 * nothing is filled, and the credit comes back.
 */

import { normalizeTags, specificEntry, type Thesaurus } from "@librocat/core/library";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { DEFAULT_MODELS, hasAi, resolve } from "./ai";
import { type Evaluation, evaluate, type Question, yes } from "./jev";
import {
  bodyOf,
  catalogStemOf,
  creditsLeft,
  needsIndexing,
  recordRevision,
  refundCredit,
  reindexConcept,
  searchFieldsOf,
  spendCredits,
  thesaurusOf,
  topCounts,
} from "./model";
import { takeUpTo } from "./size";
import { payerOf } from "./teamCover";

const MAX_TAGS = 3;
/** Jev's confidence needed to take a candidate sentence or a vocabulary tag. */
const PICK = 0.6;
/** Vocabulary tags Jev is asked about per concept, and shelf-list titles shown per tag. */
const JEV_TAGS = 40;
const FILED_EXAMPLES = 3;

/** One vocabulary tag as the cataloger sees it: its scope note and what is already filed under it. */
export type VocabularyTerm = { tag: string; scope_note?: string; filed: string[] };

/** How the cataloger filled each field: a sentence transcribed from the concept, tags selected from the vocabulary. */
export type Cataloged = {
  description?: string;
  tags?: string[];
  how: { description?: "transcribed"; tags?: "selected" };
  /** The model involved, in the OKF actor convention. */
  by: string[];
};

const shelfOf = (cid: string) => (cid.includes("/") ? cid.slice(0, cid.indexOf("/")) : "");
/**
 * The most concepts of its shelf cataloging reads for the vocabulary's
 * examples, and bytes: each credit reads them, so a few hundred, not the
 * shelf. The library's tag counts (topCounts) still rank every tag.
 */
const SHELF_SCAN = 200;
const SHELF_BYTES = 256_000;

/**
 * The library's vocabulary for cataloging one concept: tags used on its
 * shelf first, then the rest by use, then the thesaurus's preferred tags
 * nobody has used yet. Each carries its scope note and a few titles already
 * filed under it (live concepts, same shelf first). `docs` may be part of the
 * library (its shelf); `totals`, the library's tag counts, rank the rest.
 * Pure, exported for tests.
 */
export function vocabularyFor(
  cid: string,
  docs: { cid: string; title?: string; tags: string[]; status: string }[],
  th: Thesaurus,
  max = 100,
  totals?: Record<string, number>,
): VocabularyTerm[] {
  const home = shelfOf(cid);
  const seen = new Map<
    string,
    { total: number; home: number; filed: string[]; homeFiled: string[] }
  >();
  for (const d of docs) {
    if (d.cid === cid || d.cid === "thesaurus" || d.status === "deprecated") continue;
    const here = shelfOf(d.cid) === home;
    for (const tag of d.tags) {
      const e = seen.get(tag) ?? { total: 0, home: 0, filed: [], homeFiled: [] };
      e.total += 1;
      if (here) e.home += 1;
      const title = d.title?.trim() || d.cid;
      (here ? e.homeFiled : e.filed).push(title);
      seen.set(tag, e);
    }
  }
  for (const [tag, n] of Object.entries(totals ?? {})) {
    const e = seen.get(tag) ?? { total: 0, home: 0, filed: [], homeFiled: [] };
    e.total = Math.max(e.total, n);
    seen.set(tag, e);
  }
  const used = [...seen.entries()].sort(
    ([a, x], [b, y]) => y.home - x.home || y.total - x.total || a.localeCompare(b),
  );
  const unused = Object.keys(th)
    .filter((t) => !seen.has(t))
    .sort();
  const out: VocabularyTerm[] = [];
  for (const [tag, e] of used) {
    out.push({
      tag,
      ...(th[tag.toLowerCase()]?.scope_note
        ? { scope_note: th[tag.toLowerCase()]?.scope_note }
        : {}),
      filed: [...e.homeFiled, ...e.filed].slice(0, FILED_EXAMPLES),
    });
  }
  for (const tag of unused) {
    out.push({
      tag,
      ...(th[tag]?.scope_note ? { scope_note: th[tag]?.scope_note } : {}),
      filed: [],
    });
  }
  return out.slice(0, max);
}

/** Reserve one credit and hand the action what the model needs. Null = no credit, no work. */
export const reserve = internalMutation({
  args: { workspaceId: v.id("workspaces"), cid: v.string() },
  handler: async (ctx, { workspaceId, cid }) => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return null;
    const row = await ctx.db
      .query("concepts")
      .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", workspaceId).eq("cid", cid))
      .unique();
    if (!row || row.cid === "thesaurus") return null;
    const body = (await bodyOf(ctx, workspaceId, cid))?.body ?? "";
    if (!needsIndexing({ ...row, body })) {
      await ctx.db.patch(row._id, { indexingAt: undefined, catalogWaiting: undefined });
      return null;
    }

    const spent = await spendCredits(ctx, ws, 1);
    if (!spent) {
      // No credit: leave the record as the writer left it, unblock later
      // jobs, and wait for credits (resumeWaiting).
      await ctx.db.patch(row._id, { indexingAt: undefined, catalogWaiting: true });
      return null;
    }
    const { kind, period } = spent;
    // The concept's shelf, read (at most SHELF_SCAN), and the library's tag
    // counts from the catalog index: no pass over the whole library.
    const thesaurus = await thesaurusOf(ctx, ws._id);
    const home = shelfOf(row.cid);
    const shelf = home
      ? (
          await takeUpTo(
            ctx.db
              .query("concepts")
              .withIndex("by_workspace_cid", (q) =>
                q.eq("workspaceId", ws._id).gte("cid", `${home}/`).lt("cid", `${home}/\uffff`),
              ),
            SHELF_SCAN,
            SHELF_BYTES,
          )
        ).docs
      : (
          await takeUpTo(
            ctx.db
              .query("concepts")
              .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws._id)),
            SHELF_SCAN,
            SHELF_BYTES,
          )
        ).docs.filter((d) => !d.cid.includes("/"));
    const totals = await topCounts(ctx, ws._id, "tag", 200);
    const vocabulary = vocabularyFor(row.cid, shelf, thesaurus, 100, totals);
    return {
      kind,
      period,
      // The key the model calls are billed to (ai.ts): Free has its own.
      plan: ws.plan,
      conceptId: row._id,
      concept: {
        type: row.type,
        title: row.title ?? null,
        description: row.description ?? null,
        tags: row.tags,
        body,
      },
      vocabulary,
      thesaurus,
    };
  },
});

/**
 * Apply the model's catalog record to the row (by _id, so a rename in the
 * meantime still lands). Refunds the credit when the model failed or the row
 * is gone; `retry` when Jev couldn't be asked, so the concept waits for the
 * daily job. Returns true when something was written.
 */
export const apply = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conceptId: v.id("concepts"),
    kind: v.union(v.literal("credit"), v.literal("overage")),
    period: v.string(),
    retry: v.optional(v.boolean()),
    result: v.union(
      v.null(),
      v.object({
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        how: v.optional(
          v.object({
            description: v.optional(v.literal("transcribed")),
            tags: v.optional(v.literal("selected")),
          }),
        ),
        by: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (
    ctx,
    { workspaceId, conceptId, kind, period, retry, result },
  ): Promise<boolean> => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return false;
    const row = await ctx.db.get(conceptId);
    if (row && row.workspaceId !== workspaceId) return false;
    if (result === null || !row) {
      if (row) {
        await ctx.db.patch(row._id, {
          indexingAt: undefined,
          catalogWaiting: retry ? true : undefined,
        });
      }
      await refundCredit(ctx, ws, kind, period);
      return false;
    }
    // Never overwrite what a writer set in the meantime.
    const writerDescription = Boolean(row.description?.trim());
    const writerTags = row.tags.length > 0;
    const description = writerDescription ? row.description : result.description?.trim();
    const th = await thesaurusOf(ctx, workspaceId);
    // Specific entry: file under «oauth», not also under «auth» above it.
    const tags = writerTags
      ? row.tags
      : specificEntry(normalizeTags(result.tags ?? [], th), th).slice(0, MAX_TAGS);
    const frontmatter = { ...(row.frontmatter as Record<string, unknown>) };
    if (description) frontmatter.description = description;
    if (tags.length > 0) frontmatter.tags = tags;
    // Say which fields the cataloger supplied, and how (Cutter: bracket what
    // the cataloger supplied). format.ts drops an entry once a writer changes
    // that field.
    const how: Record<string, string> = {};
    if (!writerDescription && description && result.how?.description) {
      how.description = result.how.description;
    }
    if (!writerTags && tags.length > 0 && result.how?.tags) how.tags = result.how.tags;
    if (Object.keys(how).length > 0) {
      const prev = frontmatter.cataloged;
      frontmatter.cataloged = {
        ...(typeof prev === "object" && prev !== null ? prev : {}),
        ...how,
        by: result.by ?? [],
        at: new Date().toISOString(),
      };
    }
    const patch: Partial<Doc<"concepts">> = {
      description,
      tags,
      frontmatter,
      indexedAt: Date.now(),
      indexingAt: undefined,
      catalogWaiting: undefined,
      catalogStem: catalogStemOf({ ...row, description, tags }),
    };
    await ctx.db.patch(row._id, patch);
    const b = await bodyOf(ctx, workspaceId, row.cid);
    if (b) {
      await ctx.db.patch(b._id, searchFieldsOf({ ...row, description, tags, body: b.body }));
    }
    await recordRevision(ctx, row._id, "index", "indexer");
    // Its tags changed: file it again in the catalog index.
    await reindexConcept(ctx, workspaceId, row, await ctx.db.get(row._id));
    return true;
  },
});

/** The indexation job: reserve → Jev → apply (→ meter). Scheduled by writeRow. */
export const index = internalAction({
  args: { workspaceId: v.id("workspaces"), cid: v.string() },
  handler: async (ctx, { workspaceId, cid }) => {
    const job = await ctx.runMutation(internal.indexation.reserve, { workspaceId, cid });
    if (!job) return;
    const result = await catalog(job.concept, job.vocabulary, job.thesaurus, job.plan);
    const applied: boolean = await ctx.runMutation(internal.indexation.apply, {
      workspaceId,
      conceptId: job.conceptId,
      kind: job.kind,
      period: job.period,
      retry: result === "unreachable",
      result: result === "unreachable" ? null : result,
    });
    if (applied && job.kind === "overage") {
      await ctx.scheduler.runAfter(0, internal.stripe.reportOverage, { workspaceId, cid });
    }
  },
});

export type Concept = {
  type: string;
  title: string | null;
  description: string | null;
  tags: string[];
  body: string;
};

/**
 * Sentences from the concept's own body that could stand as its one-line
 * description: prose only (no headings, lists, tables, or code), 5 to 40
 * words, the first eight. Pure, exported for tests.
 */
export function descriptionCandidates(body: string): string[] {
  const prose = body
    .replace(/```[\s\S]*?```/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(#|[-*+] |\d+[.)] |\||>)/.test(line))
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ");
  const out: string[] = [];
  for (const sentence of prose.match(/[^.!?]+[.!?]/g) ?? []) {
    const s = sentence.trim();
    const words = s.split(" ").length;
    if (words >= 5 && words <= 40) out.push(s);
    if (out.length === 8) break;
  }
  return out;
}

/**
 * The Jev questions for what the concept is missing. The tag questions point
 * at `tags[i]` in the state, which carries the tag, its scope note, and the
 * titles already filed under it. Pure, exported for tests.
 */
export function jevQuestions(
  concept: Concept,
  candidates: string[],
  vocabulary: VocabularyTerm[],
): Record<string, Question> {
  const q: Record<string, Question> = {};
  if (!concept.description && candidates.length > 0) {
    const criteria: Record<string, string> = {};
    candidates.forEach((c, i) => {
      criteria[`c${i}`] = c;
    });
    criteria.none = "None of these sentences can stand alone as the concept's summary";
    q.description = {
      type: "choice",
      instructions:
        "Which sentence from the concept best summarizes it in one line a reader can act on " +
        "without opening the body?",
      criteria,
    };
  }
  if (concept.tags.length === 0) {
    vocabulary.slice(0, JEV_TAGS).forEach((_, i) => {
      q[`tag${i}`] = {
        type: "boolean",
        instructions:
          `Should \`concept\` be filed under the tag \`tags[${i}].tag\`, so that someone ` +
          `browsing that tag finds it? Follow \`tags[${i}].scope_note\` when there is one, and ` +
          `compare with \`tags[${i}].filed\`, the titles already filed under it.`,
        criteria: {
          true: "a main subject of the concept falls under the tag, within its scope note, and the concept is like what is filed there",
          false: "the tag is unrelated, only mentioned in passing, or outside its scope note",
        },
      };
    });
  }
  return q;
}

/** Read Jev's picks back out: the chosen sentence and the tags that fit. Pure, exported for tests. */
export function jevPicks(
  e: Evaluation,
  candidates: string[],
  vocabulary: VocabularyTerm[],
): { description?: string; tags?: string[] } {
  const out: { description?: string; tags?: string[] } = {};
  const d = e.answers.description;
  if (d?.type === "choice" && d.choice !== "none" && (d.probabilities[d.choice] ?? 0) >= PICK) {
    const picked = candidates[Number(d.choice.slice(1))];
    if (picked) out.description = picked;
  }
  const tags = vocabulary
    .slice(0, JEV_TAGS)
    .map(({ tag }, i) => ({ tag, p: yes(e, `tag${i}`) }))
    .filter((t) => t.p >= PICK)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_TAGS)
    .map((t) => t.tag);
  if (tags.length > 0) out.tags = tags;
  return out;
}

/**
 * Catalog one concept with Jev: it selects a sentence from the concept's own
 * words and tags from the library's vocabulary. Nothing is written: the
 * person's agent writes what Jev could not pick. Null when nothing could be
 * filled, or there is no Jev; "unreachable" when Jev couldn't be asked, so
 * the concept waits for the daily job. Either way, the caller refunds.
 */
export async function catalog(
  concept: Concept,
  vocabulary: VocabularyTerm[],
  thesaurus: Thesaurus,
  plan?: string,
): Promise<Cataloged | null | "unreachable"> {
  const candidates = concept.description ? [] : descriptionCandidates(concept.body);
  const questions = jevQuestions(concept, candidates, vocabulary);
  // Nothing to ask, or no Jev to ask (a self-hosted librocat's choice).
  if (Object.keys(questions).length === 0 || !resolve("eval", plan)) return null;
  const state = {
    concept: { type: concept.type, title: concept.title ?? "", body: concept.body.slice(0, 6000) },
    ...(concept.tags.length === 0 ? { tags: vocabulary.slice(0, JEV_TAGS) } : {}),
  };
  const jev = await evaluate(state, questions, plan);
  if (!jev) {
    console.log(JSON.stringify({ indexation: { jev: null } }));
    return "unreachable";
  }
  const picked = jevPicks(jev, candidates, vocabulary);
  if (picked.tags) picked.tags = specificEntry(picked.tags, thesaurus);
  console.log(
    JSON.stringify({
      indexation: {
        jev: { cost: jev.cost, description: !!picked.description, tags: picked.tags?.length ?? 0 },
      },
    }),
  );
  const out: Cataloged = { how: {}, by: [] };
  if (picked.description) {
    out.description = picked.description;
    out.how.description = "transcribed";
  }
  if (picked.tags) {
    out.tags = picked.tags;
    out.how.tags = "selected";
  }
  if (!out.description && !out.tags) return null;
  out.by = [resolve("eval", plan)?.model ?? DEFAULT_MODELS.eval];
  return out;
}

/** Concepts the daily job tries again in one library: a bound on what a backlog costs a day. */
const RETRY_PER_LIBRARY = 50;
/**
 * Libraries one run looks at before it goes on in another: a mutation's read
 * limits, and the 1,000 functions it may schedule (19 × 50 retries, and the
 * next run).
 */
const RETRY_LIBRARIES = 19;
/** Between one retried concept of a library and its next, so a backlog doesn't reach Jev at once. */
const RETRY_GAP_MS = 500;
/** A cataloging job still in flight (as model.ts writeRow judges it). */
const IN_FLIGHT_MS = 120_000;

/**
 * Daily: the concepts Libro couldn't catalog (Jev unreachable, or no credit
 * left) go again, each spending its credit as any cataloging does. A library
 * goes only as far as it has credits (creditsLeft): one with none waits, for
 * free, until they renew. Past RETRY_LIBRARIES libraries, it goes on in
 * another run (`after`).
 */
export const resumeWaiting = internalMutation({
  args: { after: v.optional(v.id("workspaces")) },
  handler: async (ctx, { after }) => {
    if (!hasAi("eval")) return { resumed: 0 };
    let last = after;
    let resumed = 0;
    for (let n = 0; n < RETRY_LIBRARIES; n++) {
      const from = last;
      const next = await ctx.db
        .query("concepts")
        .withIndex("by_catalog_waiting", (q) =>
          from
            ? q.eq("catalogWaiting", true).gt("workspaceId", from)
            : q.eq("catalogWaiting", true),
        )
        .first();
      if (!next) return { resumed };
      const workspaceId = next.workspaceId;
      last = workspaceId;
      const ws = await ctx.db.get(workspaceId);
      const room = ws ? Math.min(RETRY_PER_LIBRARY, creditsLeft(await payerOf(ctx, ws))) : 0;
      if (room <= 0) continue;
      const rows = await ctx.db
        .query("concepts")
        .withIndex("by_catalog_waiting", (q) =>
          q.eq("catalogWaiting", true).eq("workspaceId", workspaceId),
        )
        .take(room);
      let i = 0;
      for (const row of rows) {
        if (row.indexingAt !== undefined && Date.now() - row.indexingAt < IN_FLIGHT_MS) continue;
        const delay = i++ * RETRY_GAP_MS;
        // In flight from when it runs, so a write meanwhile doesn't start a second job.
        await ctx.db.patch(row._id, { indexingAt: Date.now() + delay });
        await ctx.scheduler.runAfter(delay, internal.indexation.index, {
          workspaceId,
          cid: row.cid,
        });
        resumed++;
      }
    }
    await ctx.scheduler.runAfter(0, internal.indexation.resumeWaiting, { after: last });
    return { resumed };
  },
});
