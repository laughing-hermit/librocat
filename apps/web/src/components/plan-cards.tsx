"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { openPortal, startCheckout, switchToTeam } from "@/app/dashboard/billing/actions";
import { ButtonLink } from "@/components/button-link";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { count } from "@/lib/analytics";
import {
  annualNote,
  enterprise,
  type Interval,
  MIN_TEAM_SEATS,
  type Plan,
  plans,
  priceLabel,
  usd,
} from "@/lib/site";
import { link } from "@/lib/utils";

// The pricing grid, on the landing page (its buttons are links) and in
// Billing (they start Stripe Checkout). Annual first, with the yearly charge
// spelled out under the price, so nobody is surprised.
export function PlanCards({
  variant,
  currentPlan = "free",
  admin = true,
  comingSoon = false,
}: {
  variant: "landing" | "billing";
  currentPlan?: string;
  /** In Billing: only the library's admins change its plan (convex/stripe.ts). */
  admin?: boolean;
  /** Before launch: every plan says "Coming soon" instead of a link (lib/coming-soon.ts). */
  comingSoon?: boolean;
}) {
  const [interval, setInterval] = useState<Interval>("annual");
  return (
    <div
      className={
        variant === "landing"
          ? "flex flex-col items-center gap-8"
          : "flex flex-col items-start gap-8"
      }
    >
      <Tabs value={interval} onValueChange={(v) => setInterval(v as Interval)}>
        <TabsList>
          <TabsTrigger value="annual">Yearly (2 months free)</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>{p.name}</CardTitle>
              <CardDescription>{p.best}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-6">
              <Price plan={p} interval={interval} />
              <ul className="flex flex-col gap-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              {variant === "landing" && comingSoon ? (
                <Button variant="outline" className="w-full" disabled>
                  Coming soon
                </Button>
              ) : variant === "landing" ? (
                <ButtonLink
                  variant={p.highlighted ? "default" : "outline"}
                  className="w-full"
                  href={p.href ?? checkoutHref(p.id, interval)}
                >
                  {p.cta}
                </ButtonLink>
              ) : (
                <PlanButton plan={p} interval={interval} currentPlan={currentPlan} admin={admin} />
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground">
        {enterprise.line}{" "}
        <a href={enterprise.href} className={link}>
          {enterprise.cta}
        </a>
      </p>
    </div>
  );
}

/**
 * A paid plan from the landing page: sign up (or sign in, from there), then
 * Billing offers checkout for the plan and billing period picked here.
 */
function checkoutHref(plan: string, interval: Interval): string {
  return `/sign-up?next=${encodeURIComponent(`/dashboard/billing?plan=${plan}&interval=${interval}`)}`;
}

function Price({ plan: p, interval }: { plan: Plan; interval: Interval }) {
  if (typeof p.price === "string") {
    return (
      <div>
        <div className="text-4xl font-semibold tracking-tight">{p.price}</div>
        <div className="text-sm text-muted-foreground">{p.cadence}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-4xl font-semibold tracking-tight tabular-nums">
        {priceLabel(p.price, interval)}
        <span className="text-base font-normal text-muted-foreground"> / month</span>
      </div>
      <div className="text-sm text-muted-foreground">
        {interval === "monthly" ? p.cadence : annualNote(p.price)}
      </div>
    </div>
  );
}

function PlanButton({
  plan,
  interval,
  currentPlan,
  admin,
}: {
  plan: Plan;
  interval: Interval;
  currentPlan: string;
  admin: boolean;
}) {
  if (currentPlan === plan.id || !admin) {
    return (
      <Button variant="outline" className="w-full" disabled>
        {currentPlan === plan.id ? "Current plan" : "Admins only"}
      </Button>
    );
  }
  // Back to Free is a cancellation, in the Stripe portal.
  if (plan.id === "free") {
    return (
      <form action={openPortal} className="w-full">
        <SubmitButton variant="outline" className="w-full">
          Switch to Free
        </SubmitButton>
      </form>
    );
  }
  // Individual to Team changes the subscription in place, in one click.
  if (currentPlan === "individual" && plan.id === "team") return <SwitchToTeamButton />;
  // Team to Individual runs through support: the team's people would lose access.
  if (currentPlan === "individual" || currentPlan === "team") {
    return (
      <ButtonLink variant="outline" className="w-full" href={enterprise.href}>
        Contact us to switch
      </ButtonLink>
    );
  }
  const paidPlan = plan.id as "individual" | "team";
  return (
    <form
      className="w-full"
      action={startCheckout.bind(null, paidPlan, interval)}
      onSubmit={() => count("checkout_started", { plan: paidPlan, interval })}
    >
      <SubmitButton variant={plan.highlighted ? "default" : "outline"} className="w-full">
        {plan.cta}
      </SubmitButton>
    </form>
  );
}

/** Checkout for one plan and billing period, counted: one click from wherever a plan is offered. */
export function CheckoutButton({
  plan,
  interval,
  label = "Continue to checkout",
  variant = "default",
}: {
  plan: "individual" | "team";
  interval: Interval;
  label?: string;
  variant?: "default" | "outline";
}) {
  return (
    <form
      action={startCheckout.bind(null, plan, interval)}
      onSubmit={() => count("checkout_started", { plan, interval })}
    >
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </form>
  );
}

/**
 * The next plan up, one click away: Free goes to Individual's Checkout,
 * Individual to Billing's switch to Team, Team to Billing. Only an admin
 * can pay, so anyone else is told who can.
 */
export function UpgradeButton({
  plan,
  admin,
  label = "Upgrade",
}: {
  plan: string;
  admin: boolean;
  label?: string;
}) {
  if (!admin) return <span className="text-muted-foreground">Ask an admin to upgrade.</span>;
  if (plan === "free") return <CheckoutButton plan="individual" interval="annual" label={label} />;
  return (
    <ButtonLink href="/dashboard/billing" size="sm" prefetch={false}>
      {plan === "individual" ? "Switch to Team" : "See Billing"}
    </ButtonLink>
  );
}

/**
 * Individual to Team, on the same subscription, after asking: it
 * changes what's billed, so it says what it charges today and what Team
 * bills from then on, when Stripe could price it (convex/stripe.ts
 * switchPrice); the switch is prorated at that same moment (`at`).
 */
export function SwitchToTeamButton({
  price,
}: {
  price?: {
    cents: number;
    interval: "month" | "year";
    seats: number;
    today: number | null;
    at: number;
  } | null;
}) {
  const bills =
    price && `${usd(price.cents * price.seats)} a ${price.interval} for ${price.seats} seats`;
  const question = !price
    ? `Your subscription moves to Team, ${MIN_TEAM_SEATS} seats or one per person, billed as now. Today you pay the difference until renewal.`
    : price.today === null
      ? `Your subscription moves to Team: ${bills}. Today you pay the difference until renewal.`
      : `Your subscription moves to Team: you pay ${usd(price.today)} today, then ${bills}.`;
  return (
    <ConfirmButton
      label="Switch to Team"
      title="Switch to Team?"
      description={question}
      fields={price ? { prorationDate: String(price.at) } : undefined}
      confirm="Switch to Team"
      destructive={false}
      primary
      size="default"
      className="w-full"
      action={switchToTeam}
    />
  );
}
