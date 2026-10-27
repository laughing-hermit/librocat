/**
 * Full account deletion (GDPR), not to be confused with "Delete index" on
 * Billing (concepts.ts deleteAll), which only wipes one library's concepts.
 * This deletes every library the person owns (cancelling any Stripe
 * subscription, then emptying each in slices, the way deleteAll does, and
 * removing its members, invites, and the row), takes them out of the
 * libraries they only belong to, and last removes their identity: the Better
 * Auth user, its sessions, linked accounts, every OAuth grant an agent holds,
 * and the codes emailed to them. A library someone else owns stays.
 */

import type { FunctionArgs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation } from "./_generated/server";
import { personId } from "./identity";
import * as model from "./model";

/**
 * Sign the caller out everywhere, cancel the subscriptions of the libraries
 * they own, and schedule the teardown. The sign-out comes first, in this
 * transaction: a dashboard visit or an agent's call during the teardown would
 * otherwise still pass, and could make a new library the teardown never sees.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    // The person, never an agent.
    const userId = await personId(ctx);
    if (!userId) throw new Error("not signed in");
    for (const model of ["session", "oauthAccessToken", "oauthRefreshToken"] as const) {
      await deleteAll(ctx, { model, where: [{ field: "userId", value: userId }] });
    }
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const ws of owned) {
      if (ws.stripeSubscriptionId) {
        await ctx.scheduler.runAfter(0, internal.stripe.cancelSubscription, {
          subscriptionId: ws.stripeSubscriptionId,
          invoiceUsage: model.usedPayAsYouGo(ws),
        });
      }
    }
    await ctx.scheduler.runAfter(0, internal.account.teardownLibraries, {
      workspaceIds: owned.map((ws) => ws._id),
      userId,
    });
    return null;
  },
});

/**
 * Tear down libraries one after another, each in slices (a library can be
 * too big for one transaction): its concepts and everything under them,
 * then its members, invites, and the row. With `userId`, the person's own
 * traces go last, once every library is gone (account deletion).
 */
export const teardownLibraries = internalMutation({
  args: { workspaceIds: v.array(v.id("workspaces")), userId: v.optional(v.string()) },
  handler: async (ctx, { workspaceIds, userId }) => {
    const [first, ...rest] = workspaceIds;
    if (first) {
      if ((await ctx.db.get(first)) && !(await model.deleteSome(ctx, first))) {
        await ctx.scheduler.runAfter(0, internal.account.teardownLibraries, {
          workspaceIds,
          userId,
        });
        return;
      }
      await removeLibraryRows(ctx, first);
      await ctx.scheduler.runAfter(0, internal.account.teardownLibraries, {
        workspaceIds: rest,
        userId,
      });
      return;
    }
    if (!userId) return;
    // Every owned library is gone: out of the ones they only belonged to.
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    const pref = await ctx.db
      .query("currentLibrary")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const p of pref) await ctx.db.delete(p._id);
    await removeIdentity(ctx, userId);
  },
});

/** A library's own rows, once its index is empty: members, invites, dashboard picks, agents' rows, its kept weeding report, the row. */
async function removeLibraryRows(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  for (const table of ["members", "invites", "currentLibrary", "agents", "weedings"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
  if (await ctx.db.get(workspaceId)) await ctx.db.delete(workspaceId);
}

/**
 * The emailed codes Better Auth keeps for an address (convex/email.ts): one
 * row per purpose, `<purpose>-otp-<email>`, left behind when a code is never
 * used. A change of address also names the new one after a dash.
 */
export function codeIdentifiers(email: string) {
  return {
    exact: ["sign-in", "email-verification", "forget-password"].map((t) => `${t}-otp-${email}`),
    prefix: `change-email-otp-${email}-`,
  };
}

/**
 * The identity, in the Better Auth component: every OAuth grant an agent
 * holds (access tokens, refresh tokens, consents), any OAuth client the person
 * registered, the sessions, the linked accounts, the codes emailed to them,
 * then the user row itself; and the library each agent was given
 * (agentLibraries) and its row in Connect's list (agents). Shared with
 * convex/dev.ts deleteUser.
 */
export async function removeIdentity(ctx: MutationCtx, userId: string) {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: userId }],
  })) as { email?: string } | null;
  for (const model of [
    "oauthAccessToken",
    "oauthRefreshToken",
    "oauthConsent",
    "oauthClient",
    "session",
    "account",
  ] as const) {
    await deleteAll(ctx, { model, where: [{ field: "userId", value: userId }] });
  }
  if (user?.email) {
    const codes = codeIdentifiers(user.email);
    for (const value of codes.exact) {
      await deleteAll(ctx, { model: "verification", where: [{ field: "identifier", value }] });
    }
    await deleteAll(ctx, {
      model: "verification",
      where: [{ field: "identifier", value: codes.prefix, operator: "starts_with" }],
    });
  }
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: { model: "user", where: [{ field: "_id", value: userId }] },
  });
  const picks = await ctx.db
    .query("agentLibraries")
    .withIndex("by_user_client", (q) => q.eq("userId", userId))
    .collect();
  for (const p of picks) await ctx.db.delete(p._id);
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const a of agents) await ctx.db.delete(a._id);
}

async function deleteAll(
  ctx: MutationCtx,
  input: FunctionArgs<typeof components.betterAuth.adapter.deleteMany>["input"],
) {
  let cursor: string | null = null;
  for (;;) {
    const page: { isDone: boolean; continueCursor: string } = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      { input, paginationOpts: { numItems: 100, cursor } },
    );
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
}
