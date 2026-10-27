"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeInput } from "@/components/code-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { count } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";
import { link } from "@/lib/utils";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Sign-in is not available: this deployment has no workspace backend yet (set{" "}
          <code>NEXT_PUBLIC_CONVEX_URL</code>).
        </CardContent>
      </Card>
    );
  }
  return <BetterAuthForm mode={mode} />;
}

/**
 * An agent's sign-in lands here with its authorization request in the query
 * string (Better Auth's OAuth provider sends it to the login page). The auth
 * client carries that query along on every call from this page, so the
 * moment a session exists Better Auth resumes the authorization and
 * redirects to /consent (or straight back to the agent). Without one, a
 * signed-in user goes to the dashboard.
 */
function isAgentAuthorization(): boolean {
  return new URLSearchParams(window.location.search).has("client_id");
}

/**
 * Where to go after signing in: a `next` on this site (an invite link, a plan
 * picked on the landing page), else the dashboard. Resolved, not prefix-
 * checked: a browser reads "/\\host" as another site.
 */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return "/dashboard";
  try {
    const to = new URL(next, window.location.origin);
    if (to.origin === window.location.origin) return `${to.pathname}${to.search}${to.hash}`;
  } catch {
    // Not a URL at all: the dashboard.
  }
  return "/dashboard";
}

/** After sign-in or verification: onward, unless Better Auth is already redirecting. */
function useFinish() {
  const router = useRouter();
  return (data: unknown) => {
    const redirecting = (data as { redirect?: boolean } | null)?.redirect === true;
    if (!redirecting && !isAgentAuthorization()) router.push(nextPath());
  };
}

function BetterAuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const finish = useFinish();
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  // The other page, carrying a pending agent authorization along.
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), []);
  const isSignUp = mode === "sign-up";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    try {
      if (isSignUp) {
        const { error } = await authClient.signUp.email({
          email,
          password,
          // What teammates see next to their agents (Connect, Team).
          name: String(form.get("name") ?? "").trim() || (email.split("@")[0] ?? email),
        });
        if (error) toast.error(error.message ?? "Could not create the account");
        else setPendingEmail(email);
        return;
      }
      const { data, error } = await authClient.signIn.email({ email, password });
      if (error?.status === 403) {
        // Unverified address: Better Auth just sent a fresh code.
        setPendingEmail(email);
      } else if (error) {
        toast.error("Invalid email or password");
      } else {
        finish(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const { data, error } = await authClient.emailOtp.verifyEmail({
        email: pendingEmail ?? "",
        otp: String(form.get("code")).trim(),
      });
      if (error) toast.error("That code did not work. Check your inbox for the latest one.");
      else {
        count("signed_up");
        finish(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (!pendingEmail) return;
    await authClient.emailOtp.sendVerificationOtp({
      email: pendingEmail,
      type: "email-verification",
    });
    toast.success("A new code is on its way");
  }

  if (pendingEmail) {
    return (
      // `key` on both forms: without it React reuses the password <input> for the
      // code field at the same tree position, and the typed password shows up
      // there in plain text.
      <form key="verify" onSubmit={onVerify}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="code">Verification code</FieldLabel>
            <FieldDescription>
              We sent a code to <span className="font-medium text-foreground">{pendingEmail}</span>.
              Enter it to continue.
            </FieldDescription>
            <CodeInput />
          </Field>
          <Field>
            <Button type="submit" disabled={loading}>
              {loading && <Spinner />}
              Verify and continue
            </Button>
          </Field>
          <Field orientation="horizontal">
            <Button type="button" variant="ghost" className="flex-1" onClick={onResend}>
              Send a new code
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => setPendingEmail(null)}
            >
              Use a different email
            </Button>
          </Field>
        </FieldGroup>
      </form>
    );
  }

  return (
    <form key="credentials" onSubmit={onSubmit}>
      <FieldGroup>
        {isSignUp && (
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" required maxLength={60} autoComplete="name" />
            <FieldDescription>What your teammates see next to your agents.</FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            {!isSignUp && (
              <Link href="/reset-password" className={`ml-auto text-sm ${link}`}>
                Forgot password?
              </Link>
            )}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />
          {isSignUp && <FieldDescription>At least 8 characters.</FieldDescription>}
        </Field>
        <Field>
          <Button type="submit" disabled={loading}>
            {loading && <Spinner />}
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
          <FieldDescription className="text-center">
            {isSignUp ? "Already have an account? " : "No account yet? "}
            <Link href={`${isSignUp ? "/sign-in" : "/sign-up"}${search}`}>
              {isSignUp ? "Sign in" : "Create one"}
            </Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
