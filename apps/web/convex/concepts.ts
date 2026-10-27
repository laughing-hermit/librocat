/**
 * Dashboard-facing functions (auth-scoped). The dashboard is the control
 * plane: read-only browsing plus export and delete-all. Concept writes go
 * through the MCP (docs/architecture.md). Every read of the library counts
 * what it reads (metered.ts), so each is a mutation; the Overview and a
 * concept's page read through convex/dashboard.ts.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { surfaced } from "./errors";
import { personId } from "./identity";
import { roleIn } from "./membership";
import { metered } from "./metered";
import * as model from "./model";
import { authUserId, requireWorkspace } from "./workspaces";

/** A dashboard read of the library the dashboard shows, counted by what it reads. */
async function counted<T>(
  ctx: MutationCtx,
  run: (c: MutationCtx, ws: Awaited<ReturnType<typeof requireWorkspace>>) => Promise<T>,
) {
  const ws = await requireWorkspace(ctx);
  return await metered(ctx, ws, (c) => surfaced(() => run(c, ws)));
}

export const search = mutation({
  args: {
    query: v.string(),
    type: v.optional(v.string()),
    tag: v.optional(v.string()),
    status: v.optional(v.string()),
    shelf: v.optional(v.string()),
    author: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const me = (await authUserId(ctx)) ?? undefined;
    return await counted(ctx, (c, ws) => model.search(c, ws._id, { ...args, me }));
  },
});

export const list = mutation({
  args: {
    type: v.optional(v.string()),
    tag: v.optional(v.string()),
    status: v.optional(v.string()),
    shelf: v.optional(v.string()),
    author: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const me = (await authUserId(ctx)) ?? undefined;
    return await counted(ctx, (c, ws) => model.listPage(c, ws._id, { ...args, me }));
  },
});

/** Retired ids for the export zip's update log (log.md). */
export const tombstones = mutation({
  args: {},
  handler: async (ctx) => await counted(ctx, (c, ws) => model.tombstonesOf(c, ws._id)),
});

/** One page of the workspace export (control plane): concepts with bodies, OKF-ready. */
export const exportPage = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) =>
    await counted(ctx, (c, ws) => model.exportPage(c, ws._id, cursor)),
});

/**
 * Delete the whole index (control plane). The UI confirms first. Runs in
 * slices, each its own transaction, until nothing is left.
 */
export const deleteAll = mutation({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    // "Empty this library" is its admins' to do, themselves, as the dashboard shows.
    if ((await roleIn(ctx, ws, (await personId(ctx)) ?? "")) !== "admin") {
      throw new ConvexError("only the library's admins can empty it");
    }
    if (!(await model.deleteSome(ctx, ws._id))) {
      await ctx.scheduler.runAfter(0, internal.concepts.deleteMore, { workspaceId: ws._id });
    }
    return null;
  },
});

export const deleteMore = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    if (!(await model.deleteSome(ctx, workspaceId))) {
      await ctx.scheduler.runAfter(0, internal.concepts.deleteMore, { workspaceId });
    }
  },
});
