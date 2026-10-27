/**
 * Account deletion (GDPR) end to end, on Better Auth: a person who signed in
 * through an agent's OAuth flow, with a Team library in use, deletes the
 * account, and nothing of them is left, in librocat's tables or in Better
 * Auth's (sessions, accounts, OAuth grants, emailed codes). A teammate keeps
 * their own identity, and the deleted person's tokens stop working.
 *
 * Opt-in — a running stack (docs/cloud.md §Local development) and the CLI
 * pointed at its deployment (LIBROCAT_E2E=1 on it):
 *   LIBROCAT_MCP_URL=http://localhost:3000/mcp LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210 \
 *   LIBROCAT_E2E_CLI_CWD=. pnpm test
 */

import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { oauthSignIn, refresh } from "./oauth-flow";

const mcpUrl = process.env.LIBROCAT_MCP_URL;
const convexUrl = process.env.LIBROCAT_E2E_CONVEX_URL;
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD;
const run = mcpUrl && convexUrl && cliCwd ? test : test.skip;

/** Call an internal dev.ts function through the CLI and parse what it returns. */
// biome-ignore lint/suspicious/noExplicitAny: fixture JSON from the CLI
function runDev(fn: string, args: Record<string, unknown>): any {
  const result = spawnSync("node_modules/.bin/convex", ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

run(
  "deleting an account leaves nothing of the person, and their teammate keeps theirs",
  async () => {
    // The owner signs in through an agent's OAuth flow: a session, a refresh
    // token, a consent, the library they picked for the agent, and the row
    // of the code emailed at sign-up.
    // The person's own dashboard token, from the sign-in: only they manage
    // libraries, the team, and the account (identity.ts personId).
    const person = new ConvexHttpClient(convexUrl as string);
    const s = await oauthSignIn(mcpUrl as string, cliCwd as string, "delete", {
      beforeConsent: async ({ token, clientId }) => {
        person.setAuth(token);
        const session = new ConvexHttpClient(convexUrl as string);
        session.setAuth(token);
        const [mine] = await session.query(api.workspaces.libraries, {});
        await session.mutation(api.agents.choose, { clientId, library: mine?.slug as string });
      },
    });
    const owner = new ConvexHttpClient(convexUrl as string);
    owner.setAuth(s.tokens.access_token);
    const wsId: Id<"workspaces"> = await owner.mutation(api.workspaces.ensure, {});
    runDev("dev:setPlan", { workspaceId: wsId, plan: "team" });
    // A second library they own, with a concept in it; then back to the first.
    const second = await person.mutation(api.workspaces.createLibrary, { name: "Second" });
    await owner.mutation(api.mcp.ingest, {
      library: second.slug,
      type: "Note",
      id: "elsewhere/n",
      title: "In the second library",
    });
    await person.mutation(api.workspaces.switchLibrary, { id: wsId });

    // A library in use: linked concepts and revisions, a question on the
    // reference desk, a proposal on the shelf, a deleted concept's retired id,
    // and an invite.
    await owner.mutation(api.mcp.ingest, {
      type: "Note",
      id: "notes/a",
      title: "Same title",
      body: "See [the other](/notes/b.md).",
    });
    await owner.mutation(api.mcp.ingest, { type: "Note", id: "notes/b", title: "Same title" });
    await owner.mutation(api.mcp.update, { id: "notes/b", description: "The second one." });
    await owner.mutation(api.mcp.ingest, { type: "Note", id: "notes/c", title: "Deleted" });
    await owner.mutation(api.mcp.remove, { id: "notes/c" });
    await owner.action(api.mcp.search, { query: "same title" });
    await owner.mutation(api.mcp.addSource, {
      title: "Kept notes",
      text: "The text of a document an agent read.",
      location: "notes/kept.md",
    });
    await owner.mutation(api.libro.runNow, {});
    const code = await person.mutation(api.team.createInvite, {});

    // A teammate joins.
    const mateEmail = `delete-mate-e2e-${Date.now()}@example.com`;
    const m = runDev("dev:issueTestAccessToken", { email: mateEmail });
    const mate = new ConvexHttpClient(convexUrl as string);
    mate.setAuth(m.token);
    const matePerson = new ConvexHttpClient(convexUrl as string);
    matePerson.setAuth(
      runDev("dev:issueTestAccessToken", { email: mateEmail, person: true }).token,
    );
    expect(await matePerson.mutation(api.team.accept, { code })).toBe(wsId);

    const rows = (): Record<string, number> =>
      runDev("dev:identityRows", { userId: s.userId, email: s.email, workspaceId: wsId });
    const before = rows();
    for (const table of [
      "user",
      "session",
      "account",
      "oauthRefreshToken",
      "oauthConsent",
      "verification",
      "memberships",
      "ownedLibraries",
      "currentLibrary",
      "agentLibraries",
      "workspace",
      "members",
      "invites",
      "concepts",
      "bodies",
      "links",
      "revisions",
      "proposals",
      "questions",
      "tombstones",
      "sources",
      "sourceParts",
    ]) {
      expect(before[table], table).toBeGreaterThan(0);
    }

    // Their agent can't delete the account; they can.
    await expect(owner.mutation(api.account.deleteAccount, {})).rejects.toThrow(
      /Only you can do this/,
    );
    await person.mutation(api.account.deleteAccount, {});
    // The teardown runs in scheduled slices.
    let after = rows();
    for (let i = 0; i < 30 && Object.values(after).some((n) => n > 0); i++) {
      await new Promise((r) => setTimeout(r, 500));
      after = rows();
    }
    expect(after).toEqual(Object.fromEntries(Object.keys(before).map((t) => [t, 0])));

    // The teammate is still a person, with their own grant, but the library
    // they joined is gone with its owner.
    const mateRows = runDev("dev:identityRows", {
      userId: m.userId,
      email: mateEmail,
      workspaceId: m.workspaceId,
    });
    expect(mateRows.user).toBe(1);
    expect(mateRows.oauthConsent).toBe(1);
    expect(await mate.query(api.mcp.whoami, {})).toBeNull();

    // The deleted person's tokens are dead: the agent's grant went with them,
    // and the refresh token no longer refreshes.
    await expect(owner.mutation(api.mcp.status, {})).rejects.toThrow(/disconnected/);
    expect((await refresh(s)).ok).toBe(false);
  },
  90_000,
);

run("the daily cleanup deletes Better Auth's expired rows, and only those", async () => {
  const email = `e2e-cleanup-${Date.now()}@example.com`;
  const codes = () => runDev("dev:codesOf", { email });
  runDev("dev:addCodes", { email });
  expect(codes()).toBe(2);
  // The day's first run: it may go on in later runs while a batch was full.
  expect(runDev("authCleanup:prune", {})).toMatchObject({ deleted: expect.any(Number) });
  expect(codes()).toBe(1);
});
