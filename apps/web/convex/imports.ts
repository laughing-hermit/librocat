/**
 * Import, beside Export (Settings › General): a zip that Export made, or any
 * OKF folder zipped. The browser reads it and uploads its text in pieces
 * straight to storage (no site request carries them, so Vercel's request
 * limit doesn't apply), and importZip.ts reads each piece; its files are
 * attached one by one, as the dashboard attaches a file. These write what it holds through the same
 * functions an agent's `ingest`, `thesaurus`, and `add_source` use, one
 * counted write each, so the plan's limits and the secret check hold.
 */

import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { surfaced } from "./errors";
import { limitCalls } from "./limits";
import { currentWorkspaceForUserId, requireWriter } from "./membership";
import { metered } from "./metered";
import * as model from "./model";
import * as sources from "./sources";
import { requireWritableWorkspace } from "./workspaces";

/** The largest piece of an import: the browser sends a zip in pieces of 40 MB of text at most. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** An upload URL for the zip, counted as one write. */
export const uploadUrl = mutation({
  args: { size: v.number() },
  handler: async (ctx, { size }) => {
    const ws = await requireWritableWorkspace(ctx);
    if (size > MAX_IMPORT_BYTES) {
      throw new ConvexError(
        "this piece of the import is over 50 MB: import from the dashboard, which sends a zip in pieces",
      );
    }
    await limitCalls(ctx, ws, { writes: 1 });
    return { url: await ctx.storage.generateUploadUrl() };
  },
});

/** The library an import writes to: the one the person has open. */
export const target = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => (await currentWorkspaceForUserId(ctx, userId))?._id ?? null,
});

/**
 * The library again, for each write: still the one the person has open, so
 * switching libraries in another tab stops an import instead of splitting it.
 */
async function sameLibrary(ctx: MutationCtx, workspaceId: Id<"workspaces">, userId: string) {
  const ws = await currentWorkspaceForUserId(ctx, userId);
  if (!ws || ws._id !== workspaceId) {
    throw new ConvexError("the library changed during the import: open it and import again");
  }
  await requireWriter(ctx, ws, userId);
  return ws;
}

const writer = (userId: string) => ({ by: "human", userId });

/** One concept, as `ingest` writes it. */
export const writeConcept = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    concept: v.object({
      id: v.string(),
      type: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      body: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      status: v.optional(v.string()),
      stale_after: v.optional(v.string()),
      sources: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, { workspaceId, userId, concept }) => {
    const ws = await sameLibrary(ctx, workspaceId, userId);
    await metered(ctx, ws, (c) => surfaced(() => model.ingest(c, ws, concept, writer(userId))), {
      writes: 1,
    });
    return null;
  },
});

const term = v.object({
  broader: v.optional(v.array(v.string())),
  narrower: v.optional(v.array(v.string())),
  related: v.optional(v.array(v.string())),
  use_for: v.optional(v.array(v.string())),
  scope_note: v.optional(v.string()),
});

/** The thesaurus's terms, as `thesaurus` sets them: one write for all. */
export const writeTerms = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    terms: v.array(v.object({ tag: v.string(), term })),
  },
  handler: async (ctx, { workspaceId, userId, terms }) => {
    const ws = await sameLibrary(ctx, workspaceId, userId);
    await metered(
      ctx,
      ws,
      (c) =>
        surfaced(async () => {
          for (const t of terms) await model.setTerm(c, ws, t.tag, t.term, writer(userId));
        }),
      { writes: 1 },
    );
    return null;
  },
});

/** One kept source's text, as `add_source` keeps it. */
export const writeSource = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    source: v.object({
      id: v.optional(v.string()),
      title: v.string(),
      text: v.string(),
      location: v.optional(v.string()),
      kind: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { workspaceId, userId, source }) => {
    const ws = await sameLibrary(ctx, workspaceId, userId);
    await metered(
      ctx,
      ws,
      (c) => surfaced(() => sources.addSource(c, ws, source, writer(userId))),
      { writes: 1 },
    );
    return null;
  },
});
