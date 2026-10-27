/**
 * The MCP endpoint of librocat: https://librocat.com/mcp on librocat Cloud,
 * and the same route on a self-hosted librocat.
 *
 * mcp-handler (Vercel) serves the official MCP SDK v2 over stateless
 * Streamable HTTP; the tools are the shared table in
 * `@librocat/server/tools`, here over Convex.
 *
 * Auth is OAuth 2.1, the way the Stripe, Vercel, and Resend MCP servers work:
 * an agent without a token gets a 401 whose WWW-Authenticate header points at
 * /.well-known/oauth-protected-resource; from there it finds the
 * authorization server (Better Auth, /api/auth), registers itself, opens the
 * browser for the user to sign in and approve, and comes back with an access
 * token bound to this resource. That token is verified here and again by
 * Convex, which resolves the workspace from the user it names.
 */

import { registerTools } from "@librocat/server/tools";
import { PACKAGE_VERSION } from "@librocat/server/version";
import type { AuthInfo, Implementation } from "@modelcontextprotocol/server";
import { verifyAccessToken } from "better-auth/oauth2";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { convexBackend } from "@/lib/mcp-backend";
import { issuerOf, jwksUrl, resourceOf } from "@/lib/oauth";
import { selfHost } from "@/lib/self-host";

// This deployment's address when it names one, else librocat Cloud's.
const SITE = process.env.NEXT_PUBLIC_LIBROCAT_MCP_URL
  ? new URL(process.env.NEXT_PUBLIC_LIBROCAT_MCP_URL).origin
  : "https://librocat.com";

// What only the person does, on the dashboard: an agent gives the link (#154).
const PERSONS_OWN = [
  `team and roles ${SITE}/dashboard/team`,
  ...(selfHost ? [] : [`billing ${SITE}/dashboard/billing`]),
  `deleting the library ${SITE}/dashboard/library`,
  `their account ${SITE}/dashboard/account`,
  `disconnecting agents ${SITE}/dashboard/connect?tab=agents`,
].join(", ");

// The workflow the tool descriptions can't carry, read once per session.
// The craft (what to write, and how) is the skills'.
const INSTRUCTIONS =
  "librocat is this library's knowledge base. Search it before you write. If `ingest` " +
  "returns `possible_duplicates` about the same subject, update that concept or propose a " +
  "merge. Put a kept source's `cite` in the `sources` of each concept written from it. " +
  "After a commit, call `files_changed` with the changed paths. Work `review_shelf` with " +
  "the person, and `decide` only on their yes. If `status` gives your `library.role` as " +
  "`reader`, only read: tell the person their admins can make them an Editor. These are " +
  `the person's own, on the dashboard, so give them the link: ${PERSONS_OWN}.`;

// The server's name card in hosts that show one (ChatGPT, Claude). mcp-handler
// types only the name and version, but hands the whole card to the SDK.
const SERVER_INFO: Implementation = {
  name: "librocat",
  title: "librocat",
  version: PACKAGE_VERSION,
  websiteUrl: SITE,
  icons: [{ src: `${SITE}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
};

const handler = createMcpHandler(
  (server) => {
    registerTools(server, (ctx) => {
      const token = ctx.http?.authInfo?.token;
      if (!token) throw new Error("not signed in");
      // `?library=<slug>` on the MCP URL picks one of the user's libraries;
      // without it, their default one.
      const library = ctx.http?.authInfo?.extra?.library;
      return convexBackend(token, typeof library === "string" ? library : undefined);
    });
  },
  {
    serverInfo: SERVER_INFO,
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  },
);

const verifyToken = async (req: Request, token?: string): Promise<AuthInfo | undefined> => {
  const jwks = jwksUrl();
  if (!token || !jwks) return undefined;
  try {
    const payload = await verifyAccessToken(token, {
      verifyOptions: { issuer: issuerOf(req), audience: resourceOf(req) },
      jwksUrl: jwks,
    });
    const library = new URL(req.url).searchParams.get("library")?.trim();
    return {
      token,
      clientId: typeof payload.azp === "string" ? payload.azp : "unknown",
      scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
      expiresAt: payload.exp,
      extra: { userId: payload.sub, ...(library ? { library } : {}) },
    };
  } catch {
    return undefined;
  }
};

const authed = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
});

export { authed as GET, authed as POST, authed as DELETE };
