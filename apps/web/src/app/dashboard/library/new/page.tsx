import { NewLibraryForm, NewPaidLibraryForm } from "@/components/library-controls";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLibraries } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";
import { FREE_LIBRARIES, TEAM_LIBRARIES } from "@/lib/site";

export const metadata = { title: "New library | librocat" };

export default async function NewLibraryPage() {
  await requireSession();
  const { data: libraries } = await getLibraries();
  // A new library starts on Free, and a person owns at most FREE_LIBRARIES
  // of those (convex/workspaces.ts create): past that, one of theirs needs a
  // plan first, so say so before the form instead of after it.
  const owned = (libraries ?? []).filter((l) => l.owner);
  // On a Team with room, it comes under the Team instead (convex/teamCover.ts).
  const team = owned.filter((l) => l.plan === "team").length;
  const covered = !selfHost && team > 0 && team < TEAM_LIBRARIES;
  const full =
    !selfHost && !covered && owned.filter((l) => l.plan === "free").length >= FREE_LIBRARIES;
  return (
    <>
      <PageHeader
        title="New library"
        description={
          selfHost
            ? "A separate library, with its own concepts, people, and address."
            : "A separate library, with its own concepts, people, address, and plan."
        }
      />
      <Card>
        {full ? (
          <>
            <CardHeader>
              <CardTitle>This one comes with a plan</CardTitle>
              <CardDescription>
                Free covers one library per person, and you have it. Name the new one, pick its
                plan, and pay in Stripe's Checkout.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NewPaidLibraryForm />
            </CardContent>
          </>
        ) : (
          <>
            {covered && (
              <CardHeader>
                <CardTitle>On your Team plan</CardTitle>
                <CardDescription>
                  It comes under your Team, on its bill, and shares its seats and limits.
                </CardDescription>
              </CardHeader>
            )}
            <CardContent>
              <NewLibraryForm />
            </CardContent>
          </>
        )}
      </Card>
    </>
  );
}
