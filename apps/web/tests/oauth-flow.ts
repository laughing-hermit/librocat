/**
 * The OAuth flow an agent runs against hosted librocat, minus the browser
 * window: discover the authorization server from /mcp's 401, register
 * (RFC 7591), authorize with PKCE, sign in on the login page as a fresh
 * password user, approve on /consent, and trade the code for tokens.
 * Shared by the OAuth and account-deletion e2e suites.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";
import { expect } from "vitest";

const b64url = (b: Buffer) => b.toString("base64url");
export const REDIRECT_URI = "http://127.0.0.1:33418/callback";

/**
 * A top-level browser navigation. Not fetch: Node's fetch always sends
 * `Sec-Fetch-Mode: cors`, and the authorize endpoint must answer a real
 * navigation with a redirect (src/lib/auth-server.ts).
 */
function navigate(url: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    http
      .get(
        url,
        { headers: { accept: "text/html,application/xhtml+xml", "sec-fetch-mode": "navigate" } },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null });
        },
      )
      .on("error", reject);
  });
}

/** A cookie jar for the "browser" half: the login page and /consent. */
function browser(origin: string) {
  const jar = new Map<string, string>();
  return async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      redirect: "manual",
      ...init,
      headers: {
        origin,
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(init.headers as Record<string, string>),
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ""] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
}

export interface OAuthSignIn {
  /** The protected resource metadata's `resource` (the MCP URL tokens are bound to). */
  resource: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  email: string;
  userId: string;
  tokens: { access_token: string; refresh_token: string };
  /** The authorization response's `iss` (RFC 9207), which hosts such as ChatGPT check. */
  callbackIss: string | null;
}

/**
 * A new person signs in through an agent's OAuth flow and approves it. The
 * CLI in `cliCwd` must admin the same deployment (LIBROCAT_E2E=1 on it, for
 * dev:createPasswordUser).
 */
export async function oauthSignIn(
  mcpUrl: string,
  cliCwd: string,
  label: string,
  opts: {
    resourceQuery?: string;
    redirectUri?: string;
    /** What the consent page does before approving, with the signed-in session's Convex token. */
    beforeConsent?: (session: { token: string; clientId: string; userId: string }) => Promise<void>;
  } = {},
) {
  const site = new URL(mcpUrl).origin;
  const redirectUri = opts.redirectUri ?? REDIRECT_URI;

  // Discovery, from the 401 the way an agent finds it.
  const probe = await fetch(mcpUrl, { method: "POST" });
  expect(probe.status).toBe(401);
  const prmUrl = /resource_metadata="([^"]+)"/.exec(
    probe.headers.get("www-authenticate") ?? "",
  )?.[1];
  const prm = await (await fetch(prmUrl as string)).json();
  const issuer = prm.authorization_servers[0] as string;
  const as = await (
    await fetch(
      new URL(`/.well-known/oauth-authorization-server${new URL(issuer).pathname}`, issuer),
    )
  ).json();

  // Registration.
  const client = await (
    await fetch(as.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: `librocat ${label} e2e`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    })
  ).json();

  // A person with an account.
  const email = `${label}-e2e-${Date.now()}@example.com`;
  const password = `fixture-${Date.now()}-pw`;
  const created = spawnSync(
    "node_modules/.bin/convex",
    ["run", "dev:createPasswordUser", JSON.stringify({ email, password })],
    { cwd: cliCwd, env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" }, encoding: "utf8" },
  );
  expect(created.status).toBe(0);
  const userId = JSON.parse(created.stdout) as string;

  // Authorize: a browser navigation lands on the login page.
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const go = browser(site);
  const authorize = await navigate(
    `${as.authorization_endpoint}?${new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "openid offline_access",
      state: "e2e-state",
      resource: `${prm.resource}${opts.resourceQuery ?? ""}`,
    })}`,
  );
  expect(authorize.status).toBe(302);
  // A path, never an absolute URL built from the server's own address (auth-server.ts).
  expect(authorize.location).toMatch(/^\/sign-in\?/);
  const login = new URL(authorize.location as string, site);
  expect(login.pathname).toBe("/sign-in");

  // Sign in on that page (the auth client sends the page's query along)...
  const signIn = await (
    await go(`${site}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, oauth_query: login.search.slice(1) }),
    })
  ).json();
  const consent = new URL(signIn.url, site);
  expect(consent.pathname).toBe("/consent");
  if (opts.beforeConsent) {
    const { token } = await (await go(`${site}/api/auth/convex/token`)).json();
    await opts.beforeConsent({ token, clientId: client.client_id, userId });
  }

  // ...and approve on /consent: back to the agent with a code.
  const approved = await (
    await go(`${site}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: consent.search.slice(1) }),
    })
  ).json();
  const callback = new URL(approved.url);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe("e2e-state");

  // Tokens: a JWT bound to the MCP resource, and a refresh token.
  const tokenRes = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") as string,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: `${prm.resource}${opts.resourceQuery ?? ""}`,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = await tokenRes.json();
  expect(tokens.refresh_token).toBeTruthy();
  return {
    resource: prm.resource,
    issuer,
    tokenEndpoint: as.token_endpoint,
    clientId: client.client_id,
    email,
    userId,
    tokens,
    callbackIss: callback.searchParams.get("iss"),
  } satisfies OAuthSignIn;
}

/** Trade a refresh token for a new access token (rotation). */
export function refresh(s: OAuthSignIn, refreshToken = s.tokens.refresh_token) {
  return fetch(s.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: s.clientId,
      resource: s.resource,
    }),
  });
}
