/**
 * The end of a grace (grace.ts): delete what's still over Free's limits in
 * a library that stays, what changed least recently first. Concepts (never
 * the thesaurus), then kept documents and pictures, then the oldest
 * revisions. A page at a time, each scheduling the next, so a library of
 * any size fits Convex's limits; it stops once the library fits, is gone,
 * or is on a plan again.
 */

import { THESAURUS_ID } from "@librocat/core/library";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { overFree } from "./grace";
import { deleteConcept } from "./model";
import { dropSource } from "./sources";

/** Concepts a page: each takes its revisions with it, up to REVISIONS_PER_CONCEPT whole copies. */
const CONCEPT_PAGE = 5;
/** A big source's parts a page, before the rest of it goes. */
const PARTS_PAGE = 200;
const REVISION_PAGE = 200;

export const trim = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws || ws.plan !== "free") return null;
    const over = overFree(ws);
    const next = () => ctx.scheduler.runAfter(0, internal.graceTrim.trim, { workspaceId });

    if (over.concepts > 0) {
      const oldest = await ctx.db
        .query("concepts")
        .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspaceId))
        .order("asc")
        .take(CONCEPT_PAGE + 1);
      const doomed = oldest
        .filter((c) => c.cid !== THESAURUS_ID)
        .slice(0, Math.min(CONCEPT_PAGE, over.concepts));
      if (doomed.length > 0) {
        // Each deletion counts down from the library as it is then.
        for (const c of doomed) {
          await deleteConcept(ctx, (await ctx.db.get(workspaceId)) as Doc<"workspaces">, c.cid);
        }
        await next();
        return null;
      }
    }

    if (over.bytes > 0 || over.textBytes > 0) {
      const oldest = await ctx.db
        .query("sources")
        .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspaceId))
        .order("asc")
        .take(50);
      // Over on text alone: the oldest source with text.
      const src = over.bytes > 0 ? oldest[0] : (oldest.find((s) => s.bytes > 0) ?? oldest[0]);
      if (src) {
        const parts = await ctx.db
          .query("sourceParts")
          .withIndex("by_source_n", (q) => q.eq("sourceId", src._id))
          .take(PARTS_PAGE);
        if (parts.length === PARTS_PAGE) {
          for (const p of parts) {
            const media = p.media?.storageId;
            if (media && (await ctx.db.system.get(media))) await ctx.storage.delete(media);
            await ctx.db.delete(p._id);
          }
        } else {
          // The rest of it, as sources.ts removeSource does.
          await dropSource(ctx, src);
          await ctx.db.patch(workspaceId, {
            sourceBytes: Math.max(0, (ws.sourceBytes ?? 0) - src.bytes - (src.fileBytes ?? 0)),
            textBytes: Math.max(0, (ws.textBytes ?? 0) - src.bytes),
            sourceCount: Math.max(0, (ws.sourceCount ?? 0) - 1),
          });
        }
        await next();
        return null;
      }
    }

    if (over.revisions > 0) {
      const old = await ctx.db
        .query("revisions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .order("asc")
        .take(Math.min(REVISION_PAGE, over.revisions));
      if (old.length > 0) {
        for (const r of old) await ctx.db.delete(r._id);
        await ctx.db.patch(workspaceId, {
          revisionCount: Math.max(0, (ws.revisionCount ?? 0) - old.length),
        });
        await next();
      }
    }
    return null;
  },
});
