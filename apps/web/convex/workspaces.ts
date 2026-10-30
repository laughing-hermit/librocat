import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { authUserId, personId } from "./identity";
import { writesLeft } from "./limits";
import {
  createLibraryFor,
  currentWorkspaceForUserId,
  ensureWorkspace,
  librariesOf,
  pausedLibrariesOf,
  requireWriter,
  roleIn,
  setCurrentLibrary,
  workspaceForUserId,
} from "./membership";
import {
  freeLibraries,
  indexCreditsOf,
  PAY_AS_YOU_GO_CAP_CENTS,
  quotaFor,
  sourceQuota,
  usedPayAsYouGo,
} from "./model";
import { coveredFields, homeWithRoom, isTeamHome, pooled, poolOf, syncCover } from "./teamCover";

export { authUserId, ensureWorkspace, workspaceForUserId };

/**
 * The signed-in user's library for the dashboard: the one they last switched
 * to (convex/membership.ts), or null before ensure() ran.
 */
export async function workspaceFor(ctx: QueryCtx): Promise<Doc<"workspaces"> | null> {
  const userId = await authUserId(ctx);
  return userId ? await currentWorkspaceForUserId(ctx, userId) : null;
}

export async function requireWorkspace(ctx: QueryCtx): Promise<Doc<"workspaces">> {
  const ws = await workspaceFor(ctx);
  // A ConvexError, so production does not redact it (convex/errors.ts).
  if (!ws) throw new ConvexError("not signed in or no workspace yet");
  return ws;
}

/**
 * The dashboard's library, for a change to it: Readers only read (membership.ts
 * canWrite), whether from the dashboard or with their agent's token.
 */
export async function requireWritableWorkspace(ctx: QueryCtx): Promise<Doc<"workspaces">> {
  const ws = await requireWorkspace(ctx);
  await requireWriter(ctx, ws, (await authUserId(ctx)) ?? "");
  return ws;
}

/** Whether the user administers the library: its owner, or a member made admin who isn't paused. */
async function isAdmin(ctx: QueryCtx, ws: Doc<"workspaces">, userId: string | null) {
  return userId !== null && (await roleIn(ctx, ws, userId)) === "admin";
}

/**
 * The dashboard's library, for a billing change: only its admins make one,
 * and a library a Team covers has its billing at the library that holds the
 * plan (teamCover.ts).
 */
async function requireBillingAdmin(ctx: QueryCtx): Promise<Doc<"workspaces">> {
  const ws = await requireWorkspace(ctx);
  if (!(await isAdmin(ctx, ws, await personId(ctx)))) {
    throw new ConvexError("only a library's admin can change its billing");
  }
  if (ws.coveredBy) {
    const home = await ctx.db.get(ws.coveredBy);
    throw new ConvexError(
      `this library is on your Team plan, billed with ${home?.name ?? "another library"}: ` +
        "change pay-as-you-go there",
    );
  }
  return ws;
}

/** Create the user's workspace on first dashboard load. Idempotent. */
export const ensure = mutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const userId = await authUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const fallback = await ensureWorkspace(ctx, userId);
    return (await currentWorkspaceForUserId(ctx, userId))?._id ?? fallback._id;
  },
});

/** The person, for their libraries' own changes (create, switch, rename, delete, leave): never an agent. */
async function requireUserId(ctx: QueryCtx): Promise<string> {
  const userId = await personId(ctx);
  if (!userId) throw new ConvexError("not signed in");
  return userId;
}

/** The libraries the signed-in user belongs to, for the switcher, in the order they joined. */
export const libraries = query({
  args: {},
  handler: async (ctx) => {
    const userId = await authUserId(ctx);
    if (!userId) return [];
    const current = await currentWorkspaceForUserId(ctx, userId);
    const all = await librariesOf(ctx, userId);
    return all.map(({ ws, member, default: first }) => ({
      id: ws._id,
      name: ws.name,
      slug: ws.slug ?? null,
      plan: ws.plan,
      role: member.role,
      owner: ws.ownerId === userId,
      current: ws._id === current?._id,
      // The plain /mcp URL reaches the first library joined.
      default: first,
    }));
  },
});

const cleanName = (name: string) => {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) throw new ConvexError("give the library a name");
  if (n.length > 60) throw new ConvexError("a library name is at most 60 characters");
  return n;
};

/**
 * A new library, on the Free plan, with the caller as its admin; the
 * dashboard switches to it. A person owns at most FREE_LIBRARIES free ones
 * (model.ts): upgrading one, or deleting one, makes room. `checkout`: the
 * library is made to buy a plan for at once (New library, past the Free
 * one), so one more may wait on Free for its checkout.
 */
export const createLibrary = mutation({
  args: { name: v.string(), checkout: v.optional(v.boolean()) },
  handler: async (ctx, { name, checkout }) => {
    const userId = await requireUserId(ctx);
    // On a Team with room, a new library comes under it: no plan to pick.
    const home = checkout ? null : await homeWithRoom(ctx, userId);
    if (home) {
      const ws = await createLibraryFor(ctx, userId, cleanName(name));
      await ctx.db.patch(ws._id, coveredFields(home));
      await setCurrentLibrary(ctx, userId, ws._id);
      return { id: ws._id, slug: ws.slug as string };
    }
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const free = owned.filter((w) => w.plan === "free").length;
    if (free >= freeLibraries() + (checkout ? 1 : 0)) {
      const have = free === 1 ? "a Free library" : `${free} Free libraries`;
      throw new ConvexError(
        `You already have ${have}, the most one person can have. Give a library a plan on ` +
          "its Billing page, or delete one, to make another.",
      );
    }
    const ws = await createLibraryFor(ctx, userId, cleanName(name));
    await setCurrentLibrary(ctx, userId, ws._id);
    return { id: ws._id, slug: ws.slug as string };
  },
});

/** Show another of the caller's libraries on the dashboard. Agents are unaffected. */
export const switchLibrary = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const mine = await librariesOf(ctx, userId);
    if (!mine.some(({ ws }) => ws._id === id)) throw new ConvexError("not one of your libraries");
    await setCurrentLibrary(ctx, userId, id);
    return null;
  },
});

/** Rename the dashboard's library. Admins only; the slug, and so every agent's URL, stays. */
export const renameLibrary = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx);
    const ws = await currentWorkspaceForUserId(ctx, userId);
    if (!ws) throw new ConvexError("no library yet");
    const me = (await librariesOf(ctx, userId)).find((l) => l.ws._id === ws._id);
    if (me?.member.role !== "admin" && ws.ownerId !== userId) {
      throw new ConvexError("only an admin of this library can rename it");
    }
    await ctx.db.patch(ws._id, { name: cleanName(name) });
    return null;
  },
});

/**
 * Delete one library, everything in it, and its members' access, for good.
 * Its owner or an admin. A paid plan is cancelled. The dashboard moves to
 * the caller's default library (a new one if this was their last).
 */
export const deleteLibrary = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const ws = await ctx.db.get(id);
    if (!ws) throw new ConvexError("this library is already gone");
    if (!(await isAdmin(ctx, ws, userId))) {
      throw new ConvexError("only the library's owner or an admin can delete it");
    }
    if (ws.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.stripe.cancelSubscription, {
        subscriptionId: ws.stripeSubscriptionId,
        invoiceUsage: usedPayAsYouGo(ws),
      });
    }
    // Agents and the dashboard stop reaching it now; the rows go in slices.
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);
    // Everyone keeps a library: one who had only this one gets a new one. Its
    // row stays until the teardown ends, so it can't count as its owner's.
    for (const m of members) await ensureWorkspace(ctx, m.userId, undefined, id);
    // A Team's home going: the libraries it covered go back to Free, kept.
    if (isTeamHome(ws)) await ctx.db.patch(id, { plan: "free" });
    await syncCover(ctx, id);
    await ctx.scheduler.runAfter(0, internal.account.teardownLibraries, { workspaceIds: [id] });
    return null;
  },
});

/**
 * Leave a library someone else owns: your access goes, and the library stays
 * for its team. Your dashboard moves to your default library; an agent you
 * gave it to stops with a message (mcp.ts pickedLibrary) until you sign it
 * in again.
 */
export const leaveLibrary = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const ws = await ctx.db.get(id);
    if (!ws) throw new ConvexError("this library is already gone");
    if (ws.ownerId === userId) {
      throw new ConvexError("you own this library: delete it instead");
    }
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", id))
      .collect();
    const mine = members.find((m) => m.userId === userId);
    if (!mine) throw new ConvexError("you're not in this library");
    await ctx.db.delete(mine._id);
    const picked = await ctx.db
      .query("currentLibrary")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const p of picked) if (p.workspaceId === id) await ctx.db.delete(p._id);
    // Leaving their only library, they get a new one of their own.
    await ensureWorkspace(ctx, userId);
    return null;
  },
});

/** Everything the dashboard shell needs about the current user + workspace. */
export const me = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    // By `sub`, not by session: an MCP access token carries no dashboard session.
    const userId = await authUserId(ctx);
    const user = userId ? await authComponent.getAnyUserById(ctx, userId) : null;
    if (!user) return null;
    // Libraries whose Team ended, that only their owners use now (membership.ts pausedIn).
    const paused = (await pausedLibrariesOf(ctx, userId as string)).map((w) => ({
      id: w._id,
      name: w.name,
    }));
    const ws = await workspaceFor(ctx);
    if (!ws) return { email: user.email, name: user.name, paused, workspace: null };
    // A Team's libraries share its plan (teamCover.ts): its home holds it,
    // with the credits, and what they use counts together.
    const pool = await poolOf(ctx, ws);
    const home = pool.home._id === ws._id ? null : pool.home;
    const role = (await roleIn(ctx, ws, userId as string)) ?? "reader";
    const maxSourceBytes = sourceQuota(pool.home.plan);
    return {
      email: user.email,
      name: user.name,
      paused,
      workspace: {
        id: ws._id,
        name: ws.name,
        slug: ws.slug ?? null,
        owner: ws.ownerId === userId,
        admin: role === "admin",
        // What they may do here: Readers only read (membership.ts canWrite).
        role,
        plan: ws.plan,
        // This library's own; `usage` has what counts against the plan.
        conceptCount: ws.conceptCount,
        subscriptionStatus: ws.subscriptionStatus ?? null,
        cancelAt: ws.cancelAt ?? null,
        // Billed with its Team's home, or, as the home, covering these.
        billedWith: home?.name ?? null,
        covers: home ? [] : pool.libraries.slice(1).map((w) => w.name),
        // What's used of the plan, for Billing and the dashboard's banner: on
        // a Team, by its libraries together.
        usage: {
          libraries: pool.libraries.length,
          concepts: pooled(pool.libraries, "conceptCount"),
          maxConcepts: quotaFor(pool.home),
          sourceBytes: pooled(pool.libraries, "sourceBytes"),
          maxSourceBytes: Number.isFinite(maxSourceBytes) ? maxSourceBytes : null,
        },
        indexCredits: indexCreditsOf(pool.home),
        // The month's writes are used up (limits.ts): agents wait until they refill.
        writesBlocked: ((await writesLeft(ctx, ws))?.left ?? 1) === 0,
      },
    };
  },
});

/** Opt the workspace in or out of pay-as-you-go past the included credits. Admins only. */
export const setPayAsYouGo = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx: MutationCtx, { enabled }) => {
    const ws = await requireBillingAdmin(ctx);
    if (enabled && ws.plan === "free") {
      throw new ConvexError("pay-as-you-go needs a paid plan");
    }
    await ctx.db.patch(ws._id, { payAsYouGo: enabled });
    // Its subscription takes the metered price now, and keeps it (stripe.ts
    // withMeteredItem): until then Stripe shows the plan's price, not
    // "Price varies with usage".
    if (enabled) {
      await ctx.scheduler.runAfter(0, internal.stripe.meterPayAsYouGo, { workspaceId: ws._id });
    }
    return null;
  },
});

/**
 * Set the most pay-as-you-go may bill the library in a month, in whole
 * dollars (PAY_AS_YOU_GO_CAP_CENTS in model.ts). Admins only. A new cap
 * starts its emails over. Returns the cap in cents.
 */
export const setPayAsYouGoCap = mutation({
  args: { dollars: v.number() },
  handler: async (ctx: MutationCtx, { dollars }) => {
    const ws = await requireBillingAdmin(ctx);
    if (ws.plan === "free") throw new ConvexError("pay-as-you-go needs a paid plan");
    const { min, max } = PAY_AS_YOU_GO_CAP_CENTS;
    const cents = dollars * 100;
    if (!Number.isInteger(dollars) || cents < min || cents > max) {
      throw new ConvexError(
        `choose a whole number of dollars from ${min / 100} to ${(max / 100).toLocaleString("en-US")}`,
      );
    }
    await ctx.db.patch(ws._id, { payAsYouGoCapCents: cents, capNotice: undefined });
    return cents;
  },
});

/** A library's plan, for the model calls an action makes for it (ai.ts: which key they use). */
export const planOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string> =>
    (await ctx.db.get(workspaceId))?.plan ?? "free",
});
