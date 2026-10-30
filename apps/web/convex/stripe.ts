"use node";

/**
 * Stripe billing: Checkout for the paid plans, Individual to Team in place,
 * webhook fulfillment, and the
 * pay-as-you-go index-credit meter. Runs in the Node runtime (the Stripe SDK
 * needs it). Env on the Convex deployment: STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_INDIVIDUAL, STRIPE_PRICE_ID_TEAM
 * (monthly), STRIPE_PRICE_ID_INDIVIDUAL_ANNUAL, STRIPE_PRICE_ID_TEAM_ANNUAL,
 * STRIPE_PRICE_ID_INDEXATION (a metered price on the meter named by
 * STRIPE_METER_INDEXATION, default "librocat_indexation"), SITE_URL, and
 * STRIPE_MANAGED_PAYMENTS ("1" sells through Stripe's Managed Payments, with
 * Link as the merchant of record). See docs/cloud.md.
 */

import { ConvexError, v } from "convex/values";
import Stripe from "stripe";
import { internal } from "./_generated/api";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { personId } from "./identity";
import { MAX_TEAM_SEATS, MIN_TEAM_SEATS } from "./model";
import { hmac } from "./signing";

/** A subscription's seats: the quantity of its one licensed (not metered) item. */
function seatsOf(sub: Stripe.Subscription): number | undefined {
  return sub.items.data.find((i) => i.price.recurring?.usage_type !== "metered")?.quantity;
}

/**
 * Whether a subscription needs the metered index-credit price now: only once
 * its library turns pay-as-you-go on, so Stripe's pages show everyone else
 * the plan's price, not "Price varies with usage". It's added after
 * Checkout, since Checkout can't sell a yearly plan and a monthly meter
 * together, and it stays once added.
 */
export function needsMeteredItem(
  sub: Pick<Stripe.Subscription, "status" | "items">,
  meteredPrice: string,
  payAsYouGo: boolean,
): boolean {
  return (
    payAsYouGo &&
    ["active", "trialing", "past_due"].includes(sub.status) &&
    !sub.items.data.some((i) => i.price.id === meteredPrice)
  );
}

/** Add the metered price to a paid subscription whose library has pay-as-you-go on, once. */
async function withMeteredItem(sub: Stripe.Subscription, payAsYouGo: boolean): Promise<void> {
  const metered = process.env.STRIPE_PRICE_ID_INDEXATION;
  if (!metered || !needsMeteredItem(sub, metered, payAsYouGo)) return;
  // The key makes a retried webhook, or two events at once, add it only once.
  await stripeClient().subscriptionItems.create(
    { subscription: sub.id, price: metered },
    { idempotencyKey: `metered-item-${sub.id}` },
  );
}

/** Whether a library has pay-as-you-go on (billing.ts metering), for its subscription's metered price. */
async function payAsYouGoOn(ctx: ActionCtx, workspaceId: string): Promise<boolean> {
  return (await ctx.runQuery(internal.billing.metering, { workspaceId })).payAsYouGo;
}

/** Paying, switching, and cancelling are the admin's, as seats and pay-as-you-go are (workspaces.ts). */
const ONLY_ADMIN = "only a library's admin can change its billing";

/**
 * What a change charged today says when the card is declined: nothing
 * changed (approvalFor; src/app/dashboard/billing/actions.ts).
 */
export const DECLINED =
  "the card on file was declined, so nothing changed: change it in Manage subscription on Billing, with the pencil next to your plan's card, then try again";

/** Rethrow Stripe's "the payment failed" (402) as DECLINED. */
function declined(e: unknown): never {
  if (e instanceof Stripe.errors.StripeError && e.statusCode === 402) {
    throw new ConvexError(DECLINED);
  }
  throw e;
}

/**
 * A change charged today (switchToTeam, updateSeats) is made with
 * `pending_if_incomplete`: Stripe holds it until its invoice is paid. Paid on
 * the spot, it's applied: null. A bank that asks its cardholder to approve
 * the charge (3-D Secure) gets them Stripe's page for the invoice, where they
 * approve it; once paid, the change applies, and the webhook records it. A
 * declined card leaves nothing behind: voiding the invoice drops the change,
 * and DECLINED says so.
 */
async function approvalFor(stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  if (!sub.pending_update) return null;
  const invoiceId =
    typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  if (!invoiceId) throw new ConvexError(DECLINED);
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments.data.payment.payment_intent"],
  });
  const intent = invoice.payments?.data[0]?.payment.payment_intent;
  if (
    typeof intent === "object" &&
    intent.status === "requires_action" &&
    invoice.hosted_invoice_url
  ) {
    return invoice.hosted_invoice_url;
  }
  await stripe.invoices.voidInvoice(invoiceId);
  throw new ConvexError(DECLINED);
}

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set on the Convex deployment");
  return new Stripe(key);
}

// Every other Stripe var here throws when unset; this one silently fell back
// to localhost, which meant a missing prod value shipped Checkout and portal
// URLs pointing at a developer's machine. `pnpm dlx @convex-dev/auth` already
// sets SITE_URL on both deployments (docs/cloud.md), so this should
// never actually be unset outside a fresh, unconfigured deployment.
function siteUrl(): string {
  const site = process.env.SITE_URL;
  if (!site) throw new Error("SITE_URL is not set on the Convex deployment");
  return site;
}

/**
 * Start a Stripe Checkout session for a paid plan. Returns the URL. Team is
 * priced per person: the seats start at the people already in the library
 * (at least MIN_TEAM_SEATS), and Checkout lets them be changed.
 */
export const createCheckoutSession = action({
  args: {
    plan: v.union(v.literal("individual"), v.literal("team")),
    interval: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = await personId(ctx);
    if (!userId) throw new Error("not signed in");
    const context = await ctx.runQuery(internal.billing.seatsContext, { userId });
    if (!context) throw new Error("no workspace yet — open the dashboard first");
    const { ws, admin } = context;
    if (!admin) throw new ConvexError(ONLY_ADMIN);
    if (context.billedWith) throw new ConvexError(coveredMessage(context.billedWith));
    // One subscription a library: a paid one changes plan in place
    // (switchToTeam), never with a second subscription billing beside the first.
    if (ws.plan !== "free" && ws.stripeSubscriptionId) {
      throw new ConvexError(
        "this library already has a subscription: change its plan on Billing, or write to " +
          "support@librocat.com",
      );
    }
    // One Stripe price per plan per interval; the plan itself is the same, so
    // the webhook (fulfill) does not care which interval was picked.
    const priceEnv =
      (args.plan === "individual" ? "STRIPE_PRICE_ID_INDIVIDUAL" : "STRIPE_PRICE_ID_TEAM") +
      (args.interval === "annual" ? "_ANNUAL" : "");
    const price = process.env[priceEnv];
    if (!price) throw new Error(`${priceEnv} is not set on the Convex deployment`);
    const site = siteUrl();
    // The metered index-credit price joins the subscription only when the
    // library turns pay-as-you-go on (withMeteredItem), never here: Checkout
    // refuses a yearly plan and a monthly meter in one session, even in
    // flexible billing mode.
    if (!process.env.STRIPE_PRICE_ID_INDEXATION) {
      throw new Error("STRIPE_PRICE_ID_INDEXATION is not set on the Convex deployment");
    }
    const seats = Math.min(MAX_TEAM_SEATS, Math.max(MIN_TEAM_SEATS, context.members));
    const plan =
      args.plan === "team"
        ? {
            price,
            quantity: seats,
            adjustable_quantity: {
              enabled: true,
              minimum: Math.max(MIN_TEAM_SEATS, context.members),
              maximum: MAX_TEAM_SEATS,
            },
          }
        : { price, quantity: 1 };
    // A returning customer's Checkout knows them; a first one starts with the
    // account's address filled in, so nobody types it twice.
    const email = ws.stripeCustomerId
      ? null
      : await ctx.runQuery(internal.billing.emailOf, { userId });
    const session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      line_items: [plan],
      success_url: `${site}/dashboard/billing?checkout=success`,
      cancel_url: `${site}/dashboard/billing?checkout=cancelled`,
      client_reference_id: ws._id,
      ...(ws.stripeCustomerId
        ? { customer: ws.stripeCustomerId }
        : email
          ? { customer_email: email }
          : {}),
      metadata: { workspaceId: ws._id, plan: args.plan },
      subscription_data: {
        metadata: { workspaceId: ws._id, plan: args.plan },
        // Flexible billing mode lets a yearly plan carry the monthly meter.
        billing_mode: { type: "flexible" },
      },
      // Managed Payments: Stripe, through Link, is the merchant of record and
      // charges, files, and pays sales tax and VAT. Off until the account has
      // accepted its terms in the Dashboard (docs/cloud.md).
      ...(process.env.STRIPE_MANAGED_PAYMENTS === "1"
        ? { managed_payments: { enabled: true } }
        : {}),
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return session.url;
  },
});

/**
 * Change a Team library's seats, from its Billing page: not fewer than the
 * people in it (nor MIN_TEAM_SEATS), not more than MAX_TEAM_SEATS. Stripe
 * prorates the change and invoices it at once; the webhook confirms the count.
 * (The customer portal can't change quantities on a subscription with a
 * metered item, which one with pay-as-you-go has.)
 */
export const updateSeats = action({
  args: { seats: v.number() },
  handler: async (ctx, { seats }): Promise<{ approve: string | null }> => {
    const userId = await personId(ctx);
    if (!userId) throw new ConvexError("not signed in");
    const context = await ctx.runQuery(internal.billing.seatsContext, { userId });
    if (!context) throw new ConvexError("no workspace yet");
    const { ws, members, admin } = context;
    if (!admin) throw new ConvexError("only a library's admin can change its seats");
    if (context.billedWith) throw new ConvexError(coveredMessage(context.billedWith));
    if (ws.plan !== "team") throw new ConvexError("seats come with the Team plan");
    // A Team plan set by hand (no Stripe subscription) has no seats to bill.
    if (!ws.stripeSubscriptionId) throw new ConvexError("no subscription to change");
    const least = Math.max(MIN_TEAM_SEATS, members);
    const want = Math.round(seats);
    if (!(want >= least && want <= MAX_TEAM_SEATS)) {
      throw new ConvexError(
        `choose from ${least} to ${MAX_TEAM_SEATS} seats (${members} people are in the Team's libraries)`,
      );
    }
    const stripe = stripeClient();
    const sub = await stripe.subscriptions.retrieve(ws.stripeSubscriptionId);
    const item = sub.items.data.find((i) => i.price.recurring?.usage_type !== "metered");
    if (!item) throw new ConvexError("the subscription has no seats to change");
    await stripe.subscriptionItems
      .update(item.id, {
        quantity: want,
        // Charged (or credited) now, as switchToTeam is, and applied once paid (approvalFor).
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
      })
      .catch(declined);
    const approve = await approvalFor(stripe, await stripe.subscriptions.retrieve(sub.id));
    if (approve) return { approve };
    await ctx.runMutation(internal.billing.setSeats, { workspaceId: ws._id, seats: want });
    return { approve: null };
  },
});

type PerSeat = { cents: number; interval: "month" | "year" };
const period = v.union(v.literal("month"), v.literal("year"));

/** A seat's price and its period, for a page to name; null for any other period. */
function perSeat(price: Stripe.Price | undefined): PerSeat | null {
  const every = price?.recurring?.interval;
  const interval = every === "month" ? "month" : every === "year" ? "year" : null;
  const cents = price?.unit_amount;
  return cents == null || !interval ? null : { cents, interval };
}

/** Team's two prices, the one teamSwitch picks by the subscription's period. */
const teamPrices = () => ({
  monthly: process.env.STRIPE_PRICE_ID_TEAM,
  annual: process.env.STRIPE_PRICE_ID_TEAM_ANNUAL,
});

/**
 * What one more seat costs this Team, as its own subscription bills it:
 * the seat's price and period (`month` or `year`), for Team's Add a seat to
 * name before it's pressed. Null when there's no subscription to read (a
 * plan set by hand, or one billed with another library). Read only when a
 * full Team's admin opens Team: one Stripe call.
 */
export const seatPrice = action({
  args: {},
  returns: v.union(v.object({ cents: v.number(), interval: period }), v.null()),
  handler: async (ctx): Promise<PerSeat | null> => {
    const userId = await personId(ctx);
    if (!userId) return null;
    const context = await ctx.runQuery(internal.billing.seatsContext, { userId });
    if (!context?.admin || context.billedWith || context.ws.plan !== "team") return null;
    if (!context.ws.stripeSubscriptionId) return null;
    const sub = await stripeClient().subscriptions.retrieve(context.ws.stripeSubscriptionId);
    return perSeat(sub.items.data.find((i) => i.price.recurring?.usage_type !== "metered")?.price);
  },
});

/**
 * What Individual to Team would bill, for Switch to Team to say before it's
 * pressed: Team's price a seat for the subscription's own period, the seats
 * the switch gives (teamSwitch), and what it charges today (`today`, in
 * cents; null when Stripe's preview failed), prorated at `at` (Unix
 * seconds), which the switch reuses so it charges what was shown
 * (prorationMoment). Null when there's no subscription to read. Read only
 * when an Individual library's admin opens Billing: three Stripe calls.
 */
export const switchPrice = action({
  args: {},
  returns: v.union(
    v.object({
      cents: v.number(),
      interval: period,
      seats: v.number(),
      today: v.union(v.number(), v.null()),
      at: v.number(),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
  ): Promise<(PerSeat & { seats: number; today: number | null; at: number }) | null> => {
    const userId = await personId(ctx);
    if (!userId) return null;
    const context = await ctx.runQuery(internal.billing.seatsContext, { userId });
    if (!context?.admin || context.billedWith || context.ws.plan !== "individual") return null;
    if (!context.ws.stripeSubscriptionId) return null;
    const stripe = stripeClient();
    const sub = await stripe.subscriptions.retrieve(context.ws.stripeSubscriptionId);
    const change = teamSwitch(sub, teamPrices(), context.members);
    const at = Math.floor(Date.now() / 1000);
    const [price, preview] = await Promise.all([
      stripe.prices.retrieve(change.price),
      stripe.invoices
        .createPreview({
          subscription: sub.id,
          subscription_details: {
            items: [{ id: change.item, price: change.price, quantity: change.quantity }],
            proration_behavior: "always_invoice",
            proration_date: at,
          },
        })
        .catch(() => null),
    ]);
    const seat = perSeat(price);
    return seat && { ...seat, seats: change.quantity, today: preview?.amount_due ?? null, at };
  },
});

/**
 * The moment a switch is prorated at: the one Billing priced it at
 * (switchPrice's `at`), so the charge is the amount it showed, when that
 * was within the last hour; otherwise now. Never later than now, which
 * would charge less than the time left. Pure, for the test.
 */
export function prorationMoment(shown: number | undefined, now: number): number {
  return shown !== undefined && shown <= now && shown > now - 3600 ? shown : now;
}

/**
 * What switching a paid subscription to Team changes: its one licensed item
 * goes to Team's price for the same billing period, with a seat for each
 * person in the library (at least MIN_TEAM_SEATS). The metered item stays.
 * Pure, so the test needs no Stripe.
 */
export function teamSwitch(
  sub: Pick<Stripe.Subscription, "items">,
  prices: { monthly?: string; annual?: string },
  members: number,
): { item: string; price: string; quantity: number } {
  const item = sub.items.data.find((i) => i.price.recurring?.usage_type !== "metered");
  if (!item) throw new ConvexError("the subscription has no plan to change");
  const annual = item.price.recurring?.interval === "year";
  const price = annual ? prices.annual : prices.monthly;
  if (!price) {
    throw new Error(
      `STRIPE_PRICE_ID_TEAM${annual ? "_ANNUAL" : ""} is not set on the Convex deployment`,
    );
  }
  const quantity = Math.min(MAX_TEAM_SEATS, Math.max(MIN_TEAM_SEATS, members));
  return { item: item.id, price, quantity };
}

/**
 * Individual to Team, from Billing, in one click: the same subscription
 * moves to Team's price, the difference prorated and invoiced at once, so no
 * second subscription ever bills beside the first. The webhook confirms it.
 */
export const switchToTeam = action({
  args: { prorationDate: v.optional(v.number()) },
  handler: async (ctx, { prorationDate }): Promise<{ approve: string | null }> => {
    const userId = await personId(ctx);
    if (!userId) throw new ConvexError("not signed in");
    const context = await ctx.runQuery(internal.billing.seatsContext, { userId });
    if (!context) throw new ConvexError("no workspace yet");
    const { ws, members, admin } = context;
    if (!admin) throw new ConvexError(ONLY_ADMIN);
    if (context.billedWith) throw new ConvexError(coveredMessage(context.billedWith));
    if (ws.plan !== "individual" || !ws.stripeSubscriptionId) {
      throw new ConvexError("only an Individual subscription switches to Team here");
    }
    const stripe = stripeClient();
    const sub = await stripe.subscriptions.retrieve(ws.stripeSubscriptionId);
    const change = teamSwitch(sub, teamPrices(), members);
    const updated = await stripe.subscriptions
      .update(sub.id, {
        items: [{ id: change.item, price: change.price, quantity: change.quantity }],
        // Charged now: a yearly plan's next invoice can be its renewal, a year
        // off. Applied once paid (approvalFor), the plan's label too: planOf
        // reads it for a Team price since replaced.
        proration_behavior: "always_invoice",
        proration_date: prorationMoment(prorationDate, Math.floor(Date.now() / 1000)),
        payment_behavior: "pending_if_incomplete",
        metadata: { plan: "team" },
      })
      .catch(declined);
    const approve = await approvalFor(stripe, updated);
    if (approve) return { approve };
    await ctx.runMutation(internal.billing.setStatus, {
      workspaceId: ws._id,
      subscriptionId: updated.id,
      status: updated.status,
      plan: "team",
      seats: change.quantity,
      cancelAt: updated.cancel_at ? updated.cancel_at * 1000 : undefined,
    });
    return { approve: null };
  },
});

/** Open the Stripe Customer Portal (cancel, update card, invoices). Returns the URL. */
export const createPortalSession = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await personId(ctx);
    if (!userId) throw new Error("not signed in");
    const context = await ctx.runQuery(internal.billing.seatsContext, { userId });
    if (context && !context.admin) throw new ConvexError(ONLY_ADMIN);
    const ws = context?.ws;
    if (!ws?.stripeCustomerId) throw new Error("no subscription to manage");
    const site = siteUrl();
    const session = await stripeClient().billingPortal.sessions.create({
      customer: ws.stripeCustomerId,
      return_url: `${site}/dashboard/billing`,
    });
    return session.url;
  },
});

/** Verify a webhook payload and apply the subscription change. False = bad signature. */
export const fulfill = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set on the Convex deployment");
    let event: Stripe.Event;
    try {
      event = await stripeClient().webhooks.constructEventAsync(
        args.payload,
        args.signature,
        secret,
      );
    } catch {
      return false;
    }
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const workspaceId = session.client_reference_id;
        if (!workspaceId) break;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : undefined;
        const sub = subscriptionId
          ? await stripeClient().subscriptions.retrieve(subscriptionId)
          : undefined;
        // A library buying a plan again with pay-as-you-go still on bills it from the start.
        if (sub) await withMeteredItem(sub, await payAsYouGoOn(ctx, workspaceId));
        // The session doesn't say how many seats were bought; the subscription does.
        const seats = sub ? seatsOf(sub) : undefined;
        await ctx.runMutation(internal.billing.activate, {
          workspaceId,
          plan: session.metadata?.plan,
          customerId: typeof session.customer === "string" ? session.customer : undefined,
          subscriptionId,
          seats,
          // A payment that settles later (a bank debit): the plan waits for the
          // subscription to turn `active` (customer.subscription.updated).
          paid: session.payment_status !== "unpaid",
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // Stripe doesn't promise the order of events: act on the subscription
        // as it is now, not as this event saw it.
        await applySubscription(ctx, event.data.object.id);
        break;
      }
      default:
        break;
    }
    return true;
  },
});

/**
 * A meter event's identifier: stable per library, concept or file part, and
 * minute, so Stripe still drops a retry, but opaque to Stripe, so no concept
 * id or file title leaves librocat. 43 characters; Stripe takes up to 100.
 */
export const meterIdentifier = (workspaceId: string, cid: string, minute: number, secret: string) =>
  hmac(secret, `librocat meter event ${workspaceId}:${cid}:${minute}`);

/**
 * Report one pay-as-you-go indexation to the Stripe meter. Idempotent per
 * concept and minute through `identifier`. Skips (and logs) when Stripe or the
 * customer is not set up, so indexation itself never depends on billing.
 */
export const reportOverage = internalAction({
  args: { workspaceId: v.id("workspaces"), cid: v.string() },
  handler: async (ctx, args) => {
    const customer = await ctx.runQuery(internal.billing.customerOf, {
      workspaceId: args.workspaceId,
    });
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!customer || !process.env.STRIPE_SECRET_KEY || !secret) {
      console.warn(`index overage not metered (no Stripe customer): ${args.workspaceId}`);
      return null;
    }
    const minute = Math.floor(Date.now() / 60_000);
    await stripeClient().billing.meterEvents.create({
      event_name: process.env.STRIPE_METER_INDEXATION ?? "librocat_indexation",
      payload: { stripe_customer_id: customer, value: "1" },
      identifier: await meterIdentifier(args.workspaceId, args.cid, minute, secret),
    });
    return null;
  },
});

/**
 * Pay-as-you-go just turned on (workspaces.setPayAsYouGo): give the library's
 * subscription the metered price, so credits past the plan's bill. Tries
 * again in a minute, then two, if Stripe doesn't answer; the webhook adds it
 * too, at the subscription's next change. Skips (and logs) without Stripe.
 */
export const meterPayAsYouGo = internalAction({
  args: { workspaceId: v.id("workspaces"), attempt: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, attempt = 1 }): Promise<null> => {
    const { payAsYouGo, subscriptionId } = await ctx.runQuery(internal.billing.metering, {
      workspaceId,
    });
    if (!payAsYouGo) return null;
    if (!subscriptionId || !process.env.STRIPE_SECRET_KEY) {
      console.warn(`pay-as-you-go not metered (no Stripe subscription): ${workspaceId}`);
      return null;
    }
    try {
      await withMeteredItem(await stripeClient().subscriptions.retrieve(subscriptionId), true);
    } catch (e) {
      if (attempt >= 3) throw e;
      await ctx.scheduler.runAfter(attempt * 60_000, internal.stripe.meterPayAsYouGo, {
        workspaceId,
        attempt: attempt + 1,
      });
    }
    return null;
  },
});

/** A library a Team covers changes its plan at the library that holds it (teamCover.ts). */
const coveredMessage = (home: string) =>
  `this library is on your Team plan, billed with ${home}: change the plan or seats there`;

/** A subscription as Stripe has it now, applied to its library's plan (billing.setStatus). */
/**
 * A subscription's plan, by its licensed price: a switch to Team changes the
 * price, and only once it's paid (approvalFor). Its metadata's for a price
 * that isn't one of the four (one replaced since): Checkout sets it, and a
 * switch, once paid.
 */
export function planOf(
  sub: Pick<Stripe.Subscription, "items" | "metadata">,
  prices = {
    team: [process.env.STRIPE_PRICE_ID_TEAM, process.env.STRIPE_PRICE_ID_TEAM_ANNUAL],
    individual: [
      process.env.STRIPE_PRICE_ID_INDIVIDUAL,
      process.env.STRIPE_PRICE_ID_INDIVIDUAL_ANNUAL,
    ],
  },
): string | undefined {
  const price = sub.items.data.find((i) => i.price.recurring?.usage_type !== "metered")?.price.id;
  if (price && prices.team.includes(price)) return "team";
  if (price && prices.individual.includes(price)) return "individual";
  return sub.metadata?.plan;
}

async function applySubscription(ctx: ActionCtx, subscriptionId: string) {
  const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
  const workspaceId = sub.metadata?.workspaceId;
  if (!workspaceId) return;
  // A payment that settled after Checkout turns the subscription active here,
  // and a library with pay-as-you-go on gets its metered price.
  await withMeteredItem(sub, await payAsYouGoOn(ctx, workspaceId));
  await ctx.runMutation(internal.billing.setStatus, {
    workspaceId,
    subscriptionId: sub.id,
    status: sub.status,
    plan: planOf(sub),
    seats: seatsOf(sub),
    // Cancelled for the end of its period (`cancel_at` in flexible billing mode).
    cancelAt: sub.cancel_at ? sub.cancel_at * 1000 : undefined,
  });
}

/**
 * A library a Team no longer covers, back to its own subscription as Stripe
 * has it: a plan with paid time left keeps it to its end (teamCover.ts
 * uncover). Skips, and logs, without Stripe.
 */
export const resync = internalAction({
  args: { subscriptionId: v.string() },
  handler: async (ctx, { subscriptionId }) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn(`subscription not read (no Stripe key): ${subscriptionId}`);
      return null;
    }
    try {
      await applySubscription(ctx, subscriptionId);
    } catch (err) {
      console.warn(`could not read subscription ${subscriptionId}: ${err}`);
    }
    return null;
  },
});

/**
 * A library's own subscription, ended at the close of the period it paid
 * for and billed no more (it came under a Team, teamCover.ts). Skips, and
 * logs, without Stripe.
 */
export const endAtPeriodEnd = internalAction({
  args: { subscriptionId: v.string() },
  handler: async (_ctx, { subscriptionId }) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn(`subscription not ended (no Stripe key): ${subscriptionId}`);
      return null;
    }
    try {
      // Flexible billing mode: the end of the current period.
      await stripeClient().subscriptions.update(subscriptionId, { cancel_at: "max_period_end" });
    } catch (err) {
      console.warn(`could not end subscription ${subscriptionId}: ${err}`);
    }
    return null;
  },
});

/**
 * Cancel a subscription immediately, for deleting a library or the account
 * (convex/workspaces.ts deleteLibrary, convex/account.ts deleteAccount). The
 * month's pay-as-you-go credits, if any (`invoiceUsage`, model.ts
 * usedPayAsYouGo), are billed then (`invoice_now`), as they would have been
 * at its end; without any, no $0 invoice is made. The unused part of the
 * plan isn't refunded, as on any cancellation (the terms). Best-effort: an
 * already-cancelled or
 * unknown subscription id is not an error — the teardown proceeds either
 * way, since a stuck Stripe object should never block a user from deleting
 * their data.
 */
export const cancelSubscription = internalAction({
  args: { subscriptionId: v.string(), invoiceUsage: v.optional(v.boolean()) },
  handler: async (_ctx, { subscriptionId, invoiceUsage }) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn(`subscription not cancelled (no Stripe key): ${subscriptionId}`);
      return null;
    }
    try {
      await stripeClient().subscriptions.cancel(subscriptionId, { invoice_now: !!invoiceUsage });
    } catch (err) {
      console.warn(`could not cancel subscription ${subscriptionId}: ${err}`);
    }
    return null;
  },
});
