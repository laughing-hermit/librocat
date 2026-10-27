/**
 * The whole OAuth flow an agent runs against hosted librocat, minus the
 * browser window: discover the authorization server from /mcp's 401, register
 * (RFC 7591), authorize with PKCE, sign in on the login page, approve on
 * /consent, trade the code for tokens (tests/oauth-flow.ts), then call a tool
 * and refresh.
 *
 * Opt-in — a running stack (docs/cloud.md §Local development) and the CLI
 * pointed at its deployment (LIBROCAT_E2E=1 on it, for dev:createPasswordUser):
 *   LIBROCAT_MCP_URL=http://localhost:3000/mcp LIBROCAT_E2E_CLI_CWD=. pnpm test
 */

import { spawnSync } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { oauthSignIn, refresh } from "./oauth-flow";

const mcpUrl = process.env.LIBROCAT_MCP_URL;
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD;
const convexUrl = process.env.LIBROCAT_E2E_CONVEX_URL;
const run = mcpUrl && cliCwd ? test : test.skip;
const runPicked = mcpUrl && cliCwd && convexUrl ? test : test.skip;

run(
  "an agent signs in with OAuth, calls a tool, and refreshes its token",
  async () => {
    const s = await oauthSignIn(mcpUrl as string, cliCwd as string, "oauth");
    const claims = JSON.parse(
      Buffer.from(s.tokens.access_token.split(".")[1] as string, "base64url").toString(),
    );
    expect([claims.aud].flat()).toContain(s.resource);
    expect(claims.iss).toBe(s.issuer);

    // A tool call with it: the workspace was made at sign-up.
    const status = await fetch(mcpUrl as string, {
      method: "POST",
      headers: {
        authorization: `Bearer ${s.tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "status", arguments: {} },
      }),
    });
    expect(status.status).toBe(200);
    expect(await status.text()).toContain('\\"backend\\": \\"convex\\"');

    // Refresh (rotation).
    const refreshed = await refresh(s);
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).access_token).toBeTruthy();
  },
  60_000,
);

run(
  "ChatGPT's connector signs in and lists 16 tools, each with its behavior hints",
  async () => {
    // ChatGPT registers its own redirect, sends `resource` on authorize and
    // token, and checks the `iss` it gets back (RFC 9207).
    const s = await oauthSignIn(mcpUrl as string, cliCwd as string, "chatgpt", {
      redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
    });
    expect(s.callbackIss).toBe(s.issuer);
    const claims = JSON.parse(
      Buffer.from(s.tokens.access_token.split(".")[1] as string, "base64url").toString(),
    );
    expect([claims.aud].flat()).toContain(s.resource);

    const listed = await fetch(mcpUrl as string, {
      method: "POST",
      headers: {
        authorization: `Bearer ${s.tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(listed.status).toBe(200);
    const text = await listed.text();
    const body = text.trimStart().startsWith("{")
      ? text
      : (text.split("\n").find((l) => l.startsWith("data: ")) ?? "").slice(6);
    const tools = JSON.parse(body).result.tools as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];
    expect(tools).toHaveLength(16);
    for (const t of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
        expect(typeof t.annotations?.[hint], `${t.name} ${hint}`).toBe("boolean");
      }
    }
  },
  60_000,
);

run(
  "an agent that sends ?library= inside its OAuth resource still gets a token for /mcp",
  async () => {
    // Some clients send the whole server URL as the resource; the library is
    // not part of the resource, so the token is for /mcp itself.
    const s = await oauthSignIn(mcpUrl as string, cliCwd as string, "oauth-lib", {
      resourceQuery: "?library=any-library",
    });
    const claims = JSON.parse(
      Buffer.from(s.tokens.access_token.split(".")[1] as string, "base64url").toString(),
    );
    expect([claims.aud].flat()).toContain(s.resource);
  },
  60_000,
);

/** A tool's JSON result, through /mcp the way an agent calls it (`?library=` when given). */
// biome-ignore lint/suspicious/noExplicitAny: test assertions poke freely at parsed JSON
async function tool(bearer: string, name: string, args = {}, library?: string): Promise<any> {
  const endpoint = new URL(mcpUrl as string);
  if (library) endpoint.searchParams.set("library", library);
  const client = new Client({ name: "oauth-e2e", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  try {
    const res = await client.callTool({ name, arguments: args });
    return JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");
  } finally {
    await client.close();
  }
}

runPicked(
  "the library picked on /consent is the one the agent reaches, until it's disconnected",
  async () => {
    let session = new ConvexHttpClient(convexUrl as string);
    let picked = "";
    const s = await oauthSignIn(mcpUrl as string, cliCwd as string, "picked", {
      // The consent page, with two libraries: the person picks the second.
      beforeConsent: async ({ token, clientId, userId }) => {
        const made = spawnSync(
          "node_modules/.bin/convex",
          ["run", "dev:addLibrary", JSON.stringify({ userId, name: "E2E picked" })],
          {
            cwd: cliCwd as string,
            env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
            encoding: "utf8",
          },
        );
        expect(made.status, made.stderr).toBe(0);
        picked = JSON.parse(made.stdout) as string;
        session = new ConvexHttpClient(convexUrl as string);
        session.setAuth(token);
        await expect(
          session.mutation(api.agents.choose, { clientId, library: "not-a-library-000000" }),
        ).rejects.toThrow(/no library "not-a-library-000000"/);
        await session.mutation(api.agents.choose, { clientId, library: picked });
      },
    });
    const bearer = s.tokens.access_token;

    // The plain /mcp reaches the picked library: a write lands there.
    expect((await tool(bearer, "status")).library.slug).toBe(picked);
    const id = `e2e/${Date.now()}/picked`;
    await tool(bearer, "ingest", { type: "Note", id, title: "In the picked library" });
    expect((await tool(bearer, "get_concept", { id }, picked)).title).toBe("In the picked library");
    // `?library=` still names another, and wins.
    const status = await tool(bearer, "status");
    const first = (status.libraries as { slug: string }[]).find((l) => l.slug !== picked)?.slug;
    expect(first).toBeTruthy();
    expect((await tool(bearer, "status", {}, first)).library.slug).toBe(first);
    expect((await tool(bearer, "get_concept", { id }, first)).error).toMatch(/not found/);
    // Connect shows the library its calls last reached: that one, then the pick again.
    expect((await session.query(api.agents.list, {}))[0]?.library).toBe("My library");
    await tool(bearer, "status");

    // Only the person picks: the agent's own token can't move it.
    const agent = new ConvexHttpClient(convexUrl as string);
    agent.setAuth(bearer);
    await expect(
      agent.mutation(api.agents.choose, { clientId: s.clientId, library: first as string }),
    ).rejects.toThrow(/picked by its person/);
    expect((await session.query(api.agents.list, {}))[0]?.library).toBe("E2E picked");

    // Disconnecting forgets the pick: signing in again asks again.
    await session.mutation(api.agents.revoke, { clientId: s.clientId });
    expect((await agent.query(api.mcp.whoami, {}))?.slug).toBe(first);
  },
  60_000,
);
