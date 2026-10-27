/**
 * HTTP surface of the Convex deployment:
 *   POST /stripe/webhook — Stripe events (verified in a Node action)
 *   /api/auth/*          — Better Auth: sign-in, sign-up, email codes, and the
 *                          OAuth authorization server for the remote MCP
 *   GET /files/*         — kept files, by signed links that expire and count
 *                          the bytes they serve (files.ts)
 *
 * The remote MCP endpoint is not here: it is a Next.js route on Vercel
 * (apps/web/src/app/mcp/route.ts) that calls the functions in mcp.ts with
 * the agent's OAuth access token.
 */

import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { serve } from "./files";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("missing stripe-signature", { status: 400 });
    const payload = await req.text();
    try {
      const ok = await ctx.runAction(internal.stripe.fulfill, { payload, signature });
      if (!ok) return new Response("webhook verification failed", { status: 400 });
      return new Response(null, { status: 200 });
    } catch (exc) {
      // Not a signature problem: say so, and let Stripe retry against a 5xx.
      return new Response(exc instanceof Error ? exc.message : String(exc), { status: 500 });
    }
  }),
});

http.route({ pathPrefix: "/files/", method: "GET", handler: serve });

export default http;
