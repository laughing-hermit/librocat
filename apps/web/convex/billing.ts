/**
 * Internal billing state transitions, called from stripe.ts, and the emails
 * pay-as-you-go's monthly cap sends (model.ts spendCredits).
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { authComponent } from "./auth";
import { sendEmail } from "./email";
import { resumeRoom, startGrace } from "./grace";
import { currentWorkspaceForUserId, pausedIn } from "./membership";
import { indexCreditsOf } from "./model";
import { payerOf, peopleOfTeamAt, syncCover, teamHomeOf, teamPeople } from "./teamCover";

/** The Stripe customer a library's pay-as-you-go bills: its Team's, when a Team covers it (teamCover.ts). */
export const customerOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const ws = await ctx.db.get(args.workspaceId);
    return ws ? ((await payerOf(ctx, ws)).stripeCustomerId ?? null) : null;
  },
});

/**
 * For stripe.ts: whether a library has pay-as-you-go on, and its own
 * subscription. Only those subscriptions carry the metered price, so
 * Stripe's pages show everyone else the plan's price.
 */
export const metering = internalQuery({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("workspaces", args.workspaceId);
    const ws = id ? await ctx.db.get(id) : null;
    return {
      payAsYouGo: ws?.payAsYouGo === true,
      subscriptionId: ws?.stripeSubscriptionId ?? null,
    };
  },
});

/**
 * For Billing (stripe.ts): the library it acts on, the one the dashboard
 * shows; whether the caller is its admin; how many people are in it (on a
 * Team, each person once across its libraries, teamCover.ts); and, for a
 * library a Team covers, the library that holds its plan.
 */
export const seatsContext = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const ws = await currentWorkspaceForUserId(ctx, userId);
    if (!ws) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
      .collect();
    const me = members.find((m) => m.userId === userId);
    const home = await teamHomeOf(ctx, ws);
    return {
      ws,
      // Not on a Team: everyone a Team bought here would bring back, across its libraries.
      members: (home ? await teamPeople(ctx, home) : await peopleOfTeamAt(ctx, ws)).size,
      admin: me?.role === "admin" || ws.ownerId === userId,
      billedWith: ws.coveredBy && home ? home.name : null,
    };
  },
});

/** The person's address, for a first Checkout to start with it filled in (stripe.ts). */
export const emailOf = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { userId }) =>
    (await authComponent.getAnyUserById(ctx, userId))?.email ?? null,
});

/** The seats a Team subscription pays for, as Stripe says (updateSeats, and the webhook). */
export const setSeats = internalMutation({
  args: { workspaceId: v.id("workspaces"), seats: v.number() },
  handler: async (ctx, { workspaceId, seats }) => {
    await ctx.db.patch(workspaceId, { seats });
    // The libraries it covers take the same seats.
    await syncCover(ctx, workspaceId);
  },
});

// Stripe metadata is untyped strings; anything unexpected falls back to
// "individual" so a paid subscription never lands on the free plan.
function paidPlan(raw: string | undefined): "individual" | "team" {
  return raw === "team" ? "team" : "individual";
}

export const activate = internalMutation({
  args: {
    workspaceId: v.string(),
    plan: v.optional(v.string()),
    customerId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    seats: v.optional(v.number()),
    /** False while the first payment hasn't settled: the ids are kept, the plan waits. */
    paid: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsId = ctx.db.normalizeId("workspaces", args.workspaceId);
    if (!wsId) throw new Error(`not a workspace id: ${args.workspaceId}`);
    // A library a Team covers keeps its Team. A plan bought for it anyway (a checkout
    // begun before the Team) ends at its period's end, as a library's own plan does
    // when it comes under a Team (teamCover.ts).
    if ((await ctx.db.get(wsId))?.coveredBy) {
      if (args.subscriptionId) {
        await ctx.scheduler.runAfter(0, internal.stripe.endAtPeriodEnd, {
          subscriptionId: args.subscriptionId,
        });
      }
      return;
    }
    const ids = {
      stripeCustomerId: args.customerId,
      stripeSubscriptionId: args.subscriptionId,
      ...(args.seats ? { seats: args.seats } : {}),
    };
    if (args.paid === false) {
      await ctx.db.patch(wsId, { ...ids, subscriptionStatus: "incomplete" });
      return;
    }
    await ctx.db.patch(wsId, { ...ids, plan: paidPlan(args.plan), subscriptionStatus: "active" });
    // A Team brings its owner's other libraries under it (teamCover.ts).
    await syncCover(ctx, wsId);
  },
});

export const setStatus = internalMutation({
  args: {
    workspaceId: v.string(),
    status: v.string(),
    plan: v.optional(v.string()),
    seats: v.optional(v.number()),
    subscriptionId: v.optional(v.string()),
    cancelAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsId = ctx.db.normalizeId("workspaces", args.workspaceId);
    if (!wsId) throw new Error(`not a workspace id: ${args.workspaceId}`);
    // A missed payment (past_due) keeps the plan while Stripe retries the card;
    // only a subscription Stripe gave up on (unpaid, canceled, ...) drops to free.
    const active = ["active", "trialing", "past_due"].includes(args.status);
    const ws = await ctx.db.get(wsId);
    if (!ws) return;
    if (ws.coveredBy) {
      // A library a Team covers has its home's plan. A subscription of its own
      // still billing ends at its period's end: again, should the first try
      // have failed (teamCover.ts).
      if (args.subscriptionId && active && !args.cancelAt) {
        await ctx.scheduler.runAfter(0, internal.stripe.endAtPeriodEnd, {
          subscriptionId: args.subscriptionId,
        });
      }
      return;
    }
    // Another subscription than the library's own (an old one ending) changes nothing.
    if (
      ws?.stripeSubscriptionId &&
      args.subscriptionId &&
      args.subscriptionId !== ws.stripeSubscriptionId
    ) {
      return;
    }
    await ctx.db.patch(wsId, {
      plan: active ? paidPlan(args.plan) : "free",
      subscriptionStatus: args.status,
      ...(args.seats ? { seats: args.seats } : {}),
      // Undefined clears it: renewed again, or already ended.
      cancelAt: active ? args.cancelAt : undefined,
      // On a plan, a library paused past Free's one is back (grace.ts).
      ...(active ? { pausedAt: undefined } : {}),
    });
    // A Team's libraries follow it: covered while it lives, Free when it ends.
    await syncCover(ctx, wsId);
    // A paid plan ended: Free's limits, and what follows (grace.ts). One
    // began: room on Free, maybe, for a library paused past its one.
    if (!active && ws.plan !== "free") await startGrace(ctx, ws.ownerId);
    if (active) await resumeRoom(ctx, ws.ownerId);
  },
});

// ---- pay-as-you-go's cap -----------------------------------------------------

const siteUrl = () => (process.env.SITE_URL ?? "https://librocat.com").replace(/\/$/, "");

/** "$10" for whole dollars, "$3.12" otherwise. */
const usd = (cents: number) =>
  cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`;

/** "October 2026" from a period key ("2026-10"). */
const monthOf = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** The cap email: at 80% of the cap, or at the cap. Pure, exported for tests. */
export function capNoticeEmail(o: {
  library: string;
  level: 80 | 100;
  spentCents: number;
  capCents: number;
  period: string;
  billingUrl: string;
}): { subject: string; text: string } {
  const spent = usd(o.spentCents);
  const cap = usd(o.capCents);
  const month = monthOf(o.period);
  const footer = "You get this because you administer this library on librocat.";
  if (o.level === 80) {
    return {
      subject: `${o.library}: pay-as-you-go is at ${spent} of its ${cap} cap`,
      text: [
        `${o.library} has spent ${spent} of its ${cap} pay-as-you-go cap for ${month}.`,
        "At the cap, Libro's cataloging and file reading wait until next month, or until you raise the cap.",
        `Change it on Billing: ${o.billingUrl}`,
        footer,
      ].join("\n\n"),
    };
  }
  return {
    subject: `${o.library}: pay-as-you-go reached its ${cap} cap`,
    text: [
      `${o.library} has spent ${spent} of its ${cap} pay-as-you-go cap for ${month}, and Libro's next credit would go past it. Pay-as-you-go bills nothing more this month.`,
      "Libro's cataloging and file reading wait until next month, or until you raise the cap.",
      `Change it on Billing: ${o.billingUrl}`,
      footer,
    ].join("\n\n"),
  };
}

/** What the cap email says, and who gets it: the library's admins. */
export const capNoticeData = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return null;
    const admins = (
      await ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).filter((m) => (m.role === "admin" || m.userId === ws.ownerId) && !pausedIn(ws, m.userId));
    const recipients: string[] = [];
    for (const m of admins) {
      const user = await authComponent.getAnyUserById(ctx, m.userId);
      if (user?.email) recipients.push(user.email);
    }
    const credits = indexCreditsOf(ws);
    return {
      library: ws.name,
      spentCents: credits.overage_cents,
      capCents: credits.cap_cents,
      period: credits.period,
      recipients,
    };
  },
});

/** Email a library's admins that pay-as-you-go is near its cap (80) or at it (100). */
export const sendCapNotice = internalAction({
  args: { workspaceId: v.id("workspaces"), level: v.union(v.literal(80), v.literal(100)) },
  handler: async (ctx, { workspaceId, level }): Promise<number> => {
    const data = await ctx.runQuery(internal.billing.capNoticeData, { workspaceId });
    if (!data) return 0;
    const email = capNoticeEmail({ ...data, level, billingUrl: `${siteUrl()}/dashboard/billing` });
    let sent = 0;
    for (const to of data.recipients) {
      try {
        await sendEmail({ to, ...email });
        sent += 1;
      } catch (exc) {
        const error = exc instanceof Error ? exc.message : String(exc);
        console.warn(JSON.stringify({ capNotice: { workspaceId, level, error } }));
      }
    }
    return sent;
  },
});
