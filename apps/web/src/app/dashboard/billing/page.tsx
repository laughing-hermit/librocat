import { CheckCircle2, Info } from "lucide-react";
import { redirect } from "next/navigation";
import { changeSeats, openPortal, setPayAsYouGoCap } from "@/app/dashboard/billing/actions";
import { CountedForm } from "@/components/counted";
import { DoneToast } from "@/components/done-toast";
import { ErrorAlert } from "@/components/error-alert";
import { LocalDate } from "@/components/local-date";
import { PageHeader } from "@/components/page-header";
import { PayAsYouGoSwitch } from "@/components/pay-as-you-go-switch";
import { CheckoutButton, PlanCards, SwitchToTeamButton } from "@/components/plan-cards";
import { SettingsTabs } from "@/components/settings-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { getMe, getSeatPrice, getSwitchPrice, getTeam } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";
import {
  creditsLine,
  enterprise,
  indexOveragePrice,
  LIMITS_URL,
  MAX_TEAM_SEATS,
  MIN_TEAM_SEATS,
  PAYG_CAP_DOLLARS,
  PRICES,
  priceLabel,
  riskReversal,
  taxNote,
  usd,
} from "@/lib/site";
import { formatBytes, link } from "@/lib/utils";

export const metadata = { title: "Billing | librocat" };

const ERRORS: Record<string, string> = {
  stripe: "Checkout could not start. Please try again, or write to support@librocat.com.",
  convex: "Checkout is not available: this site has no backend connected.",
  payg: "The pay-as-you-go setting could not be saved. Pay-as-you-go needs a paid plan, and the library's admins change it.",
  cap: `The cap could not be saved. Choose whole dollars from $${PAYG_CAP_DOLLARS.min} to $${PAYG_CAP_DOLLARS.max.toLocaleString("en-US")}.`,
  portal: "The billing portal could not open. Please try again, or write to support@librocat.com.",
  seats: "The seats could not be changed. Please try again, or write to support@librocat.com.",
  "seats-range": `The seats could not be changed. Choose from ${MIN_TEAM_SEATS} to ${MAX_TEAM_SEATS}, and at least as many as the people in the Team's libraries.`,
  admin: "Only the library's admins can change its plan, seats, or billing.",
  "seats-plan": "Seats come with the Team plan.",
  switch:
    "The plan could not be switched. Nothing was charged. Please try again, or write to support@librocat.com.",
  card: "The card on file was declined, so nothing changed. Change it in Manage subscription, with the pencil next to your plan's card, then try again.",
};

const PLAN_NAME: Record<string, string> = { free: "Free", individual: "Individual", team: "Team" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string; plan?: string; interval?: string }>;
}) {
  await requireSession();
  // Self-hosted: no plans, nothing to bill.
  if (selfHost) redirect("/dashboard/library");
  const { checkout, error, ...picked } = await searchParams;
  const { data: me } = await getMe();
  const ws = me?.workspace ?? null;
  // A read that failed would show Free's plans to anyone, a Team's people too.
  if (!ws) {
    return (
      <>
        <PageHeader title="Settings" />
        <SettingsTabs />
        <ErrorAlert>Billing couldn't load. Refresh the page to try again.</ErrorAlert>
      </>
    );
  }
  const plan = ws.plan;
  const credits = ws.indexCredits;
  const admin = ws.admin;
  // A Team's seats, and their price as its subscription bills it (monthly or
  // yearly), asked of Stripe only for the admin who changes them; on
  // Individual, what Team would bill, for the admin who switches.
  const [teamRead, seatPrice, switchPrice] = await Promise.all([
    plan === "team" ? getTeam() : null,
    plan === "team" && admin && !ws.billedWith ? getSeatPrice() : null,
    plan === "individual" && admin && !ws.billedWith ? getSwitchPrice() : null,
  ]);
  const team = teamRead?.data ?? null;
  const cancelAt = ws.cancelAt ?? null;
  // A Team's people pause when it ends (convex/membership.ts pausedIn): said before anyone cancels.
  const mates = team ? team.seatsUsed - 1 : 0;
  const pauseNote =
    mates > 0
      ? ` ${cancelAt ? "When it ends" : "If it ends"}, ${ws.owner ? (mates === 1 ? "your teammate is" : `your ${mates} teammates are`) : "everyone but its owner is"} paused until it's on Team again: nothing is deleted.`
      : "";
  // A plan picked on the landing page, carried through sign-up (plan-cards.tsx):
  // offered here, one click from Checkout, to whoever can buy it.
  const wanted = picked.plan === "individual" || picked.plan === "team" ? picked.plan : null;
  const interval = picked.interval === "monthly" ? "monthly" : "annual";
  const offer = wanted && plan === "free" && admin ? wanted : null;

  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs />
      <DoneToast
        messages={{ seats: "Seats updated", cap: "Monthly cap set", team: "Switched to Team" }}
      />
      <div className="flex flex-col gap-6">
        {checkout === "success" && (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              {plan === "free"
                ? "Checkout complete. Stripe is confirming it: refresh in a few seconds to see your plan."
                : `Checkout complete: you're on ${PLAN_NAME[plan]}.`}
            </AlertDescription>
          </Alert>
        )}
        {checkout === "cancelled" && (
          <Alert>
            <Info />
            <AlertDescription>Checkout was cancelled. Nothing was charged.</AlertDescription>
          </Alert>
        )}
        {offer && (
          <Alert>
            <Info />
            <AlertTitle>
              {offer === "team" ? "Team" : "Individual"}, billed{" "}
              {interval === "annual" ? "yearly" : "monthly"}
            </AlertTitle>
            <AlertDescription>
              <p>The plan you picked. Checkout is with Stripe.</p>
              <div className="mt-2">
                <CheckoutButton plan={offer} interval={interval} />
              </div>
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <ErrorAlert>{ERRORS[error] ?? "Something went wrong. Please try again."}</ErrorAlert>
        )}
        {/* Stripe keeps the plan while it retries the card (convex/billing.ts setStatus). */}
        {ws.subscriptionStatus === "past_due" && !ws.billedWith && (
          <ErrorAlert>
            {admin
              ? `The last payment for ${PLAN_NAME[plan]} didn't go through, and Stripe will try the card again. To keep the plan, change the card in Manage subscription, with the pencil next to your plan's card.`
              : `The last payment for ${PLAN_NAME[plan]} didn't go through. Your library's admins can update the card.`}
          </ErrorAlert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>
              {PLAN_NAME[plan]} plan, this month
              {ws.usage.libraries > 1
                ? `, shared by your Team's ${ws.usage.libraries} libraries`
                : ""}
              .{credits ? " A credit catalogs a concept or reads about three pages of a file." : ""}{" "}
              Every limit:{" "}
              <a href={LIMITS_URL} className={link}>
                plans and quotas
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Meter
              label="Concepts"
              used={ws.usage.concepts}
              limit={ws.usage.maxConcepts}
              format={(n) => n.toLocaleString("en-US")}
            />
            {ws.usage.maxSourceBytes !== null && (
              <Meter
                label="Documents and pictures"
                used={ws.usage.sourceBytes}
                limit={ws.usage.maxSourceBytes}
                format={formatBytes}
              />
            )}
            {/* Free's too: a file waits when they run out, so the meter says why. */}
            {credits && (
              <Meter
                label={creditsLine}
                used={credits.used}
                limit={credits.included}
                format={(n) => n.toLocaleString("en-US")}
              />
            )}
          </CardContent>
        </Card>

        {/* A library a Team covers is billed with the library that holds the plan (teamCover.ts). */}
        {ws.billedWith && (
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>
                Team, billed with {ws.billedWith}: one plan covers your libraries.
                {cancelAt && (
                  <>
                    {" "}
                    It's cancelled, and ends on <LocalDate at={cancelAt} />.
                  </>
                )}{" "}
                To change the plan or its seats, open {ws.billedWith} from the library menu, then
                its Billing.{pauseNote}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {plan !== "free" && !ws.billedWith && (
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>
                {cancelAt ? (
                  <>
                    {PLAN_NAME[plan]}, cancelled: it ends on <LocalDate at={cancelAt} />.{" "}
                    {admin ? "To keep it, renew in Stripe." : "Your library's admins can renew it."}
                  </>
                ) : admin ? (
                  `${PLAN_NAME[plan]}. Get invoices, cancel, or change the card it charges (the pencil next to your plan's card), in Stripe.`
                ) : (
                  `${PLAN_NAME[plan]}. Your library's admins manage the subscription.`
                )}
                {ws.covers.length ? ` It also covers ${ws.covers.join(", ")}.` : ""}
                {pauseNote}
              </CardDescription>
              {admin && (
                <CardAction>
                  <form action={openPortal}>
                    <SubmitButton variant="outline" size="sm">
                      Manage subscription
                    </SubmitButton>
                  </form>
                </CardAction>
              )}
            </CardHeader>
            {admin && (
              <CardContent className="flex flex-col items-start gap-3">
                <p className="font-medium">Change plan</p>
                {plan === "individual" ? (
                  <>
                    <p className="text-muted-foreground">
                      Team covers all your libraries, up to 10, shared with your team, at{" "}
                      {switchPrice
                        ? `${usd(switchPrice.cents)} a person a ${switchPrice.interval}`
                        : `${priceLabel(PRICES.team, "monthly")} a person a month, or ${usd(PRICES.team.annual * 1200)} a year`}
                      , for at least {MIN_TEAM_SEATS} seats.
                    </p>
                    <div>
                      <SwitchToTeamButton price={switchPrice} />
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    To move to Individual,{" "}
                    <a href={enterprise.href} className={link}>
                      write to us
                    </a>
                    : the team's people would lose access.
                  </p>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {plan === "team" && team && !ws.billedWith && (
          <Card>
            <CardHeader>
              <CardTitle>Seats</CardTitle>
              <CardDescription>
                {team.seatsUsed} of {team.seats} in use
                {team.libraries > 1 ? `, across ${team.libraries} libraries` : ""}
                {seatPrice
                  ? `, at ${usd(seatPrice.cents)} a person a ${seatPrice.interval}. A change is prorated and billed today.`
                  : "."}
              </CardDescription>
            </CardHeader>
            {team.admin && (
              <CardContent>
                <form action={changeSeats} className="flex items-end gap-2">
                  <Field className="w-28">
                    <FieldLabel htmlFor="seats">Seats</FieldLabel>
                    <Input
                      id="seats"
                      name="seats"
                      type="number"
                      min={Math.max(MIN_TEAM_SEATS, team.seatsUsed)}
                      max={MAX_TEAM_SEATS}
                      defaultValue={team.seats}
                    />
                  </Field>
                  <SubmitButton variant="outline">Update seats</SubmitButton>
                </form>
              </CardContent>
            )}
          </Card>
        )}

        {/* On or off in the header, what that does under it; then the month's spend and the cap. */}
        {credits && plan !== "free" && (
          <Card>
            <CardHeader>
              <CardTitle>Pay-as-you-go</CardTitle>
              <CardDescription>
                {credits.pay_as_you_go
                  ? `On: when the month's ${credits.included.toLocaleString("en-US")} credits run out, Libro keeps going at ${indexOveragePrice}, up to the monthly cap.`
                  : `Off: when the month's ${credits.included.toLocaleString("en-US")} credits run out, Libro's cataloging and file reading wait until next month. Your agents' writes are never held.`}
                {ws.billedWith
                  ? ` It's your Team's: change it in ${ws.billedWith}'s Billing.`
                  : admin
                    ? ""
                    : " Your library's admins can change it."}
              </CardDescription>
              {admin && !ws.billedWith && (
                <CardAction>
                  <PayAsYouGoSwitch enabled={credits.pay_as_you_go} />
                </CardAction>
              )}
            </CardHeader>
            {(credits.pay_as_you_go || credits.overage > 0 || credits.pay_as_you_go_paused) && (
              <CardContent className="flex flex-col gap-5">
                {credits.pay_as_you_go_paused && (
                  <ErrorAlert>
                    Paused: the last payment didn't go through. It resumes when Stripe collects it.
                    Update your card under Manage subscription.
                  </ErrorAlert>
                )}
                {(credits.pay_as_you_go || credits.overage > 0) && (
                  <Meter
                    label="This month"
                    used={credits.overage_cents}
                    limit={credits.cap_cents}
                    format={usd}
                  />
                )}
                {credits.pay_as_you_go_capped && (
                  <p className="text-sm text-muted-foreground">
                    Reached: Libro's cataloging and file reading wait until next month, or until the
                    cap is raised.
                  </p>
                )}
                {/* The cap matters once it's on: only then is it asked. */}
                {admin && !ws.billedWith && credits.pay_as_you_go && (
                  <CountedForm
                    event="cap_set"
                    action={setPayAsYouGoCap}
                    className="flex items-end gap-2"
                  >
                    <Field className="w-32">
                      <FieldLabel htmlFor="cap">Monthly cap</FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>
                          <InputGroupText>$</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          id="cap"
                          name="dollars"
                          type="number"
                          min={PAYG_CAP_DOLLARS.min}
                          max={PAYG_CAP_DOLLARS.max}
                          step={1}
                          defaultValue={credits.cap_cents / 100}
                        />
                      </InputGroup>
                    </Field>
                    <SubmitButton variant="outline">Save</SubmitButton>
                  </CountedForm>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* The plan grid is for choosing one: a paid plan changes in Subscription, above. */}
        {plan === "free" && <PlanCards variant="billing" currentPlan={plan} admin={admin} />}
        {/* What helps someone choose a plan; a paid plan's Subscription card covers cancelling. */}
        {plan === "free" && (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>Upgrading keeps this library as it is: its concepts, files, and agents.</p>
            {/* Buying is the admin's: a teammate isn't told how. */}
            {admin && (
              <>
                <p>{riskReversal}</p>
                <p>{taxNote}</p>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** How much of a limit is used: amber from 80%, red from 95%. */
function Meter({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  format: (n: number) => string;
}) {
  const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <Progress value={pct} tone={pct >= 95 ? "destructive" : pct >= 80 ? "warning" : "default"}>
      <ProgressLabel>{label}</ProgressLabel>
      {/* A plain count, not ProgressValue: a server page can't hand it a formatter. */}
      <span className="ml-auto text-sm text-muted-foreground tabular-nums">
        {format(used)} of {format(limit)}
      </span>
    </Progress>
  );
}
