// Server-side session helpers for the dashboard: Better Auth runs on the
// Convex deployment (convex/auth.ts); these read the session cookie, trade it
// for a Convex token, and proxy /api/auth/* (src/app/api/auth/[...all]).
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { convexSiteUrl, convexUrl } from "./convex-urls";

const helpers =
  convexUrl && convexSiteUrl ? convexBetterAuthNextJs({ convexUrl, convexSiteUrl }) : null;

const notConfigured = () => new Response("auth backend not configured", { status: 404 });

/** The Convex token for the signed-in user, or undefined. */
export const getToken = async (): Promise<string | undefined> => helpers?.getToken();

export const isAuthenticated = async (): Promise<boolean> =>
  helpers ? helpers.isAuthenticated() : false;

/** A top-level browser navigation (as opposed to a fetch from a page). */
function isNavigation(req: Request): boolean {
  const mode = req.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return req.headers.get("accept")?.includes("text/html") ?? false;
}

/**
 * Better Auth answers a browser *fetch* with `{ redirect: true, url }` and a
 * browser *navigation* with a 302, telling them apart by Sec-Fetch-Mode. The
 * proxy re-sends every request with Node's fetch, which rewrites that header
 * to "cors", so a person landing on /api/auth/oauth2/authorize from an agent
 * would see JSON. Restore the navigation answer: a real redirect, cookies kept.
 * A path stays a path, for the browser to resolve against the address it used:
 * a self-hosted server's `req.url` carries the address it listens on
 * (http://0.0.0.0:3000), not its own.
 */
async function asNavigation(req: Request, res: Response): Promise<Response> {
  if (req.method !== "GET" || !isNavigation(req) || res.status !== 200) return res;
  if (!res.headers.get("content-type")?.includes("application/json")) return res;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { redirect?: boolean; url?: unknown } | null;
  if (body?.redirect !== true || typeof body.url !== "string") return res;
  const path = body.url.startsWith("/") && !body.url.startsWith("//");
  const headers = new Headers({
    location: path ? body.url : new URL(body.url, req.url).toString(),
  });
  for (const cookie of res.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** An OAuth `resource` for the MCP with its query dropped, or null when it needs no change. */
function plainResource(resource: string | null): string | null {
  if (!resource) return null;
  try {
    const url = new URL(resource);
    if (!url.search || url.pathname.replace(/\/+$/, "") !== "/mcp") return null;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * An MCP client may send the server URL it was given as the OAuth
 * `resource`, `?library=` and all (the library picks one of the person's
 * libraries, src/app/mcp/route.ts). A resource identifier has no query (RFC
 * 9728), and Better Auth allows one audience, this site's /mcp: so the query
 * is dropped before Better Auth reads the request. The library travels on
 * the MCP URL itself, never in the token.
 */
async function withPlainResource(req: Request): Promise<Request> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const plain = plainResource(url.searchParams.get("resource"));
    if (!plain) return req;
    url.searchParams.set("resource", plain);
    return new Request(url, { method: "GET", headers: req.headers });
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    return req;
  }
  const form = new URLSearchParams(await req.clone().text());
  const plain = plainResource(form.get("resource"));
  if (!plain) return req;
  form.set("resource", plain);
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return new Request(url, { method: req.method, headers, body: form.toString() });
}

/** The /api/auth/* proxy to Better Auth on the Convex deployment. */
export const handler = helpers
  ? {
      GET: async (req: Request) => {
        const plain = await withPlainResource(req);
        return asNavigation(plain, await helpers.handler.GET(plain));
      },
      POST: async (req: Request) => helpers.handler.POST(await withPlainResource(req)),
    }
  : { GET: notConfigured, POST: notConfigured };
