// What Better Auth no longer needs, deleted a batch at a time by the daily
// cleanup (convex/authCleanup.ts), so its tables don't grow forever: each
// token refresh writes a new refresh token and leaves the old one, and
// sessions and emailed codes outlive their use. OAuth clients stay, approved
// or not: an agent keeps its registration and may come back with it any
// time, and a deleted one would leave its person stuck at an error.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DAY = 86_400_000;
/** Rows of each kind one run deletes; the cleanup runs again while there are more. */
const BATCH = 200;
/** A refresh token lives 30 days (the OAuth provider's default): older ones are all expired. */
const REFRESH_LIFE_MS = 31 * DAY;
/** An access token lives an hour. */
const ACCESS_LIFE_MS = DAY;

/** One batch of each: expired sessions, emailed codes, and tokens. `more` while a batch was full. */
export const expired = mutation({
  args: {},
  returns: v.object({ deleted: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const batches = [
      await ctx.db
        .query("session")
        .withIndex("expiresAt", (q) => q.lt("expiresAt", now))
        .take(BATCH),
      await ctx.db
        .query("verification")
        .withIndex("expiresAt", (q) => q.lt("expiresAt", now))
        .take(BATCH),
      await ctx.db
        .query("oauthRefreshToken")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - REFRESH_LIFE_MS))
        .take(BATCH),
      await ctx.db
        .query("oauthAccessToken")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - ACCESS_LIFE_MS))
        .take(BATCH),
    ];
    let deleted = 0;
    for (const rows of batches) {
      for (const r of rows) await ctx.db.delete(r._id);
      deleted += rows.length;
    }
    return { deleted, more: batches.some((rows) => rows.length === BATCH) };
  },
});

/** OAuth clients registered since `since`, counted up to `limit` (a bounded read). */
export const registeredSince = query({
  args: { since: v.number(), limit: v.number() },
  returns: v.number(),
  handler: async (ctx, { since, limit }) =>
    (
      await ctx.db
        .query("oauthClient")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
        .take(limit)
    ).length,
});
