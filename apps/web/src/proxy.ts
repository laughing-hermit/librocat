import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { comingSoon } from "@/lib/coming-soon";

// Next 16 proxy (the file convention that replaced middleware.ts). A cheap,
// optimistic gate: no session cookie, no dashboard. Each dashboard page still
// verifies the session itself (src/lib/require-session.ts).
const isProtected = (path: string) => path === "/dashboard" || path.startsWith("/dashboard/");
// Before launch (LIBROCAT_COMING_SOON=1): no sign-up, no sign-in, no
// password reset, no agent consent, no team invites, no dashboard.
const CLOSED = ["/sign-in", "/sign-up", "/reset-password", "/consent"];
const isClosed = (path: string) =>
  isProtected(path) || CLOSED.includes(path) || path.startsWith("/invite/");

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // (Sign-up is closed at the API too: src/app/api/auth/[...all]/route.ts.)
  if (comingSoon) {
    return isClosed(path) ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  const signedIn = Boolean(getSessionCookie(request));
  if (isProtected(path) && process.env.NEXT_PUBLIC_CONVEX_URL && !signedIn) {
    // Back to where they were going once they've signed in (auth-form.tsx nextPath).
    const to = new URL("/sign-in", request.url);
    to.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(to);
  }
  // Someone already signed in, sent to sign up on the way somewhere (a plan
  // picked on the landing page): straight there, if it's on this site.
  const next = request.nextUrl.searchParams.get("next");
  if ((path === "/sign-up" || path === "/sign-in") && next && signedIn) {
    const to = URL.parse(next, request.url);
    if (to?.origin === request.nextUrl.origin) return NextResponse.redirect(to);
  }
  return NextResponse.next();
}

export const config = {
  // Only the paths it acts on, and not their prefetches: each match is a
  // function run, so the MCP, the public pages (served from the CDN), the
  // APIs (an agent's token refresh too), and a link's prefetch skip it.
  // The page a prefetch loads checks the session itself. `.*` takes dots
  // too (a concept id may have one). Literal, as Next reads it at build.
  matcher: [
    {
      source: "/(dashboard|dashboard/.*|sign-in|sign-up|reset-password|consent|invite/.*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
