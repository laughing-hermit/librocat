/**
 * One-off data changes, each safe to run again: it does only what's left.
 *
 *   pnpm exec convex run migrations:backfillStems        (and --prod)
 *   pnpm exec convex run migrations:backfillTextBytes    (and --prod)
 *   pnpm exec convex run migrations:indexCatalog         (and --prod)
 *   pnpm exec convex run migrations:pruneUnattached      (and --prod)
 *   pnpm exec convex run migrations:indexPaths           (and --prod)
 *   pnpm exec convex run migrations:dropSearchText       (and --prod)
 *   pnpm exec convex run migrations:indexSourceTitles    (and --prod)
 *
 * self-host/deploy.sh runs them after every deploy.
 */

import { normalType } from "@librocat/core/library";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  bodyOf,
  catalogStemOf,
  facetsOf,
  getByCid,
  reindexConcept,
  searchFieldsOf,
  titleStemOf,
} from "./model";

/**
 * The stemmed search fields (model.ts search) for rows written before search
 * read them: bodies first, then concepts, 200 rows a run, each run scheduling
 * the next.
 */
export const backfillStems = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("bodies"), v.literal("concepts"))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { table = "bodies", cursor }) => {
    let filled = 0;
    let next: { table: "bodies" | "concepts"; cursor: string | null } | null = null;
    if (table === "bodies") {
      const page = await ctx.db.query("bodies").paginate({ cursor: cursor ?? null, numItems: 200 });
      for (const b of page.page) {
        if (b.searchStem !== undefined) continue;
        const doc = await getByCid(ctx, b.workspaceId, b.cid);
        await ctx.db.patch(
          b._id,
          searchFieldsOf({
            title: doc?.title,
            description: doc?.description,
            tags: doc?.tags ?? [],
            body: b.body,
          }),
        );
        filled += 1;
      }
      next = page.isDone
        ? { table: "concepts", cursor: null }
        : { table, cursor: page.continueCursor };
    } else {
      const page = await ctx.db
        .query("concepts")
        .paginate({ cursor: cursor ?? null, numItems: 200 });
      for (const d of page.page) {
        if (d.catalogStem !== undefined) continue;
        await ctx.db.patch(d._id, { catalogStem: catalogStemOf(d) });
        filled += 1;
      }
      next = page.isDone ? null : { table, cursor: page.continueCursor };
    }
    if (next) await ctx.scheduler.runAfter(0, internal.migrations.backfillStems, next);
    console.log(JSON.stringify({ backfillStems: { table, filled, more: next !== null } }));
    return { table, filled, more: next !== null };
  },
});

/**
 * Each library's text bytes (TEXT_BYTES in model.ts), for libraries from
 * before they were counted: the sum of its sources' text. 20 libraries a run,
 * each run scheduling the next.
 */
export const backfillTextBytes = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ cursor: cursor ?? null, numItems: 20 });
    let filled = 0;
    for (const ws of page.page) {
      if (ws.textBytes !== undefined) continue;
      let textBytes = 0;
      for await (const src of ctx.db
        .query("sources")
        .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws._id))) {
        textBytes += src.bytes;
      }
      await ctx.db.patch(ws._id, { textBytes });
      filled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillTextBytes, {
        cursor: page.continueCursor,
      });
    }
    return { filled, more: !page.isDone };
  },
});

/**
 * File every concept in the catalog index (model.ts reindexConcept): its
 * facets and the library's counts, for concepts from before the index. 200
 * concepts a run, each run scheduling the next; a concept already filed is
 * left as it is.
 */
export const indexCatalog = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("concepts").paginate({ cursor: cursor ?? null, numItems: 200 });
    let filed = 0;
    for (const d of page.page) {
      const filedAlready = await ctx.db
        .query("facets")
        .withIndex("by_cid", (q) => q.eq("workspaceId", d.workspaceId).eq("cid", d.cid))
        .first();
      if (!filedAlready) {
        await reindexConcept(ctx, d.workspaceId, null, d);
        filed += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.indexCatalog, {
        cursor: page.continueCursor,
      });
    }
    return { filed, more: !page.isDone };
  },
});

/**
 * Stored files nothing holds, however old (the daily run looks at those one
 * to three days old): sources.ts pruneUnattached, from the first file.
 */
export const pruneUnattached = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.sources.pruneUnattached, { from: 0 });
  },
});

/**
 * File each concept's code paths in the catalog index (model.ts facetsOf,
 * kind `path`), so `files_changed` looks them up: 200 concepts a run, each run
 * scheduling the next. A concept never filed is indexCatalog's.
 */
export const indexPaths = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("concepts").paginate({ cursor: cursor ?? null, numItems: 200 });
    let filed = 0;
    for (const d of page.page) {
      const rows = await ctx.db
        .query("facets")
        .withIndex("by_cid", (q) => q.eq("workspaceId", d.workspaceId).eq("cid", d.cid))
        .collect();
      if (rows.length === 0) continue;
      const have = new Set(rows.filter((r) => r.kind === "path").map((r) => r.value));
      for (const f of facetsOf(d)) {
        if (f.kind !== "path" || have.has(f.value)) continue;
        await ctx.db.insert("facets", { workspaceId: d.workspaceId, cid: d.cid, ...f });
        filed += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.indexPaths, {
        cursor: page.continueCursor,
      });
    }
    return { filed };
  },
});

/** Clear the unstemmed copy of each body's text, which search never read: 200 a run. */
export const dropSearchText = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("bodies").paginate({ cursor: cursor ?? null, numItems: 200 });
    let cleared = 0;
    for (const b of page.page) {
      if (b.searchText === undefined) continue;
      await ctx.db.patch(b._id, { searchText: undefined });
      cleared += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.dropSearchText, {
        cursor: page.continueCursor,
      });
    }
    return { cleared };
  },
});

/**
 * Each kept source's stemmed title (model.ts titleStemOf), which search finds
 * a source by (sources.ts sourceHits), for sources from before it: 200 a
 * run, each run scheduling the next. A source whose title is already filed
 * is left as it is.
 */
export const indexSourceTitles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("sources").paginate({ cursor: cursor ?? null, numItems: 200 });
    let filled = 0;
    for (const src of page.page) {
      const titleStem = titleStemOf(src.title);
      if (src.titleStem === titleStem) continue;
      await ctx.db.patch(src._id, { titleStem });
      filled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.indexSourceTitles, {
        cursor: page.continueCursor,
      });
    }
    console.log(JSON.stringify({ indexSourceTitles: { filled, more: !page.isDone } }));
    return { filled, more: !page.isDone };
  },
});

/**
 * Two types (2026-10-23): a concept is a Note or a Decision (core
 * library.ts normalType). Each concept filed under another type (Runbook,
 * Reference, Concept, Code File) is refiled as a Note: its row, its body,
 * and its type facet and counts. 200 concepts a run, each run scheduling
 * the next. Revisions keep the type they were written with.
 */
export const noteTypes = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("concepts").paginate({ cursor: cursor ?? null, numItems: 200 });
    let refiled = 0;
    for (const d of page.page) {
      const type = normalType(d.type);
      if (type === d.type) continue;
      await ctx.db.patch(d._id, { type });
      const body = await bodyOf(ctx, d.workspaceId, d.cid);
      if (body) await ctx.db.patch(body._id, { type });
      await reindexConcept(ctx, d.workspaceId, d, { ...d, type });
      refiled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.noteTypes, {
        cursor: page.continueCursor,
      });
    }
    return { refiled, more: !page.isDone };
  },
});

/**
 * Libro, never Jev, in what people read (2026-10-23): a proposal's reason
 * that says "(Jev, 91% sure)" says "(Libro is 91% sure)". 200 proposals a
 * run, each run scheduling the next.
 */
export const libroSays = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("proposals")
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    let rewritten = 0;
    for (const p of page.page) {
      const reason = p.reason.replace(/\(Jev, (\d+)% sure\)/g, "(Libro is $1% sure)");
      if (reason === p.reason) continue;
      await ctx.db.patch(p._id, { reason });
      rewritten += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.libroSays, {
        cursor: page.continueCursor,
      });
    }
    return { rewritten, more: !page.isDone };
  },
});
