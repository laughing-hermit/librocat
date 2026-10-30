/**
 * Pay-as-you-go's monthly cap: when a spend calls for an email (model.ts
 * capNotice), what the email says (billing.ts capNoticeEmail), Billing's
 * copy of the limits (src/lib/site.ts), and when it bills at all
 * (model.ts payAsYouGoOn).
 */

import { describe, expect, test } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
import { capNoticeEmail } from "../convex/billing";
import {
  CAP_WARNING,
  capCentsOf,
  capNotice,
  FREE_LIBRARIES,
  PAY_AS_YOU_GO_CAP_CENTS,
  payAsYouGoOn,
  usedPayAsYouGo,
} from "../convex/model";
import {
  meterIdentifier,
  needsMeteredItem,
  planOf,
  prorationMoment,
  teamSwitch,
} from "../convex/stripe";
import { TEAM_LIBRARIES } from "../convex/teamCover";
import {
  PAYG_CAP_DOLLARS,
  FREE_LIBRARIES as SITE_FREE_LIBRARIES,
  TEAM_LIBRARIES as SITE_TEAM_LIBRARIES,
  usd,
} from "../src/lib/site";

describe("capNotice", () => {
  test("below 80% of the cap, no email", () => {
    expect(capNotice(1_000, 0)).toBeNull();
    expect(capNotice(1_000, 799)).toBeNull();
  });

  test("from 80% of the cap, the warning", () => {
    expect(CAP_WARNING).toBe(0.8);
    expect(capNotice(1_000, 800)).toBe(80);
    expect(capNotice(1_000, 999)).toBe(80);
  });

  test("at the cap, or refused for it, the cap email", () => {
    expect(capNotice(1_000, 1_000)).toBe(100);
    expect(capNotice(100, 100)).toBe(100);
    expect(capNotice(1_000, null)).toBe(100);
  });

  test("an unset cap reads as $10", () => {
    expect(capCentsOf({})).toBe(1_000);
    expect(capCentsOf({ payAsYouGoCapCents: 2_500 })).toBe(2_500);
  });
});

describe("capNoticeEmail", () => {
  const base = {
    library: "Acme docs",
    spentCents: 812,
    capCents: 1_000,
    period: "2026-10",
    billingUrl: "https://librocat.com/dashboard/billing",
  };

  test("the warning says what was spent, what happens at the cap, and where to change it", () => {
    const e = capNoticeEmail({ ...base, level: 80 });
    expect(e.subject).toBe("Acme docs: pay-as-you-go is at $8.12 of its $10 cap");
    expect(e.text).toContain(
      "Acme docs has spent $8.12 of its $10 pay-as-you-go cap for October 2026.",
    );
    expect(e.text).toContain(
      "At the cap, Libro's cataloging and file reading wait until next month, or until you raise the cap.",
    );
    expect(e.text).toContain("Change it on Billing: https://librocat.com/dashboard/billing");
  });

  test("at the cap, it says pay-as-you-go bills nothing more this month", () => {
    const e = capNoticeEmail({ ...base, level: 100, spentCents: 1_000 });
    expect(e.subject).toBe("Acme docs: pay-as-you-go reached its $10 cap");
    expect(e.text).toContain(
      "Acme docs has spent $10 of its $10 pay-as-you-go cap for October 2026",
    );
    expect(e.text).toContain("Pay-as-you-go bills nothing more this month.");
  });
});

test("Billing's limits mirror the backend's, in dollars", () => {
  expect(PAYG_CAP_DOLLARS.min * 100).toBe(PAY_AS_YOU_GO_CAP_CENTS.min);
  expect(PAYG_CAP_DOLLARS.max * 100).toBe(PAY_AS_YOU_GO_CAP_CENTS.max);
  expect(usd(PAY_AS_YOU_GO_CAP_CENTS.default)).toBe("$10");
  expect(usd(312)).toBe("$3.12");
  expect(usd(0)).toBe("$0");
  // New library offers a plan instead of the form past this many.
  expect(SITE_FREE_LIBRARIES).toBe(FREE_LIBRARIES);
  // The plan card and New library say how many a Team covers.
  expect(SITE_TEAM_LIBRARIES).toBe(TEAM_LIBRARIES);
});

test("pay-as-you-go bills on a paid plan that turned it on, and waits while a payment is overdue", () => {
  const ws = (plan: string, payAsYouGo: boolean, subscriptionStatus?: string) =>
    ({ plan, payAsYouGo, subscriptionStatus }) as Doc<"workspaces">;
  expect(payAsYouGoOn(ws("individual", true, "active"))).toBe(true);
  expect(payAsYouGoOn(ws("team", true, "trialing"))).toBe(true);
  // Stripe retries the card while the plan stays on: nothing more is billed meanwhile.
  expect(payAsYouGoOn(ws("individual", true, "past_due"))).toBe(false);
  expect(payAsYouGoOn(ws("individual", false, "active"))).toBe(false);
  expect(payAsYouGoOn(ws("free", true))).toBe(false);
});

describe("needsMeteredItem", () => {
  // Checkout sells the plan alone (it refuses a yearly plan beside the monthly
  // meter). The meter joins a paid subscription only once its library turns
  // pay-as-you-go on, so Stripe's pages show everyone else the plan's price.
  const sub = (status: string, prices: string[]) =>
    ({ status, items: { data: prices.map((id) => ({ price: { id } })) } }) as never;

  test("a paid subscription with pay-as-you-go on and no meter needs it", () => {
    expect(needsMeteredItem(sub("active", ["price_plan"]), "price_meter", true)).toBe(true);
    expect(needsMeteredItem(sub("past_due", ["price_plan"]), "price_meter", true)).toBe(true);
  });

  test("not while pay-as-you-go is off: Stripe shows the plan's price", () => {
    expect(needsMeteredItem(sub("active", ["price_plan"]), "price_meter", false)).toBe(false);
  });

  test("one that has it, or isn't paid for, doesn't", () => {
    expect(
      needsMeteredItem(sub("active", ["price_plan", "price_meter"]), "price_meter", true),
    ).toBe(false);
    expect(needsMeteredItem(sub("incomplete", ["price_plan"]), "price_meter", true)).toBe(false);
    expect(needsMeteredItem(sub("canceled", ["price_plan"]), "price_meter", true)).toBe(false);
  });
});

describe("teamSwitch", () => {
  // Individual to Team changes the one subscription in place: its plan item,
  // for the same billing period, with a seat for each person; the meter stays.
  const sub = (interval: "month" | "year") =>
    ({
      items: {
        data: [
          { id: "si_plan", price: { id: "price_individual", recurring: { interval } } },
          {
            id: "si_meter",
            price: { id: "price_meter", recurring: { interval: "month", usage_type: "metered" } },
          },
        ],
      },
    }) as never;
  const prices = { monthly: "price_team", annual: "price_team_annual" };

  test("the plan item moves to Team's price for its period", () => {
    expect(teamSwitch(sub("month"), prices, 1)).toEqual({
      item: "si_plan",
      price: "price_team",
      quantity: 3,
    });
    expect(teamSwitch(sub("year"), prices, 1).price).toBe("price_team_annual");
  });

  test("a seat for each person, from 3 to 100", () => {
    expect(teamSwitch(sub("month"), prices, 5).quantity).toBe(5);
    expect(teamSwitch(sub("month"), prices, 500).quantity).toBe(100);
  });

  test("an unset Team price refuses rather than guess", () => {
    expect(() => teamSwitch(sub("year"), { monthly: "price_team" }, 1)).toThrow(
      /STRIPE_PRICE_ID_TEAM_ANNUAL/,
    );
  });
});

describe("prorationMoment", () => {
  const now = 1_800_000_000;

  test("a switch is prorated when Billing priced it, so it charges what was shown", () => {
    expect(prorationMoment(now - 120, now)).toBe(now - 120);
  });

  test("now, when nothing was shown, it was over an hour ago, or it's later than now", () => {
    expect(prorationMoment(undefined, now)).toBe(now);
    expect(prorationMoment(now - 3600, now)).toBe(now);
    expect(prorationMoment(now + 60, now)).toBe(now);
  });
});

describe("planOf", () => {
  const prices = { team: ["price_team", "price_team_annual"], individual: ["price_ind"] };
  const sub = (price: string, plan?: string) =>
    ({
      items: {
        data: [
          { price: { id: price, recurring: { usage_type: "licensed" } } },
          { price: { id: "price_metered", recurring: { usage_type: "metered" } } },
        ],
      },
      metadata: plan ? { plan } : {},
    }) as unknown as Parameters<typeof planOf>[0];

  test("follows the plan's price, not metadata a switch left behind", () => {
    expect(planOf(sub("price_team_annual", "individual"), prices)).toBe("team");
    expect(planOf(sub("price_ind", "team"), prices)).toBe("individual");
  });

  test("falls back to Checkout's metadata for a price it doesn't know", () => {
    expect(planOf(sub("price_old", "team"), prices)).toBe("team");
  });
});

describe("usedPayAsYouGo", () => {
  const oct = Date.UTC(2026, 9, 25);
  test("bills a deletion's final invoice only for this month's credits", () => {
    expect(usedPayAsYouGo({ indexPeriod: "2026-10", indexOverage: 3 }, oct)).toBe(true);
    expect(usedPayAsYouGo({ indexPeriod: "2026-10", indexOverage: 0 }, oct)).toBe(false);
    expect(usedPayAsYouGo({ indexPeriod: "2026-09", indexOverage: 40 }, oct)).toBe(false);
    expect(usedPayAsYouGo({}, oct)).toBe(false);
  });
});

describe("pay-as-you-go meter events", () => {
  test("Stripe gets an opaque identifier: stable for a retry, no concept id or file title", async () => {
    const id = await meterIdentifier("ws1", "acme/payments/runbook", 100, "s3cret");
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(id).not.toContain("acme");
    expect(await meterIdentifier("ws1", "acme/payments/runbook", 100, "s3cret")).toBe(id);
    expect(await meterIdentifier("ws1", "acme/payments/runbook", 101, "s3cret")).not.toBe(id);
    expect(await meterIdentifier("ws1", "acme/other", 100, "s3cret")).not.toBe(id);
    // A long id still fits Stripe's 100 characters.
    expect((await meterIdentifier("ws1", "x".repeat(500), 100, "s3cret")).length).toBe(43);
  });
});
