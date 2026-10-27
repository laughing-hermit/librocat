import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/consent-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAuthenticated } from "@/lib/auth-server";
import { ensureWorkspace, getLibraries, getMe } from "@/lib/librocat";

export const metadata = { title: "Connect an agent | librocat" };

/**
 * Better Auth's OAuth provider sends the browser here when an agent asks for
 * access (convex/auth.ts, consentPage). Approving connects the agent to the
 * signed-in user's workspace; the query string carries the pending
 * authorization, and the auth client sends it back with the decision.
 */
export default async function ConsentPage({ searchParams }: PageProps<"/consent">) {
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]],
    ),
  ).toString();
  if (!(await isAuthenticated())) redirect(`/sign-in?${query}`);
  await ensureWorkspace();
  const [{ data: me }, { data: libraries }] = await Promise.all([getMe(), getLibraries()]);
  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  const scope = typeof params.scope === "string" ? params.scope : "";
  // The agent works in one library: with several, the person picks it here
  // (consent-form.tsx), the dashboard's open one first; `?library=` on its
  // MCP URL still names another (convex/mcp.ts).
  const choices = (libraries ?? []).flatMap((l) =>
    l.slug ? [{ slug: l.slug, name: l.name }] : [],
  );
  const several = choices.length > 1;
  const open = libraries?.find((l) => l.current && l.slug)?.slug ?? undefined;
  const only = libraries?.[0]?.name ?? "your library";
  const strong = "font-medium text-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Connect an agent</h1>
        </CardTitle>
        <CardDescription>
          An agent is asking to read and write{" "}
          {several ? "one of your libraries" : <span className={strong}>{only}</span>} as{" "}
          <span className={strong}>{me?.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConsentForm
          clientId={clientId}
          scopes={scope ? scope.split(" ") : []}
          libraries={several ? choices : []}
          initial={open}
        />
      </CardContent>
    </Card>
  );
}
