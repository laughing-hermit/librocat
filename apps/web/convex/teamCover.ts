/**
 * One Team subscription covers every library its owner owns, up to
 * TEAM_LIBRARIES: the library that holds the subscription (its home) and
 * the others, which take the Team plan with `coveredBy` pointing home. A
 * person grows from Free to Individual to Team and keeps every library, on
 * one bill.
 *
 * - A library that comes under a Team keeps what it paid for: its own
 *   subscription ends at its period's end and doesn't bill again (stripe.ts
 *   endAtPeriodEnd); while it's covered, that subscription's events change
 *   nothing but to end it again, should the first try have failed
 *   (billing.ts setStatus).
 * - Seats are the home's: each person counts once across the team's
 *   libraries (teamPeople), and the per-person limits read the same seats.
 * - So are the plan's allowances: its libraries share one Team's concepts,
 *   storage, text, credits, pay-as-you-go, and month of calls, writes, and
 *   file transfer (poolOf), so one bill's worst case holds however many
 *   libraries it covers.
 * - When the Team ends (or its home is deleted), the libraries it covered
 *   go back to Free, with Free's limits; nothing in them is deleted. One
 *   whose own plan still has paid time gets it back (stripe.ts resync).
 */

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** Libraries one Team subscription covers, its home included: a guardrail on what one bill holds. */
export const TEAM_LIBRARIES = 10;

/** A subscription that still bills: a missed payment (past_due) keeps the plan while Stripe retries. */
const LIVE = new Set(["active", "trialing", "past_due"]);

/** A Team home: a Team library on its own (live) plan, not covered by another. */
export const isTeamHome = (ws: Doc<"workspaces">) =>
  ws.plan === "team" && !ws.coveredBy && LIVE.has(ws.subscriptionStatus ?? "active");

/** The libraries a home covers (not the home itself). */
export async function coveredBy(ctx: QueryCtx, homeId: Id<"workspaces">) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_covered", (q) => q.eq("coveredBy", homeId))
    .collect();
}

/** The library that holds `ws`'s Team plan: its home if it's covered, itself if it's a home, else none. */
export async function teamHomeOf(ctx: QueryCtx, ws: Doc<"workspaces">) {
  if (ws.coveredBy) return await ctx.db.get(ws.coveredBy);
  return isTeamHome(ws) ? ws : null;
}

/** A team's libraries: its home and those it covers. */
export async function teamLibraries(ctx: QueryCtx, home: Doc<"workspaces">) {
  return [home._id, ...(await coveredBy(ctx, home._id)).map((w) => w._id)];
}

/** Everyone in a team, each once: the members of its home and of every library it covers. */
export async function teamPeople(ctx: QueryCtx, home: Doc<"workspaces">): Promise<Set<string>> {
  const people = new Set<string>();
  for (const id of await teamLibraries(ctx, home)) {
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", id))
      .collect();
    for (const m of members) people.add(m.userId);
  }
  return people;
}

/**
 * The libraries whose allowances a library shares: on a Team, its home and
 * every library it covers; otherwise the library alone. `home` holds the
 * plan, its credits, and pay-as-you-go.
 */
export async function poolOf(ctx: QueryCtx, ws: Doc<"workspaces">) {
  const homeId = ws.coveredBy ?? (isTeamHome(ws) ? ws._id : null);
  const home = homeId ? await ctx.db.get(homeId) : null;
  if (!home) return { home: ws, libraries: [ws] };
  return { home, libraries: [home, ...(await coveredBy(ctx, home._id))] };
}

/** A count summed over libraries that share their allowances. */
export const pooled = (
  libraries: Doc<"workspaces">[],
  field: "conceptCount" | "sourceBytes" | "textBytes",
) => libraries.reduce((n, w) => n + (w[field] ?? 0), 0);

/** The library whose credits and pay-as-you-go a library spends: its home, when a Team covers it. */
export async function payerOf(ctx: QueryCtx, ws: Doc<"workspaces">) {
  return (ws.coveredBy ? await ctx.db.get(ws.coveredBy) : null) ?? ws;
}

/** What a library's month of calls, writes, and file transfer counts under (limits.ts). */
export const poolKey = (ws: Doc<"workspaces">): string => ws.coveredBy ?? ws._id;

/** The owner's live Team home with room for another library, if they have one. */
export async function homeWithRoom(ctx: QueryCtx, ownerId: string) {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const home of owned.filter(isTeamHome)) {
    if ((await coveredBy(ctx, home._id)).length < TEAM_LIBRARIES - 1) return home;
  }
  return null;
}

/**
 * A library taking its home's Team plan: the plan, the seats, where it's
 * billed, and when the Team ends, if it's cancelled. Its own subscription's
 * id stays, for when the Team no longer covers it (uncover).
 */
export const coveredFields = (home: Doc<"workspaces">) => ({
  plan: "team" as const,
  coveredBy: home._id,
  seats: home.seats,
  subscriptionStatus: home.subscriptionStatus,
  cancelAt: home.cancelAt,
});

/**
 * Bring a home's coverage up to date, after its plan, status, or seats
 * change: while it's a live Team, its owner's other libraries come under it
 * (those it covers, then the oldest, up to TEAM_LIBRARIES in all), each
 * with the home's seats; otherwise those it covered go back to Free.
 */
export async function syncCover(ctx: MutationCtx, homeId: Id<"workspaces">) {
  const home = await ctx.db.get(homeId);
  const covered = await coveredBy(ctx, homeId);
  if (!home || !isTeamHome(home)) {
    for (const w of covered) await uncover(ctx, w);
    return;
  }
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", home.ownerId))
    .collect();
  const room = TEAM_LIBRARIES - 1;
  const candidates = owned
    .filter((w) => w._id !== homeId && (w.coveredBy === homeId || !w.coveredBy))
    // Another Team home of theirs keeps its own subscription.
    .filter((w) => !(isTeamHome(w) && w.stripeSubscriptionId))
    // Those it covers stay covered; then the oldest of the rest.
    .sort(
      (a, b) =>
        Number(a.coveredBy !== homeId) - Number(b.coveredBy !== homeId) ||
        a._creationTime - b._creationTime,
    );
  const join = candidates.slice(0, room);
  // Never more than TEAM_LIBRARIES in all.
  for (const w of candidates.slice(room)) if (w.coveredBy === homeId) await uncover(ctx, w);
  for (const w of join) {
    if (w.stripeSubscriptionId && !w.coveredBy && w.plan !== "free") {
      // Its own plan runs to the end of what it paid for, and bills no more.
      await ctx.scheduler.runAfter(0, internal.stripe.endAtPeriodEnd, {
        subscriptionId: w.stripeSubscriptionId,
      });
    }
    await ctx.db.patch(w._id, coveredFields(home));
  }
}

/** A library its Team no longer covers: back to Free, everything in it kept. */
async function uncover(ctx: MutationCtx, w: Doc<"workspaces">) {
  await ctx.db.patch(w._id, {
    plan: "free",
    coveredBy: undefined,
    seats: undefined,
    subscriptionStatus: undefined,
    cancelAt: undefined,
  });
  // Its own plan may still have paid time: back to it, as Stripe has it.
  if (w.stripeSubscriptionId) {
    await ctx.scheduler.runAfter(0, internal.stripe.resync, {
      subscriptionId: w.stripeSubscriptionId,
    });
  }
}
