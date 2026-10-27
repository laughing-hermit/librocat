import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

// Two kinds of token authenticate a Convex call, both issued by Better Auth
// (convex/auth.ts) and both carrying the user id as `sub`:
//
// 1. The dashboard's session token: the Convex plugin's JWT (issuer
//    CONVEX_SITE_URL, audience "convex").
// 2. An MCP access token: what an agent got from the OAuth flow (issuer
//    SITE_URL/api/auth, audience SITE_URL/mcp). The /mcp route on Vercel
//    verifies it, then forwards it unchanged, so Convex checks it again here
//    and resolves the workspace from the identity itself (convex/mcp.ts).
export default {
  providers: [
    getAuthConfigProvider(),
    {
      type: "customJwt",
      issuer: `${process.env.SITE_URL}/api/auth`,
      jwks: `${process.env.CONVEX_SITE_URL}/api/auth/jwks`,
      algorithm: "RS256",
      applicationID: `${process.env.SITE_URL}/mcp`,
    },
  ],
} satisfies AuthConfig;
