import { AuthForm } from "@/components/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { invitedLine, inviteFrom } from "@/lib/invite";

export const metadata = { title: "Sign in | librocat" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  // From an invite link: the library it joins.
  const invite = await inviteFrom((await searchParams).next);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{invite ? `Join ${invite.workspace}` : "Welcome back"}</h1>
        </CardTitle>
        <CardDescription>
          {invite ? `${invitedLine(invite)} Sign in to join.` : "Sign in to your library."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm mode="sign-in" />
      </CardContent>
    </Card>
  );
}
