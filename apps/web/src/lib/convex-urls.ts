/** The Convex deployment's client URL (`.convex.cloud`, or the local backend). */
export const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * The deployment's HTTP origin, where Better Auth answers: `.convex.site`
 * for a cloud deployment, one port up for the local backend (3210 → 3211).
 * NEXT_PUBLIC_CONVEX_SITE_URL overrides it.
 */
export const convexSiteUrl = ((): string | undefined => {
  if (process.env.NEXT_PUBLIC_CONVEX_SITE_URL) return process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexUrl) return undefined;
  const u = new URL(convexUrl);
  if (u.hostname.endsWith(".convex.cloud")) {
    u.hostname = u.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  } else if (u.port) {
    u.port = String(Number(u.port) + 1);
  }
  return u.origin;
})();
