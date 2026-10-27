import { ButtonLink } from "@/components/button-link";
import { ErrorAlert } from "@/components/error-alert";
import { PageHeader } from "@/components/page-header";
import { CheckoutButton } from "@/components/plan-cards";
import { SettingsTabs } from "@/components/settings-tabs";
import { AddSeat, InviteLink, RemoveMember, RoleMenu } from "@/components/team-controls";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { getMe, getSeatPrice, getTeam } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";
import { usd } from "@/lib/site";
import { siteOrigin } from "@/lib/site-origin";

export const metadata = { title: "Team | librocat" };

/** The roles as people see them (convex/membership.ts Role). */
const ROLE_LABEL = { admin: "Admin", editor: "Editor", reader: "Reader" } as const;

export default async function TeamPage() {
  await requireSession();
  const [{ data: team, error }, { data: me }] = await Promise.all([getTeam(), getMe()]);
  const plan = me?.workspace?.plan ?? "free";
  const origin = await siteOrigin();
  const shareable = (team?.seats ?? 0) > 1;
  // Every seat taken: a new person can't join until there's one more (Cloud).
  const full = shareable && !selfHost && team !== null && team.seatsUsed >= team.seats;
  const billedWith = me?.workspace?.billedWith ?? null;
  // Its price as this Team pays it, monthly or yearly: asked of Stripe only when full.
  const seatPrice = full && !billedWith ? await getSeatPrice() : null;

  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs selfHost={selfHost} />
      {!team ? (
        <ErrorAlert>{error ?? "No library yet."}</ErrorAlert>
      ) : (
        <div className="flex flex-col gap-6">
          {team.admin && (
            <Card>
              <CardHeader>
                <CardTitle>Invite people</CardTitle>
                <CardDescription>
                  {full
                    ? `All ${team.seats} seats are taken: a new person can't join until you add one.`
                    : shareable
                      ? "Anyone with this link can join after they sign in."
                      : "The Team plan covers your libraries, up to 10, for three people or more."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {full &&
                  (billedWith ? (
                    <p className="text-sm text-muted-foreground">
                      Add one in {billedWith}'s Billing: its plan covers this library.
                    </p>
                  ) : (
                    <div>
                      {seatPrice ? (
                        <AddSeat
                          seats={team.seats}
                          price={`${usd(seatPrice.cents)} a ${seatPrice.interval}`}
                        />
                      ) : (
                        <ButtonLink href="/dashboard/billing" size="sm" prefetch={false}>
                          Add a seat in Billing
                        </ButtonLink>
                      )}
                    </div>
                  ))}
                {shareable ? (
                  <InviteLink
                    url={team.inviteCode ? `${origin}/invite/${team.inviteCode}` : null}
                    role={team.inviteRole}
                  />
                ) : (
                  !selfHost &&
                  (plan === "individual" ? (
                    <ButtonLink href="/dashboard/billing" size="sm" prefetch={false}>
                      Switch to Team
                    </ButtonLink>
                  ) : (
                    <CheckoutButton plan="team" interval="annual" label="Start Team" />
                  ))
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                {team.members.length > 1 && selfHost
                  ? // Self-hosted: seats are unlimited (convex/model.ts), so count people.
                    `${team.members.length} people`
                  : team.seats > 1 && !selfHost
                    ? `${team.seatsUsed} of ${team.seats} seats used${team.libraries > 1 ? `, across ${team.libraries} libraries` : ""}`
                    : "Just you, for now."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ItemGroup>
                {team.members.map((m) => (
                  <Item key={m.userId} variant="outline" size="sm">
                    <ItemMedia>
                      <Avatar>
                        <AvatarFallback>
                          {((m.name ?? m.email)[0] ?? "?").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    {/* min-w-0 and max-w-full let a long name or email truncate, so the badges and actions stay on a phone. */}
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full">
                        <span className="truncate">{m.name ?? m.email}</span>
                        {m.you && <Badge variant="secondary">You</Badge>}
                        {/* The owner's word says why their row has no menu and no Remove. */}
                        {!(team.admin && !m.owner && !m.you) && (
                          <Badge variant="outline">{m.owner ? "Owner" : ROLE_LABEL[m.role]}</Badge>
                        )}
                      </ItemTitle>
                      {m.name && (
                        <ItemDescription>
                          <span className="block truncate">{m.email}</span>
                        </ItemDescription>
                      )}
                    </ItemContent>
                    {/* An admin sets what each teammate may do, but not the owner's or their own. */}
                    {team.admin && !m.owner && !m.you && (
                      <ItemActions>
                        <RoleMenu userId={m.userId} name={m.name ?? m.email} role={m.role} />
                        <RemoveMember userId={m.userId} email={m.email} />
                      </ItemActions>
                    )}
                  </Item>
                ))}
              </ItemGroup>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
