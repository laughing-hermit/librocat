/**
 * Identity for librocat: Better Auth, running inside this Convex deployment
 * (@convex-dev/better-auth, installed locally under convex/betterAuth).
 *
 * One identity serves both doors:
 * - The dashboard: email + password, with an emailed code to verify the
 *   address and to reset the password (Resend, convex/email.ts).
 * - The remote MCP: Better Auth is also the OAuth 2.1 authorization server
 *   for https://librocat.com/mcp. An agent (Claude Code, Cursor, Codex, ...)
 *   registers itself (dynamic client registration), the user signs in and
 *   approves on /consent, and the agent receives a short-lived JWT access
 *   token for the MCP resource plus a refresh token. No API token to copy.
 *
 * HTTP: Better Auth answers under /api/auth/* on the Convex site
 * (convex/http.ts); the Next.js app proxies the same paths on librocat.com.
 * Env on the deployment: SITE_URL (the public origin), BETTER_AUTH_SECRET,
 * AUTH_RESEND_KEY.
 */

import { oauthProvider } from "@better-auth/oauth-provider";
import { type AuthFunctions, createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError } from "better-auth/api";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { emailOTP, type Jwk, type JwtOptions, jwt } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { forgetAgent } from "./agents";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { sendAuthCode } from "./email";
import { ensureWorkspace } from "./membership";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

/** The protected resource MCP access tokens are bound to (their `aud`). */
export const mcpResource = () => `${siteUrl}/mcp`;

/** The OAuth issuer: the `iss` of an MCP access token. */
export const oauthIssuer = () => `${siteUrl}/api/auth`;

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
  local: { schema: authSchema },
  authFunctions,
  triggers: {
    // Every user gets a workspace the moment the account exists, so an agent
    // approved right after sign-up finds its library ready.
    user: {
      onCreate: async (ctx, user) => void (await ensureWorkspace(ctx, user._id, user.name)),
    },
    // Connect's list of agents (convex/agents.ts): a row once an agent's
    // grant is saved, gone with the grant.
    oauthConsent: {
      onCreate: async (ctx, consent) => {
        if (!consent.userId) return;
        await ctx.scheduler.runAfter(0, internal.agents.connected, {
          userId: consent.userId,
          clientId: consent.clientId,
        });
      },
      onDelete: async (ctx, consent) => {
        if (consent.userId) await forgetAgent(ctx, consent.userId, consent.clientId);
      },
    },
  },
});

// The trigger runners the component calls into (authFunctions above).
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

/**
 * Better Auth merges plugin endpoints by name, a later plugin winning. The
 * Convex plugin, the JWT plugin, and the OAuth provider share names
 * (getJwks, getToken, getOpenIdConfig) at different paths, and losing the
 * Convex plugin's /convex/token would sign the dashboard out. Renaming the
 * others keeps every path served; only the in-process `auth.api` names move.
 */
function renameEndpoints<P extends { endpoints?: Record<string, unknown> }>(
  plugin: P,
  names: Record<string, string>,
): P {
  const endpoints = Object.fromEntries(
    Object.entries(plugin.endpoints ?? {}).map(([name, endpoint]) => [
      names[name] ?? name,
      endpoint,
    ]),
  );
  return { ...plugin, endpoints };
}

/**
 * The signing keys, with their dates as Dates. The Convex adapter reads
 * Better Auth dates back as numbers, and the JWT plugin picks the newest key
 * with `createdAt.getTime()`: harmless with one key, a TypeError on every
 * signature once there are two (two first sign-ins at the same moment each
 * create one), and then no agent can get a token. The Convex plugin carries
 * the same workaround for its own keys (@convex-dev/better-auth
 * plugins/convex, "remove when date parsing for jwks adapter is fixed
 * upstream").
 */
const jwksWithDates: NonNullable<JwtOptions["adapter"]> = {
  getJwks: async (ctx) => {
    const keys = await ctx.context.adapter.findMany<Jwk>({ model: "jwks" });
    return keys.map((key) => ({
      ...key,
      createdAt: new Date(key.createdAt),
      ...(key.expiresAt ? { expiresAt: new Date(key.expiresAt) } : {}),
    }));
  },
};

/**
 * BETTER_AUTH_SECRET, required to serve a request. Without it Better Auth
 * would fall back to its public default secret and encrypt the signing keys
 * with it, keys that stop decrypting once the real secret is set. Static
 * instances (route registration, schema generation) run with no request and
 * no secret; anything that serves one fails closed instead.
 */
function authSecret(ctx: GenericCtx<DataModel>): string | undefined {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret || !("runQuery" in ctx)) return secret;
  throw new Error("BETTER_AUTH_SECRET is not set on this Convex deployment");
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: siteUrl,
    secret: authSecret(ctx),
    database: authComponent.adapter(ctx),
    // The JWT plugin's own session-to-JWT endpoint: not used (the Convex
    // plugin mints the dashboard's token), and easy to confuse with the
    // OAuth token endpoint, /oauth2/token.
    disabledPaths: ["/token"],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
    },
    // An address longer than RFC 5321's 254 characters can never receive
    // its code, so the account would wait forever.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.email.length > 254) {
              throw new APIError("BAD_REQUEST", { message: "That email address is too long." });
            }
            return { data: user };
          },
        },
      },
    },
    // A sign-in with an unverified address sends a fresh code instead of a
    // dead end; verifying it signs the user in.
    emailVerification: { autoSignInAfterVerification: true, sendOnSignIn: true },
    plugins: [
      // Required for Convex: mints the dashboard's session JWT.
      convex({ authConfig }),
      // Signs MCP access tokens. RS256, the one algorithm both Convex's
      // customJwt check and the Convex plugin accept, and the same key table.
      renameEndpoints(
        jwt({
          jwt: { issuer: oauthIssuer() },
          jwks: { keyPairConfig: { alg: "RS256" } },
          adapter: jwksWithDates,
        }),
        { getJwks: "oauthJwks", getToken: "oauthSessionToken" },
      ),
      emailOTP({
        otpLength: 8,
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: ({ email, otp, type }) => sendAuthCode(email, otp, type),
      }),
      renameEndpoints(
        oauthProvider({
          loginPage: "/sign-in",
          consentPage: "/consent",
          // Access tokens requested for the MCP resource are JWTs with this `aud`.
          // Keep it ONE audience: oauth-provider 1.6.x does not bind the RFC
          // 8707 resource to the grant (GHSA-p2fr-6hmx-4528, fixed in 1.7,
          // which @convex-dev/better-auth does not support yet). With a
          // single allowed audience no token can be minted for another.
          validAudiences: [mcpResource()],
          // MCP clients register themselves (RFC 7591). Public clients, no
          // secret: the security comes from PKCE and the user's consent.
          allowDynamicClientRegistration: true,
          allowUnauthenticatedClientRegistration: true,
          // An agent acting for a signed-in user: no machine-to-machine grant.
          grantTypes: ["authorization_code", "refresh_token"],
          scopes: ["openid", "profile", "email", "offline_access"],
          // The discovery documents are served at the site root by Next.js
          // (src/app/.well-known), proxying the ones Better Auth serves here.
          silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
        }),
        { getOpenIdConfig: "oauthOpenIdConfig" },
      ),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));
