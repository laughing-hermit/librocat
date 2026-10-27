import { AlertTriangle, Info } from "lucide-react";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ButtonLink } from "@/components/button-link";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import { NotOnPage } from "@/components/not-on-page";
import { UpgradeButton } from "@/components/plan-cards";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getLibraries, getMe, type Me } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";
import { dashboardNav, indexOveragePrice, usd } from "@/lib/site";
import { formatBytes } from "@/lib/utils";

// A person's own library: never in a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// The dashboard shell: one bar on top (four places don't need a sidebar)
// and one centered column under it.
//
// Every page has its own loading.tsx. A page with pages under it keeps its
// page and loading.tsx in an (overview) route group, so opening a page
// below never flashes the loading state of the one above it.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const [{ data: me }, { data: libraries }] = await Promise.all([getMe(), getLibraries()]);
  const items = dashboardNav;

  return (
    <>
      <AppHeader
        items={items}
        email={me?.email ?? ""}
        libraries={(libraries ?? []).map((l) => ({
          id: l.id,
          name: l.name,
          plan: l.plan,
          current: l.current,
        }))}
        selfHost={selfHost}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-6 pb-16">
        {!selfHost && me?.workspace && (
          // Billing is where the banner leads: it says the same there.
          <NotOnPage path="/dashboard/billing">
            <LimitBanner workspace={me.workspace} />
            <CreditsBanner workspace={me.workspace} />
          </NotOnPage>
        )}
        <DashboardBreadcrumb />
        {children}
      </main>
    </>
  );
}

/** From 95% of a limit, or when the month's writes are used up, every page says so, one click from more. */
const FULL = 0.95;

function LimitBanner({ workspace: ws }: { workspace: NonNullable<Me["workspace"]> }) {
  // On a Team, its libraries share the plan: the counts are theirs together.
  const use = ws.usage;
  const concepts = use.concepts >= use.maxConcepts * FULL;
  const storage = use.maxSourceBytes !== null && use.sourceBytes >= use.maxSourceBytes * FULL;
  if (!concepts && !storage && !ws.writesBlocked) return null;
  const across = use.libraries > 1 ? ` across your Team's ${use.libraries} libraries` : "";
  const what = ws.writesBlocked
    ? `${use.libraries > 1 ? "Your Team's libraries have" : "This library has"} used the month's writes: agents can read, and write again as the month refills.`
    : concepts
      ? `${use.concepts.toLocaleString("en-US")} of ${use.maxConcepts.toLocaleString("en-US")} concepts used${across}. At the limit, agents can't save new ones.`
      : `${formatBytes(use.sourceBytes)} of ${formatBytes(use.maxSourceBytes ?? 0)} of documents and pictures used${across}. At the limit, new ones aren't kept.`;
  return (
    <div className="pb-6">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{ws.writesBlocked ? "Writes are paused" : "Almost full"}</AlertTitle>
        <AlertDescription>
          <p>{what}</p>
        </AlertDescription>
        {/* Beside the description, not in it: its links are underlined, a button too. */}
        <div className="col-start-2 mt-2">
          <UpgradeButton plan={ws.plan} admin={ws.admin} />
        </div>
      </Alert>
    </div>
  );
}

/** "November" for a credits period ("2026-10"): the month after it, when credits refill. */
const nextMonth = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
};

/**
 * Libro's credits for the month are used and it can't go on (no
 * pay-as-you-go, or at its cap, or paused): every page says so, and the one
 * step that gets it going again, as Claude does at its limit. Agents' writes
 * never wait for credits; Libro's cataloging and file reading do.
 */
function CreditsBanner({ workspace: ws }: { workspace: NonNullable<Me["workspace"]> }) {
  const c = ws.indexCredits;
  if (!c || c.remaining > 0) return null;
  const paid = ws.plan !== "free";
  if (paid && c.pay_as_you_go && !c.pay_as_you_go_capped && !c.pay_as_you_go_paused) return null;
  const whose = ws.plan === "team" ? "Your Team's" : "This library's";
  const waits = `${whose} ${c.included.toLocaleString("en-US")} of Libro's credits for the month are used: cataloging and file reading wait until ${nextMonth(c.period)} 1. Your agents' writes still go through.`;
  // The way on, and who takes it: the admins, at the library that holds the plan.
  const [next, action] = !paid
    ? [ws.admin ? "Upgrade for more each month." : "Your library's admins can upgrade it.", null]
    : ws.billedWith
      ? [
          `Pay-as-you-go is your Team's: turn it on, or raise its cap, in ${ws.billedWith}'s Billing.`,
          null,
        ]
      : c.pay_as_you_go_paused
        ? ["Pay-as-you-go waits while the last payment is overdue.", "Update the card"]
        : c.pay_as_you_go_capped
          ? [`Pay-as-you-go reached its ${usd(c.cap_cents)} cap.`, "Raise the cap"]
          : [
              `Turn on pay-as-you-go to keep going, at ${indexOveragePrice}, up to a monthly cap you set.`,
              "Turn on pay-as-you-go",
            ];
  return (
    <div className="pb-6">
      <Alert>
        <Info />
        <AlertTitle>Libro's credits are used for the month</AlertTitle>
        <AlertDescription>
          <p>
            {waits} {next}
            {paid && !ws.admin && !ws.billedWith ? " Your library's admins can change it." : ""}
          </p>
        </AlertDescription>
        {ws.admin && (!paid || action) && (
          <div className="col-start-2 mt-2">
            {!paid ? (
              <UpgradeButton plan={ws.plan} admin={ws.admin} />
            ) : (
              <ButtonLink href="/dashboard/billing" size="sm" prefetch={false}>
                {action}
              </ButtonLink>
            )}
          </div>
        )}
      </Alert>
    </div>
  );
}
