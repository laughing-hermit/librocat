/**
 * The remote MCP as an OAuth-protected resource (RFC 9728), and where its
 * authorization server lives. Better Auth on the Convex deployment is the
 * authorization server (convex/auth.ts); this site proxies it under
 * /api/auth, so the issuer is this site's own origin plus /api/auth.
 *
 * Everything is derived from the request origin, so dev (localhost:3000),
 * and production (librocat.com) each advertise themselves. The Convex
 * deployment's SITE_URL must be the same origin: it is the audience of the
 * access tokens Better Auth mints.
 */

import { convexSiteUrl } from "./convex-urls";

export const MCP_SCOPES = ["openid", "profile", "email", "offline_access"];

export function originOf(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_LIBROCAT_MCP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(req.url).origin;
}

export const resourceOf = (req: Request) => `${originOf(req)}/mcp`;
export const issuerOf = (req: Request) => `${originOf(req)}/api/auth`;

/** Better Auth's signing keys, read straight from the Convex deployment. */
export const jwksUrl = () => (convexSiteUrl ? `${convexSiteUrl}/api/auth/jwks` : undefined);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const corsPreflight = () => new Response(null, { status: 204, headers: CORS });

/**
 * The discovery documents change only with a deploy, which purges Vercel's
 * CDN: it serves them for an hour (and a stale copy while it fetches a new
 * one), so an agent connecting runs no function and no Convex call.
 */
const CDN_CACHED = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/** RFC 9728 protected resource metadata for /mcp. */
export function protectedResourceMetadata(req: Request): Response {
  return Response.json(
    {
      resource: resourceOf(req),
      authorization_servers: [issuerOf(req)],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "librocat",
      resource_documentation: "https://github.com/laughing-hermit/librocat",
    },
    { headers: { ...CORS, "Cache-Control": CDN_CACHED } },
  );
}

/**
 * Serve one of Better Auth's discovery documents (authorization server
 * metadata, OpenID configuration) at the root path MCP clients look for,
 * by fetching it from the Convex deployment.
 */
export async function proxyDiscovery(document: string): Promise<Response> {
  if (!convexSiteUrl) return new Response(null, { status: 404 });
  const res = await fetch(`${convexSiteUrl}/api/auth/.well-known/${document}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      ...CORS,
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      // An error isn't kept: the next request asks Convex again.
      "Cache-Control": res.ok ? CDN_CACHED : "no-store",
    },
  });
}
