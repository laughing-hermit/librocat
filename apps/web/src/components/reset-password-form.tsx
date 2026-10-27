"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CodeInput } from "@/components/code-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

/**
 * Two-step password reset (Better Auth's emailOTP plugin, convex/auth.ts):
 * request a code by email, then submit the code with a new password. The
 * same message shows whether or not the address has an account.
 */
export function ResetPasswordForm() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <p className="text-sm text-muted-foreground">
        Password reset is not available: this deployment has no workspace backend yet.
      </p>
    );
  }
  return <BetterAuthResetPasswordForm />;
}

function BetterAuthResetPasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  async function onRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const requested = String(new FormData(e.currentTarget).get("email"));
    try {
      // The result is not shown: the next step reads the same either way.
      await authClient.emailOtp.requestPasswordReset({ email: requested });
      setEmail(requested);
    } finally {
      setLoading(false);
    }
  }

  async function onReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("newPassword"));
    try {
      const { error } = await authClient.emailOtp.resetPassword({
        email: email ?? "",
        otp: String(form.get("code")).trim(),
        password,
      });
      if (error) {
        toast.error("That code did not work. Check your inbox for the latest one.");
        return;
      }
      const signedIn = await authClient.signIn.email({ email: email ?? "", password });
      router.push(signedIn.error ? "/sign-in" : "/dashboard");
    } finally {
      setLoading(false);
    }
  }

  if (email) {
    return (
      <form key="reset" onSubmit={onReset}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="code">Code</FieldLabel>
            <FieldDescription>
              If <span className="font-medium text-foreground">{email}</span> has a librocat
              account, a code is on its way. Enter it with a new password.
            </FieldDescription>
            <CodeInput />
          </Field>
          <Field>
            <FieldLabel htmlFor="newPassword">New password</FieldLabel>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <FieldDescription>At least 8 characters.</FieldDescription>
          </Field>
          <Field>
            <Button type="submit" disabled={loading}>
              {loading && <Spinner />}
              Set new password
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEmail(null)}>
              Use a different email
            </Button>
          </Field>
        </FieldGroup>
      </form>
    );
  }

  return (
    <form key="request" onSubmit={onRequest}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
        <Field>
          <Button type="submit" disabled={loading}>
            {loading && <Spinner />}
            Send reset code
          </Button>
          <FieldDescription className="text-center">
            <Link href="/sign-in">Back to sign in</Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
