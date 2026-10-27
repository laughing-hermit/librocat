import { AlertTriangle } from "lucide-react";
import { DeleteAccountControl } from "@/components/delete-account-control";
import { NameForm } from "@/components/name-form";
import { PageHeader } from "@/components/page-header";
import { ReportEmailSwitch } from "@/components/report-email-switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { getLibraries, getMe, getReportEmail } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";
import { site } from "@/lib/site";

export const metadata = { title: "Account | librocat" };

/** Your account, from the user menu: your name, its email, and deleting it. The library's settings are Settings. */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const [{ error }, { data: me }, { data: email }, { data: libraries }] = await Promise.all([
    searchParams,
    getMe(),
    getReportEmail(),
    getLibraries(),
  ]);
  // Deleting the account ends the plans of the libraries they own, and says so.
  const paid = (libraries ?? []).some((l) => l.owner && l.plan !== "free");
  // Free gets Libro's email on the month's first Monday (convex/report.ts reportAll).
  const when =
    !selfHost && me?.workspace?.plan === "free" ? "Once a month, on Free" : "Every Monday";

  return (
    <>
      <PageHeader title="Account" description={`You sign in with ${me?.email ?? "your email"}.`} />
      <div className="flex flex-col gap-6">
        {error === "delete" && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              Your account could not be deleted. Try again, or write to {site.contact}.
            </AlertDescription>
          </Alert>
        )}
        {error === "email" && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              The email setting couldn't be saved. Please try again.
            </AlertDescription>
          </Alert>
        )}
        {me && (
          <Card>
            <CardHeader>
              <CardTitle>Name</CardTitle>
              <CardDescription>
                What your teammates see, on Team and next to your agents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NameForm name={me.name} />
            </CardContent>
          </Card>
        )}
        {me?.workspace && (
          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
              <CardDescription>What librocat sends to {me.email}.</CardDescription>
            </CardHeader>
            <CardContent>
              <ItemGroup>
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>Libro's report</ItemTitle>
                    <ItemDescription>
                      {when}, for {me.workspace.name}: what's new, and what needs you.
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ReportEmailSwitch enabled={email ?? false} />
                  </ItemActions>
                </Item>
              </ItemGroup>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>This can't be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <Item variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>Delete your account</ItemTitle>
                  <ItemDescription>
                    Your account and every library you own go, for good.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <DeleteAccountControl paid={paid} />
                </ItemActions>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
