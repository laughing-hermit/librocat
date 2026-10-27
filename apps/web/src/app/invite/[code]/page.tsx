import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { AcceptInvite } from "@/components/team-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAuthenticated } from "@/lib/auth-server";
import { invitedLine } from "@/lib/invite";
import { getInvite, getMe } from "@/lib/librocat";

export const metadata = {
  title: "Join a team | librocat",
  robots: { index: false, follow: false },
};

/** An invite link: sign in (or up), then join the workspace behind it. */
export default async function InvitePage({ params }: PageProps<"/invite/[code]">) {
  const { code } = await params;
  if (!(await isAuthenticated())) redirect(`/sign-up?next=/invite/${encodeURIComponent(code)}`);
  const [{ data: invite }, { data: me }] = await Promise.all([getInvite(code), getMe()]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Brand className="self-center" />
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{invite ? `Join ${invite.workspace}` : "This invite no longer works"}</h1>
            </CardTitle>
            <CardDescription>
              {invite
                ? `${invitedLine(invite)} You'll join as ${me?.email}.`
                : "Ask the person who sent it for a new link."}
            </CardDescription>
          </CardHeader>
          {invite && (
            <CardContent>
              <AcceptInvite code={code} />
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
