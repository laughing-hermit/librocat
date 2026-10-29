import { AuthForm } from "@/components/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { invitedLine, inviteFrom } from "@/lib/invite";

export const metadata = { title: "Create account | librocat" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  // From an invite link: the library it joins, not the Free plan.
  const invite = await inviteFrom((await searchParams).next);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{invite ? `Join ${invite.workspace}` : "Create your account"}</h1>
        </CardTitle>
        <CardDescription>
          {invite
            ? `${invitedLine(invite)} Create your account to join.`
            : "Free for up to 1,000 concepts. No card needed."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm mode="sign-up" />
      </CardContent>
    </Card>
  );
}
