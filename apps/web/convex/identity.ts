import { ConvexError } from "convex/values";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

/**
 * The signed-in user's id (Better Auth's), or null. Both token kinds carry it
 * as `sub` (convex/auth.config.ts): the dashboard's session and an MCP access
 * token, so the same helpers serve both doors. Kept free of Better Auth
 * imports so the Node-runtime modules (stripe.ts) can use it cheaply.
 */
export async function authUserId(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

/**
 * The signed-in person themselves, for what only a person does on the
 * dashboard: their account, their libraries, the team, and billing. An
 * agent's token acts as its person too, but names its agent (`azp`), and is
 * refused here: an agent tricked by what it read can't delete a library,
 * change who's in it, or turn on paid usage. Null when not signed in.
 */
export async function personId(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (typeof identity.azp === "string") {
    throw new ConvexError("Only you can do this, on the dashboard: an agent can't.");
  }
  return identity.subject;
}
