"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { pickLibrary } from "@/app/(auth)/consent/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { count } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";

type PublicClient = { client_name?: string; client_uri?: string };

const SCOPE_LABELS: Record<string, string> = {
  openid: "Know who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected until you disconnect it",
};

type Library = { slug: string; name: string };

/**
 * Approve or deny an agent's request; Better Auth redirects back to the
 * agent. With several libraries, the person first picks the one the agent
 * works in (`initial`: the one the dashboard has open).
 */
export function ConsentForm({
  clientId,
  scopes,
  libraries = [],
  initial,
}: {
  clientId: string;
  scopes: string[];
  libraries?: Library[];
  initial?: string;
}) {
  const [client, setClient] = useState<PublicClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [library, setLibrary] = useState(initial ?? libraries[0]?.slug ?? "");
  const several = libraries.length > 1;

  useEffect(() => {
    if (!clientId) return;
    authClient.oauth2
      .publicClient({ query: { client_id: clientId } })
      .then(({ data }) => setClient((data as PublicClient) ?? null));
  }, [clientId]);

  async function decide(accept: boolean) {
    setLoading(true);
    // The library first, so the agent's first call already reaches it.
    if (accept && several && clientId) {
      const failed = await pickLibrary(clientId, library);
      if (failed) {
        toast.error(failed);
        setLoading(false);
        return;
      }
    }
    const { error } = await authClient.oauth2.consent({ accept });
    if (error) {
      toast.error(error.message ?? "Could not record your decision");
      setLoading(false);
    } else if (accept) count("agent_approved");
    // On success Better Auth redirects the browser back to the agent.
  }

  const name = client?.client_name ?? "An MCP client";
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">{name}</p>
        {client?.client_uri && <p className="text-xs text-muted-foreground">{client.client_uri}</p>}
      </div>
      {several && (
        <FieldSet>
          <FieldLegend variant="label">Library</FieldLegend>
          <RadioGroup value={library} onValueChange={(v) => setLibrary(String(v))}>
            {libraries.map((l) => (
              <Field key={l.slug} orientation="horizontal">
                <RadioGroupItem value={l.slug} id={`library-${l.slug}`} />
                <FieldLabel htmlFor={`library-${l.slug}`}>{l.name}</FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
      )}
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Search, read, and write the concepts and files in{" "}
          {several ? "the library you pick" : "your library"}
        </li>
        {scopes
          .filter((s) => SCOPE_LABELS[s])
          .map((s) => (
            <li key={s}>{SCOPE_LABELS[s]}</li>
          ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        You can disconnect it anytime on the dashboard&apos;s Connect page.
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={loading} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={loading}
          onClick={() => decide(false)}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}
