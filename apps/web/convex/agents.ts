/**
 * Connected agents: the OAuth clients (Claude Code, Cursor, Codex, ...) a user
 * approved on /consent, read from the Better Auth component, and the library
 * each one works in (agentLibraries), picked on /consent too. The dashboard
 * lists them, teammates' too (each agent's row in `agents`: its person, the
 * library its calls last reached, and when), and revokes them; a revoke is
 * immediate because every MCP call checks the grant (agentAllowed), not just
 * the access token's signature.
 */

import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { appLabel } from "./apps";
import { authUserId, personId } from "./identity";
import { defaultPaused, libraryBySlug, pausedIn, workspaceForUserId } from "./membership";
import { nameOf, peopleOf } from "./people";

type Consent = { _id: string; clientId: string; scopes: string[]; createdAt?: number | null };
type Client = { clientId: string; name?: string | null; uri?: string | null } | null;

/** This user's grant for this agent, if they still hold one. */
async function consentOf(ctx: QueryCtx, userId: string, clientId: string) {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthConsent",
    where: [
      { field: "clientId", value: clientId },
      { field: "userId", value: userId },
    ],
  })) as Consent | null;
}

/**
 * Does this user still have a grant for this agent? Checked on every MCP call,
 * in Better Auth itself: whatever removes a grant cuts the agent off at once.
 */
export async function agentAllowed(ctx: QueryCtx, userId: string, clientId: string) {
  return (await consentOf(ctx, userId, clientId)) !== null;
}

/** An agent's row in Connect's list. */
async function agentOf(ctx: QueryCtx, userId: string, clientId: string) {
  return await ctx.db
    .query("agents")
    .withIndex("by_user_client", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .first();
}

/** An agent's row, gone with its grant (a disconnect, or the consent's own trigger). */
export async function forgetAgent(ctx: MutationCtx, userId: string, clientId: string) {
  const rows = await ctx.db
    .query("agents")
    .withIndex("by_user_client", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
}

/**
 * An agent its person just approved (the oauthConsent trigger, convex/auth.ts,
 * once the grant is saved): its row, in the library they picked for it, else
 * their default one.
 */
export const connected = internalMutation({
  args: { userId: v.string(), clientId: v.string() },
  handler: async (ctx, { userId, clientId }) => {
    const consent = await consentOf(ctx, userId, clientId);
    // Disconnected again before this ran.
    if (!consent) return null;
    const pick = await pickOf(ctx, userId, clientId);
    const ws = pick ? await ctx.db.get(pick.workspaceId) : await workspaceForUserId(ctx, userId);
    if (!ws) return null;
    // Their first library is paused (membership.ts defaultPaused): the one
    // /consent named becomes the agent's pick, so it reaches that one.
    if (!pick && (await defaultPaused(ctx, userId))) {
      await ctx.db.insert("agentLibraries", { userId, clientId, workspaceId: ws._id });
    }
    const row = {
      workspaceId: ws._id,
      name: await clientName(ctx, clientId),
      connectedAt: consent.createdAt ?? Date.now(),
    };
    const had = await agentOf(ctx, userId, clientId);
    if (had) await ctx.db.patch(had._id, row);
    else await ctx.db.insert("agents", { userId, clientId, ...row });
    return null;
  },
});

/** An agent's calls update its row at most this often (and at once when its library changes). */
const USE_EVERY_MS = 60 * 60_000;

/**
 * An agent's call reached a library: its row shows that library and when, so
 * Connect's list says which agents are in use. One write an hour at most. An
 * agent approved before rows were kept gets one here. Returns the name it
 * registered with, which its revisions and questions carry.
 */
export async function noteUse(
  ctx: MutationCtx,
  userId: string,
  clientId: string,
  workspaceId: Id<"workspaces">,
): Promise<string> {
  const row = await agentOf(ctx, userId, clientId);
  const now = Date.now();
  if (!row) {
    const consent = await consentOf(ctx, userId, clientId);
    const name = await clientName(ctx, clientId);
    await ctx.db.insert("agents", {
      userId,
      clientId,
      workspaceId,
      name,
      connectedAt: consent?.createdAt ?? now,
      usedAt: now,
    });
    return name;
  }
  if (row.workspaceId !== workspaceId || now - (row.usedAt ?? 0) >= USE_EVERY_MS) {
    await ctx.db.patch(row._id, { workspaceId, usedAt: now });
  }
  return row.name;
}

/** The library this agent's person picked for it on /consent, if they did. */
export async function pickOf(ctx: QueryCtx, userId: string, clientId: string) {
  return await ctx.db
    .query("agentLibraries")
    .withIndex("by_user_client", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .unique();
}

/** An agent's display name: what it registered as, else its client id. */
export async function clientName(ctx: QueryCtx, clientId: string): Promise<string> {
  const client = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthClient",
    where: [{ field: "clientId", value: clientId }],
  })) as Client;
  return client?.name ?? clientId;
}

/** A row of Connect's list, before it's named: whose agent, and where. */
type Listed = {
  userId: string;
  clientId: string;
  name: string;
  workspaceId: Id<"workspaces"> | null;
  connectedAt: number | null;
  usedAt: number | null;
};

/**
 * Every agent in the caller's libraries: theirs (each grant, so one not used
 * yet shows too), then their teammates' in the libraries they share; each
 * with its app, its person, its library, and when it was approved and last
 * used. Only their own can be disconnected (revoke).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await authUserId(ctx);
    if (!userId) return [];
    const { page } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "oauthConsent",
      where: [{ field: "userId", value: userId }],
      paginationOpts: { numItems: 100, cursor: null },
    });
    const consents = page as unknown as Consent[];
    const rows = new Map(
      (
        await ctx.db
          .query("agents")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(100)
      ).map((r) => [r.clientId, r]),
    );
    const fallback = await workspaceForUserId(ctx, userId);
    const listed: Listed[] = [];
    for (const c of consents) {
      const row = rows.get(c.clientId);
      if (row) {
        listed.push({ ...row, connectedAt: row.connectedAt, usedAt: row.usedAt ?? null });
        continue;
      }
      // Approved before rows were kept, and not used since: its pick, else the default (convex/mcp.ts).
      const pick = await pickOf(ctx, userId, c.clientId);
      listed.push({
        userId,
        clientId: c.clientId,
        name: await clientName(ctx, c.clientId),
        workspaceId: pick?.workspaceId ?? fallback?._id ?? null,
        connectedAt: c.createdAt ?? null,
        usedAt: null,
      });
    }
    // Teammates' agents, in each library the caller is in, from people still
    // in it: none in a library whose Team ended (membership.ts pausedIn).
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    for (const { workspaceId } of memberships) {
      const ws = await ctx.db.get(workspaceId);
      if (!ws || pausedIn(ws, userId)) continue;
      const people = new Set(
        (
          await ctx.db
            .query("members")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .take(500)
        )
          .filter((m) => !pausedIn(ws, m.userId))
          .map((m) => m.userId),
      );
      const theirs = await ctx.db
        .query("agents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .take(100);
      for (const a of theirs) {
        if (a.userId === userId || !people.has(a.userId)) continue;
        listed.push({ ...a, usedAt: a.usedAt ?? null });
      }
    }
    const people = await peopleOf(
      ctx,
      listed.map((a) => a.userId),
    );
    const libraries = new Map<string, string>();
    for (const id of new Set(listed.map((a) => a.workspaceId))) {
      const ws = id ? await ctx.db.get(id) : null;
      if (id && ws) libraries.set(id, ws.name);
    }
    return (
      listed
        .map((a) => ({
          key: `${a.userId}:${a.clientId}`,
          clientId: a.clientId,
          app: appLabel(a.name),
          person: nameOf(people.get(a.userId)),
          you: a.userId === userId,
          library: (a.workspaceId && libraries.get(a.workspaceId)) || null,
          connectedAt: a.connectedAt,
          usedAt: a.usedAt,
        }))
        // Yours first (the ones you can disconnect), then your teammates', each
        // newest first by last use, never used last (Connect reverses each for oldest first).
        .sort(
          (a, b) =>
            Number(b.you) - Number(a.you) ||
            (b.usedAt ?? 0) - (a.usedAt ?? 0) ||
            (b.connectedAt ?? 0) - (a.connectedAt ?? 0),
        )
    );
  },
});

async function deleteAll(
  ctx: MutationCtx,
  model: "oauthConsent" | "oauthRefreshToken" | "oauthAccessToken",
  userId: string,
  clientId: string,
) {
  let cursor: string | null = null;
  for (;;) {
    const res: { isDone: boolean; continueCursor: string } = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: {
          model,
          where: [
            { field: "clientId", value: clientId },
            { field: "userId", value: userId },
          ],
        },
        paginationOpts: { numItems: 100, cursor },
      },
    );
    if (res.isDone) return;
    cursor = res.continueCursor;
  }
}

/** Disconnect an agent: its grant and every token it holds. It must sign in again. Its person's to do. */
export const revoke = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    const userId = await personId(ctx);
    if (!userId) throw new ConvexError("not signed in");
    for (const model of ["oauthConsent", "oauthRefreshToken", "oauthAccessToken"] as const) {
      await deleteAll(ctx, model, userId, clientId);
    }
    // Signing in again asks for its library again.
    const pick = await pickOf(ctx, userId, clientId);
    if (pick) await ctx.db.delete(pick._id);
    await forgetAgent(ctx, userId, clientId);
    return null;
  },
});

/**
 * The library an agent works in, picked on /consent just before its person
 * approves it (src/app/(auth)/consent/actions.ts): its MCP calls then reach
 * that library at the plain /mcp URL. Only a library they belong to, and
 * only by the person: an agent's own token (it names the agent, `azp`) can't
 * move an agent. Picking again replaces the pick.
 */
export const choose = mutation({
  args: { clientId: v.string(), library: v.string() },
  handler: async (ctx, { clientId, library }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("not signed in");
    if (typeof identity.azp === "string") {
      throw new ConvexError("an agent's library is picked by its person, when they approve it");
    }
    const userId = identity.subject;
    const ws = await libraryBySlug(ctx, userId, library);
    if (!ws) throw new ConvexError(`no library "${library}" that you belong to`);
    const pick = await pickOf(ctx, userId, clientId);
    if (pick) await ctx.db.patch(pick._id, { workspaceId: ws._id });
    else await ctx.db.insert("agentLibraries", { userId, clientId, workspaceId: ws._id });
    // An agent approved again: its row moves with it.
    const row = await agentOf(ctx, userId, clientId);
    if (row) await ctx.db.patch(row._id, { workspaceId: ws._id });
    return null;
  },
});
