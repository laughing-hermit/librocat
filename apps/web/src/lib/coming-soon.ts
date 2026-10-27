/**
 * Before launch the site runs with hosted closed: the landing page is the
 * whole site, the header, the hero, and the pricing grid say Cloud opens
 * soon, and the proxy sends /dashboard, /sign-in, and /sign-up
 * back to /. Set LIBROCAT_COMING_SOON=1 on
 * the Vercel project; remove it to open sign-up and
 * Checkout. Read on the server only (render and proxy), so no NEXT_PUBLIC_.
 */
export const comingSoon = process.env.LIBROCAT_COMING_SOON === "1";
