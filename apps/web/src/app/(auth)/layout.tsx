import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { link } from "@/lib/utils";

// Sign-in, sign-up, reset, and an agent's consent screen: pages to use, not
// to find in a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// shadcn's login-03: the brand above one centered card, on a muted page.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Brand className="self-center" />
        {children}
        <p className="px-6 text-center text-sm text-balance text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className={link}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className={link}>
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
