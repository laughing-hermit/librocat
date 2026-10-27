/**
 * A self-hosted deployment has no plans and no billing: set
 * LIBROCAT_SELF_HOST=1 on both the Next.js app (hides Billing and plan
 * limits here) and the Convex deployment (lifts the quotas, convex/model.ts).
 * Read on the server only, so no NEXT_PUBLIC_.
 */
export const selfHost = process.env.LIBROCAT_SELF_HOST === "1";
