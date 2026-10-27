/**
 * BotID (Vercel, its free Basic level) on the sign-up and sign-in forms: the
 * routes a person's browser posts to, which create accounts and send codes by
 * email. Checked on Vercel only (`next.config.ts`): BotID needs Vercel's
 * network, so local runs, e2e, and self-hosted installs skip it. An agent's
 * OAuth calls (`/api/auth/oauth2/*`) are never checked.
 */
export const BOT_CHECKED = [
  "/api/auth/sign-up/*",
  "/api/auth/sign-in/*",
  "/api/auth/email-otp/*",
  "/api/auth/forget-password/*",
];

/** Whether BotID checks a POST to this path. Pure. */
export const botChecked = (pathname: string): boolean =>
  BOT_CHECKED.some((p) => pathname.startsWith(p.slice(0, -1)));
