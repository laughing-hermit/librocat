/**
 * Hosted librocat: the dashboard's data functions against a running Convex
 * deployment, as a fixture user whose OAuth access token comes from
 * dev:issueTestAccessToken (the deployment needs LIBROCAT_E2E=1).
 *
 * Opt-in — it needs `pnpm exec convex dev` running (docs/cloud.md §Local development):
 *   LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210 pnpm test
 */

import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";

const url = process.env.LIBROCAT_E2E_CONVEX_URL;
const run = url ? test : test.skip;
// The `convex` CLI (runDev below) must admin the *same* deployment `url`
// points to: normally that's already true (this directory's own
// .env.local), but if you are pointed at a scratch anonymous local backend
// instead (its own directory, its own .env.local — see this file's header),
// set LIBROCAT_E2E_CLI_CWD to that directory.
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD || new URL("..", import.meta.url).pathname;

// Invoked directly (not `pnpm exec`) so LIBROCAT_E2E_CLI_CWD can point at a
// scratch directory that is not a pnpm workspace member.
const CONVEX_BIN = "node_modules/.bin/convex";

/** Call an internal dev.ts function via the CLI, against the local deployment. */
function runDev(fn: string, args: Record<string, unknown>): void {
  const result = spawnSync(CONVEX_BIN, ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  expect(result.status).toBe(0);
}

/** Call an internal dev.ts function via the CLI and parse what it returns. */
// biome-ignore lint/suspicious/noExplicitAny: fixture JSON from the CLI
function runDevJson(fn: string, args: Record<string, unknown>): any {
  const result = spawnSync(CONVEX_BIN, ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** A fresh fixture user, signed in the way an approved agent is. */
/** A concept's history, from its dashboard page (convex/dashboard.ts). */
async function historyOf(client: ConvexHttpClient, args: { id: string }) {
  const page = await client.mutation(api.dashboard.concept, args);
  if (!page.history) throw new Error(`no concept ${args.id}`);
  return page.history;
}

/** Each fixture's own dashboard token, for what only a person does (identity.ts personId). */
const persons = new WeakMap<ConvexHttpClient, ConvexHttpClient>();

/**
 * A fresh fixture user, signed in the way an approved agent is; `person`
 * gives the same user's dashboard token, which an agent's can't stand in for.
 */
function signIn(client: ConvexHttpClient, label: string) {
  const email = `e2e-${label}-${Date.now()}@example.com`;
  const fixture = runDevJson("dev:issueTestAccessToken", { email }) as {
    token: string;
    userId: string;
  };
  client.setAuth(fixture.token);
  const own = new ConvexHttpClient(url as string);
  own.setAuth(runDevJson("dev:issueTestAccessToken", { email, person: true }).token);
  persons.set(client, own);
  return { ...fixture, email };
}

/** The person behind a signed-in fixture, on the dashboard. */
function person(client: ConvexHttpClient): ConvexHttpClient {
  const own = persons.get(client);
  if (!own) throw new Error("not a signIn fixture");
  return own;
}

run(
  "sign-up, workspace creation, credits, and the pay-as-you-go rule",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { userId } = signIn(client, "dash");

    const wsId = await client.mutation(api.workspaces.ensure, {});
    expect(wsId).toBeTruthy();
    const me = await client.query(api.workspaces.me, {});
    expect(me?.workspace?.plan).toBe("free");
    // The free hosted plan: 1,000 concepts, cataloged by Jev.
    expect(me?.workspace?.usage.maxConcepts).toBe(1000);
    expect(me?.workspace?.indexCredits.included).toBe(200);
    // The free plan stores concepts.
    const free = await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "notes/free",
      title: "On the free plan",
    });
    expect(free.id).toBe("notes/free");
    await client.mutation(api.mcp.remove, { id: "notes/free" });
    // Free gets the review shelf too (here, without Jev: the mechanical review).
    for (const id of ["notes/free-double", "archive/free-double"]) {
      await client.mutation(api.mcp.ingest, { type: "Note", id, title: "Free double" });
    }
    expect(await client.mutation(api.libro.runNow, {})).toEqual({ proposals: 1 });
    // The weekly pass skips a free library nobody wrote to since its last review.
    expect(runDevJson("libro:reviewOne", { workspaceId: wsId })).toEqual({
      proposals: 0,
      skipped: true,
    });
    const freeShelf = await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf);
    expect(freeShelf.map((p) => [p.kind, p.subject])).toEqual([["supersede", "notes/free-double"]]);
    await client.mutation(api.libro.decide, { id: freeShelf[0]?.id as never, decision: "dismiss" });
    for (const id of ["notes/free-double", "archive/free-double"]) {
      await client.mutation(api.mcp.remove, { id });
    }
    runDev("dev:clearLibroCooldown", { workspaceId: wsId });
    // Pay-as-you-go needs a paid plan.
    await expect(
      person(client).mutation(api.workspaces.setPayAsYouGo, { enabled: true }),
    ).rejects.toThrow(/paid plan/);
    // Put the workspace on a plan the way the Stripe webhook would (internal
    // mutation, so through the CLI against the local deployment).
    runDev("dev:setPlan", { workspaceId: wsId, plan: "individual" });

    const status = await client.mutation(api.dashboard.overview, {}).then((o) => o.status);
    expect(status.backend).toBe("convex");
    expect(status.index_credits?.period).toMatch(/^\d{4}-\d{2}$/);
    expect((await client.mutation(api.concepts.exportPage, { cursor: null })).concepts).toEqual([]);

    // Write through the MCP functions as the approved agent, then the
    // control plane sees it: finding aids for the export, the weeding report.
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "notes/hello",
      title: "Hello",
      description: "First note.",
      body: "hi",
    });
    // Libro, the library cat: plant a duplicate title and a plural tag, run the
    // review, approve both, and see the changes land as revisions by "libro".
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "archive/hello",
      title: "Hello",
      description: "Same title on another shelf.",
      tags: ["notes"],
      body: "dup",
    });
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "notes/tags",
      title: "Tag spelling",
      description: "Carries the plural tag.",
      tags: ["note"],
      body: "x",
    });
    const run = await client.mutation(api.libro.runNow, {});
    expect(run.proposals).toBeGreaterThanOrEqual(2);
    const shelf = await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf);
    const sup = shelf.find((p) => p.kind === "supersede");
    const syn = shelf.find((p) => p.kind === "synonym");
    expect(sup?.subject).toBe("notes/hello");
    expect(sup?.target).toBe("archive/hello");
    expect(syn).toBeTruthy();
    await client.mutation(api.libro.decide, { id: sup?.id as never, decision: "approve" });
    await client.mutation(api.libro.decide, { id: syn?.id as never, decision: "dismiss" });
    expect((await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf)).length).toBe(0);
    const retired = await client.mutation(api.mcp.get, { id: "notes/hello" });
    expect(retired?.status).toBe("deprecated");
    expect(retired?.superseded_by).toBe("archive/hello");
    // One revision per approval, attributed to Libro (not a phantom agent write).
    const hist = await historyOf(client, { id: "notes/hello" });
    expect(hist.revisions.map((r) => r.by)).toEqual(["libro", "agent"]);
    // Running again does not re-propose what was decided — clear the
    // just-set cooldown first (convex/libro.ts RUN_COOLDOWN_MS) so this
    // second call exercises that logic instead of the cooldown.
    runDev("dev:clearLibroCooldown", { workspaceId: wsId });
    expect((await client.mutation(api.libro.runNow, {})).proposals).toBe(0);

    // Libro keeps the library current: a concept past its review date goes
    // on the shelf. "Still true" records the person's check (OKF verified)
    // and moves the date a cycle ahead; "Retire" deprecates it.
    for (const id of ["plans/launch", "plans/pricing"]) {
      await client.mutation(api.mcp.ingest, {
        type: "Plan",
        id,
        title: id,
        description: "Time-bound.",
        tags: ["plan"],
        body: "Until spring.",
        stale_after: "2020-01-01",
      });
    }
    runDev("dev:clearLibroCooldown", { workspaceId: wsId });
    await client.mutation(api.libro.runNow, {});
    const due = (await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf)).filter(
      (p) => p.kind === "stale",
    );
    expect(due.map((p) => p.subject).sort()).toEqual(["plans/launch", "plans/pricing"]);
    const byId = Object.fromEntries(due.map((p) => [p.subject, p.id]));
    expect(
      (
        await client.mutation(api.libro.decide, {
          id: byId["plans/launch"] as never,
          decision: "verify",
        })
      ).status,
    ).toBe("verified");
    await client.mutation(api.libro.decide, {
      id: byId["plans/pricing"] as never,
      decision: "approve",
    });
    const checked = await client.mutation(api.mcp.get, { id: "plans/launch" });
    const fm = checked?.frontmatter as { verified?: { by: string }[]; stale_after?: string };
    expect(fm.verified?.[0]?.by).toMatch(/^human:/);
    expect(Date.parse(String(fm.stale_after))).toBeGreaterThan(Date.now());
    expect(checked?.stale).toBe(false);
    expect((await client.mutation(api.mcp.get, { id: "plans/pricing" }))?.status).toBe(
      "deprecated",
    );
    // Verified is not re-proposed until its new date passes.
    runDev("dev:clearLibroCooldown", { workspaceId: wsId });
    await client.mutation(api.libro.runNow, {});
    expect(
      (await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf)).filter(
        (p) => p.kind === "stale",
      ),
    ).toEqual([]);
    for (const id of ["plans/launch", "plans/pricing"]) {
      await client.mutation(api.mcp.remove, { id });
    }

    const aids = await client.mutation(api.mcp.findingAid, {}).then((r) => r.aids);
    expect(aids.map((a) => a.dir)).toEqual(["", "archive", "notes"]);
    // The front page opens with the list of additions: all of these are new.
    expect(aids[0]?.markdown).toMatch(/## New in the last 7 days[\s\S]*\(\/notes\/hello\.md\)/);
    expect(aids[2]?.markdown).toContain("[Hello](/notes/hello.md)");
    const weed = await client.mutation(api.mcp.weedReport, {});
    expect(weed.no_tags).toEqual(["notes/hello"]);
    expect(weed.deprecated).toEqual(["notes/hello"]);

    // The export walks pages and carries bodies; delete-all empties the workspace.
    const page = await client.mutation(api.concepts.exportPage, { cursor: null });
    expect(page.cursor).toBeNull();
    expect(page.concepts.find((c) => c.cid === "notes/hello")?.body).toBe("hi");
    await person(client).mutation(api.concepts.deleteAll, {});
    expect((await client.mutation(api.dashboard.overview, {}).then((o) => o.status)).concepts).toBe(
      0,
    );
    expect((await client.query(api.workspaces.me, {}))?.workspace?.conceptCount).toBe(0);

    // Disconnecting the agent cuts it off on its next call, token or not.
    // Connect lists it: its app, its person, its library, and its use just now.
    const [agent, ...others] = await client.query(api.agents.list, {});
    expect(others).toEqual([]);
    expect(agent).toMatchObject({ app: "librocat", you: true, library: expect.any(String) });
    expect(agent?.usedAt).toBeGreaterThan(Date.now() - 60 * 60_000);
    // Its use is written at most hourly: another call leaves it as it was.
    await client.mutation(api.mcp.status, {});
    expect((await client.query(api.agents.list, {}))[0]?.usedAt).toBe(agent?.usedAt);
    // Its person disconnects it: an agent can't, nor do any of its person's own
    // dashboard changes (identity.ts personId).
    await expect(client.mutation(api.agents.revoke, { clientId: "librocat-e2e" })).rejects.toThrow(
      /Only you can do this/,
    );
    await expect(client.mutation(api.concepts.deleteAll, {})).rejects.toThrow(
      /Only you can do this/,
    );
    await expect(
      client.mutation(api.workspaces.createLibrary, { name: "By an agent" }),
    ).rejects.toThrow(/Only you can do this/);
    await expect(client.mutation(api.workspaces.setPayAsYouGo, { enabled: true })).rejects.toThrow(
      /Only you can do this/,
    );
    await expect(client.mutation(api.account.deleteAccount, {})).rejects.toThrow(
      /Only you can do this/,
    );
    await person(client).mutation(api.agents.revoke, { clientId: "librocat-e2e" });
    await expect(client.mutation(api.mcp.status, {})).rejects.toThrow(/disconnected/);
    expect(await client.query(api.agents.list, {})).toEqual([]);
    // Approving it again (what /consent records) lets it back in.
    runDev("dev:grantTestClient", { userId });
    expect((await client.mutation(api.mcp.status, {})).plan).toBe("individual");
  },
  60_000,
);

run(
  "Connect lists every agent in your libraries: yours first, then your teammates', last used first, by name",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const me = signIn(client, "agents");
    // The demo library: three teammates with their agents, and you as an admin.
    runDevJson("dev:seedDemo", { email: me.email });
    const agents = await client.query(api.agents.list, {});
    // Yours first (the ones you can disconnect), then your teammates'.
    const firstTeammate = agents.findIndex((a) => !a.you);
    expect(firstTeammate).toBeGreaterThan(0);
    expect(agents.slice(firstTeammate).every((a) => !a.you)).toBe(true);
    // Each newest first: by last use, never used last.
    for (const group of [agents.slice(0, firstTeammate), agents.slice(firstTeammate)]) {
      const used = group.map((a) => a.usedAt ?? 0);
      expect(used).toEqual([...used].sort((a, b) => b - a));
    }
    expect(agents).toContainEqual(
      expect.objectContaining({
        app: "ChatGPT",
        person: "Gabriella",
        you: false,
        library: "Acme engineering",
      }),
    );
    expect(agents.filter((a) => !a.you).map((a) => a.person)).toEqual(
      expect.arrayContaining(["Maya", "Gabriella", "Omar"]),
    );
    expect(agents.some((a) => a.usedAt === null)).toBe(true);
    // A teammate's agent is theirs to disconnect: revoking it from here changes nothing.
    const theirs = agents.find((a) => a.person === "Gabriella" && a.app === "ChatGPT");
    await person(client).mutation(api.agents.revoke, { clientId: theirs?.clientId as string });
    expect(await client.query(api.agents.list, {})).toContainEqual(
      expect.objectContaining({ app: "ChatGPT", person: "Gabriella" }),
    );
  },
  120_000,
);

run(
  "roles: a Reader and their agent read the library but change nothing; an admin sets roles",
  async () => {
    const owner = new ConvexHttpClient(url as string);
    const { userId: ownerId } = signIn(owner, "roles-owner");
    const wsId = await owner.mutation(api.workspaces.ensure, {});
    runDev("dev:setPlan", { workspaceId: wsId, plan: "team" });
    await owner.mutation(api.mcp.ingest, {
      type: "Note",
      id: "roles/hello",
      title: "Hello",
      body: "Read me.",
    });
    // An invite link for Readers: who joins with it reads.
    const code = await person(owner).mutation(api.team.createInvite, { role: "reader" });
    expect((await owner.query(api.team.overview, {})).inviteRole).toBe("reader");
    const reader = new ConvexHttpClient(url as string);
    const { userId: readerId } = signIn(reader, "roles-reader");
    expect(await person(reader).mutation(api.team.accept, { code })).toBe(wsId);

    // Their agent reads, and knows it only reads...
    expect((await reader.mutation(api.mcp.status, {})).library.role).toBe("reader");
    const hits = await reader.mutation(api.mcp.searchWords, { query: "hello" });
    expect(hits.map((h: { id: string }) => h.id)).toContain("roles/hello");
    expect((await reader.mutation(api.mcp.get, { id: "roles/hello" }))?.title).toBe("Hello");
    // ...and changes nothing, through any door its token opens.
    const readOnly = /can read this library but not change it/;
    await expect(
      reader.mutation(api.mcp.ingest, { type: "Note", id: "roles/mine", title: "Mine" }),
    ).rejects.toThrow(readOnly);
    await expect(
      reader.mutation(api.mcp.update, { id: "roles/hello", body: "Changed." }),
    ).rejects.toThrow(readOnly);
    await expect(reader.mutation(api.mcp.remove, { id: "roles/hello" })).rejects.toThrow(readOnly);
    await expect(
      reader.mutation(api.mcp.addSource, {
        title: "Notes",
        text: "Kept.",
        location: "https://example.com/notes",
      }),
    ).rejects.toThrow(readOnly);
    // A link isn't fetched, counted, or stored first.
    await expect(
      reader.action(api.fetching.addSourceFromUrl, { location: "https://example.com/" }),
    ).rejects.toThrow(readOnly);
    await expect(
      reader.mutation(api.sources.uploadUrl, { name: "a.txt", size: 10 }),
    ).rejects.toThrow(readOnly);
    await expect(person(reader).mutation(api.concepts.deleteAll, {})).rejects.toThrow(/admins/);
    expect((await owner.query(api.team.overview, {})).members).toContainEqual(
      expect.objectContaining({ userId: readerId, role: "reader" }),
    );

    // Only an admin changes a role: made an Editor, they write.
    await expect(
      person(reader).mutation(api.team.setRole, { userId: readerId, role: "member" }),
    ).rejects.toThrow(/admin/);
    await person(owner).mutation(api.team.setRole, { userId: readerId, role: "member" });
    expect((await reader.mutation(api.mcp.status, {})).library.role).toBe("editor");
    await reader.mutation(api.mcp.ingest, { type: "Note", id: "roles/mine", title: "Mine" });
    // An Editor still can't empty the library; the owner stays an admin, and
    // an admin doesn't change their own role.
    await expect(person(reader).mutation(api.concepts.deleteAll, {})).rejects.toThrow(/admins/);
    await expect(
      person(owner).mutation(api.team.setRole, { userId: ownerId, role: "reader" }),
    ).rejects.toThrow(/owner/);
  },
  60_000,
);

run("search matches a word's other forms, and a catalog match comes first", async () => {
  const client = new ConvexHttpClient(url as string);
  signIn(client, "stems");
  await client.mutation(api.workspaces.ensure, {});
  const shelf = `stems-${Date.now().toString(36)}`;
  // The title says "rotation"; the body of the other one mentions "rotating" in passing.
  await client.mutation(api.mcp.ingest, {
    type: "Runbook",
    id: `${shelf}/keys`,
    title: "Signing key rotation",
    description: "How the signing keys are replaced every quarter.",
    body: "Create the new key, deploy, then retire the old one.",
  });
  await client.mutation(api.mcp.ingest, {
    type: "Note",
    id: `${shelf}/standup`,
    title: "Standup notes",
    description: "What the team said on Monday.",
    body: "Someone asked about rotating the on-call schedule and the signing key.",
  });
  // Words only here (no model): "rotated" and "keys" find "rotation" and "key".
  const hits = await client.mutation(api.concepts.search, { query: "rotated signing keys", shelf });
  expect(hits.map((h) => h.id)).toEqual([`${shelf}/keys`, `${shelf}/standup`]);
});

run("an id is never reused by default: deleted and renamed ids are retired", async () => {
  const client = new ConvexHttpClient(url as string);
  signIn(client, "accession");
  await client.mutation(api.workspaces.ensure, {});
  await client.mutation(api.mcp.ingest, { type: "Note", title: "Gone" });
  expect(await client.mutation(api.mcp.remove, { id: "gone" })).toEqual({ deleted: "gone" });
  // Reading it says what became of it.
  await expect(client.mutation(api.mcp.get, { id: "gone" })).rejects.toThrow(
    /concept not found: gone \(deleted on \d{4}-\d{2}-\d{2} \("Gone"\)\)/,
  );
  // A derived id passes over it; an explicit one may take it, and says so.
  expect((await client.mutation(api.mcp.ingest, { type: "Note", title: "Gone" })).id).toBe(
    "gone-2",
  );
  const back = await client.mutation(api.mcp.ingest, { type: "Note", id: "gone", title: "Back" });
  expect((back as { reused?: string }).reused).toMatch(/^this id was deleted on /);
  expect((await client.mutation(api.mcp.get, { id: "gone" }))?.title).toBe("Back");
  // A rename leaves a pointer behind.
  await client.mutation(api.mcp.ingest, { type: "Note", id: "n/a", title: "A" });
  await client.mutation(api.mcp.update, { id: "n/a", new_id: "n/b" });
  await expect(client.mutation(api.mcp.update, { id: "n/a", body: "x" })).rejects.toThrow(
    /concept not found: n\/a \(renamed to n\/b on /,
  );
  // The export's update log lists both; emptying the library clears them.
  const retired = await client.mutation(api.concepts.tombstones, {});
  expect(retired.map((t) => [t.id, t.moved_to ?? null]).sort()).toEqual([
    ["gone", null],
    ["n/a", "n/b"],
  ]);
  await person(client).mutation(api.concepts.deleteAll, {});
  expect(await client.mutation(api.concepts.tombstones, {})).toEqual([]);
});

run(
  "several libraries: each has its own slug, agents keep the default, and only members reach one",
  async () => {
    const client = new ConvexHttpClient(url as string);
    signIn(client, "libs");
    const first = await client.mutation(api.workspaces.ensure, {});
    // One Free library each: the first takes a plan, so a second can be made.
    runDev("dev:setPlan", { workspaceId: first, plan: "individual" });
    // A second library; the dashboard switches to it.
    const acme = await person(client).mutation(api.workspaces.createLibrary, { name: "Acme docs" });
    expect(acme.slug).toMatch(/^acme-docs-[a-z0-9]{6}$/);
    const listed = await client.query(api.workspaces.libraries, {});
    expect(listed.map((l) => [l.name, l.current, l.default])).toEqual([
      ["My library", false, true],
      ["Acme docs", true, false],
    ]);

    // Agents: no library means the default; `library` names another.
    await client.mutation(api.mcp.ingest, { type: "Note", id: "n/default", title: "Default" });
    await client.mutation(api.mcp.ingest, {
      library: acme.slug,
      type: "Note",
      id: "n/acme",
      title: "Acme",
    });
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    expect(ids(await client.mutation(api.mcp.list, {}))).toEqual(["n/default"]);
    expect(ids(await client.mutation(api.mcp.list, { library: acme.slug }))).toEqual(["n/acme"]);
    // The dashboard shows the current library, and switching moves only it.
    expect(ids((await client.mutation(api.concepts.list, { cursor: null })).concepts)).toEqual([
      "n/acme",
    ]);
    await person(client).mutation(api.workspaces.switchLibrary, { id: first });
    expect(ids((await client.mutation(api.concepts.list, { cursor: null })).concepts)).toEqual([
      "n/default",
    ]);
    const status = await client.mutation(api.mcp.status, { library: acme.slug });
    expect(status.library).toEqual({ name: "Acme docs", slug: acme.slug, role: "admin" });
    expect(status.libraries.map((l) => l.slug)).toEqual([expect.any(String), acme.slug]);

    // Not a member, or no such library: refused, never a fallback.
    const stranger = new ConvexHttpClient(url as string);
    signIn(stranger, "libs-stranger");
    await expect(stranger.mutation(api.mcp.list, { library: acme.slug })).rejects.toThrow(
      /no library/,
    );
    await expect(client.mutation(api.mcp.list, { library: "nope-000000" })).rejects.toThrow(
      /no library/,
    );
    // One Free library is the most one person can own.
    await expect(
      person(client).mutation(api.workspaces.createLibrary, { name: "Third" }),
    ).rejects.toThrow(/a Free library, the most/);

    // Renaming keeps the slug; deleting ends access at once, rows in slices.
    await person(client).mutation(api.workspaces.switchLibrary, { id: acme.id });
    await person(client).mutation(api.workspaces.renameLibrary, { name: "Acme knowledge" });
    expect((await client.mutation(api.mcp.status, { library: acme.slug })).library.name).toBe(
      "Acme knowledge",
    );
    await person(client).mutation(api.workspaces.deleteLibrary, { id: acme.id });
    await expect(client.mutation(api.mcp.list, { library: acme.slug })).rejects.toThrow(
      /no library/,
    );
    expect((await client.query(api.workspaces.libraries, {})).map((l) => l.name)).toEqual([
      "My library",
    ]);
    expect(ids((await client.mutation(api.concepts.list, { cursor: null })).concepts)).toEqual([
      "n/default",
    ]);
    let gone = false;
    for (let i = 0; i < 30 && !gone; i++) {
      gone = runDevJson("dev:libraryGone", { workspaceId: acme.id }) === true;
      if (!gone) await new Promise((r) => setTimeout(r, 300));
    }
    expect(gone).toBe(true);

    // Deleting the last one leaves a new, empty library at once, not none
    // (the deleted one's row outlives the call, and must not count).
    await person(client).mutation(api.workspaces.deleteLibrary, { id: first });
    const left = await client.query(api.workspaces.libraries, {});
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(first);
    expect(ids((await client.mutation(api.concepts.list, { cursor: null })).concepts)).toEqual([]);
  },
  60_000,
);

run(
  "code links: a concept about changed code comes up for review, once, with the file and commit",
  async () => {
    const client = new ConvexHttpClient(url as string);
    signIn(client, "changed");
    await client.mutation(api.workspaces.ensure, {});
    for (const id of ["api/sessions", "web/sessions"]) {
      await client.mutation(api.mcp.ingest, {
        type: "Decision",
        id,
        title: `Sessions (${id})`,
        description: "How long a session lasts.",
        tags: ["auth"],
        body: "Thirty days, set in the auth module.",
        sources: ["src/auth/"],
      });
    }
    // The shelf scopes it to one project's concepts.
    const res = await client.mutation(api.mcp.changed, {
      paths: ["src/auth/login.ts", "README.md"],
      commit: "abc1234",
      shelf: "api",
    });
    expect(res.marked).toEqual([{ id: "api/sessions", sources: ["src/auth/"] }]);
    expect((await client.mutation(api.mcp.get, { id: "api/sessions" }))?.stale).toBe(true);
    expect((await client.mutation(api.mcp.get, { id: "web/sessions" }))?.stale).toBe(false);
    const onShelf = async () =>
      (await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf)).filter(
        (p) => p.kind === "stale",
      );
    expect((await onShelf()).map((p) => [p.subject, p.reason])).toEqual([
      ["api/sessions", "src/auth/ changed in abc1234. Still true? Verify it, or retire it."],
    ]);
    // Reported again: still one proposal. The revision names who reported it.
    await client.mutation(api.mcp.changed, { paths: ["src/auth/login.ts"], shelf: "api" });
    const stale = await onShelf();
    expect(stale).toHaveLength(1);
    const hist = await historyOf(client, { id: "api/sessions" });
    expect(hist.revisions[0]?.client).toBe("librocat e2e");
    // "Still true" moves the review date on.
    await client.mutation(api.libro.decide, { id: stale[0]?.id as never, decision: "verify" });
    expect((await client.mutation(api.mcp.get, { id: "api/sessions" }))?.stale).toBe(false);
  },
);

run("signing works with more than one key (two first sign-ins at once each make one)", async () => {
  const client = new ConvexHttpClient(url as string);
  signIn(client, "keys");
  expect(runDevJson("dev:addSigningKey", {})).toBeGreaterThanOrEqual(2);
  // The next token is signed with the newest key, and Convex still verifies it.
  signIn(client, "keys-again");
  expect(await client.query(api.mcp.whoami, {})).not.toBeNull();
});

run(
  "teams: an invite link lets a second person join, their writes carry their name, and they can be removed",
  async () => {
    const owner = new ConvexHttpClient(url as string);
    signIn(owner, "team-owner");
    const wsId = await owner.mutation(api.workspaces.ensure, {});
    // Only the Team plan has seats to share.
    await expect(person(owner).mutation(api.team.createInvite, {})).rejects.toThrow(/Team plan/);
    runDev("dev:setPlan", { workspaceId: wsId, plan: "team" });
    const code = await person(owner).mutation(api.team.createInvite, {});
    expect(code).toMatch(/^[0-9a-f]{36}$/);

    const mate = new ConvexHttpClient(url as string);
    const { userId: mateId, email: mateEmail } = signIn(mate, "team-mate");
    expect((await mate.query(api.team.invite, { code }))?.workspace).toBe("My library");
    // The mate's own (empty) library folds away when they join.
    expect(await person(mate).mutation(api.team.accept, { code })).toBe(wsId);
    expect((await mate.query(api.workspaces.me, {}))?.workspace?.id).toBe(wsId);

    const team = await owner.query(api.team.overview, {});
    expect(team.members.map((m) => m.role).sort()).toEqual(["admin", "editor"]);
    // A Team library with no subscription behind it (dev:setPlan) has the minimum seats.
    expect(team.seats).toBe(3);
    // Billing is the admin's: a member can't start a checkout or open the
    // Stripe portal, where the library's plan is cancelled.
    await expect(
      person(mate).action(api.stripe.createCheckoutSession, { plan: "team" }),
    ).rejects.toThrow(/only a library's admin/);
    await expect(person(mate).action(api.stripe.createPortalSession, {})).rejects.toThrow(
      /only a library's admin/,
    );

    // A write by the mate is attributed to the mate, through their agent.
    await mate.mutation(api.mcp.ingest, {
      type: "Note",
      id: "team/hello",
      title: "Hi",
      body: "Notes for the team.",
    });
    const hist = await historyOf(owner, { id: "team/hello" });
    expect(hist.revisions[0]?.client).toBe("librocat e2e");

    // Author entry (Cutter's object D): list and search by writer, a person
    // by email or "me", an agent by name.
    await owner.mutation(api.mcp.ingest, {
      type: "Note",
      id: "team/owner",
      title: "Mine",
      body: "More notes for the team.",
    });
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(ids(await owner.mutation(api.mcp.list, { author: mateEmail }))).toEqual(["team/hello"]);
    expect(ids(await mate.mutation(api.mcp.list, { author: "me" }))).toEqual(["team/hello"]);
    expect(ids(await owner.mutation(api.mcp.list, { author: "LIBROCAT E2E" }))).toEqual([
      "team/hello",
      "team/owner",
    ]);
    expect(await owner.mutation(api.mcp.list, { author: "stranger@example.com" })).toEqual([]);
    expect(
      ids(await owner.action(api.mcp.search, { query: "team", author: `human:${mateEmail}` })),
    ).toEqual(["team/hello"]);
    expect((await owner.mutation(api.mcp.get, { id: "team/hello" }))?.authors).toEqual([
      `human:${mateEmail}`,
      "librocat e2e",
    ]);

    // A teammate whose own library holds knowledge keeps it: their agents'
    // plain URL stays there, and the team's library is reached by its slug.
    const busy = new ConvexHttpClient(url as string);
    const { userId: busyId } = signIn(busy, "team-busy");
    await busy.mutation(api.mcp.ingest, { type: "Note", id: "mine/n", title: "Mine" });
    expect(await person(busy).mutation(api.team.accept, { code })).toBe(wsId);
    const theirs = await busy.query(api.workspaces.libraries, {});
    expect(theirs.map((l) => [l.current, l.default])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect((await busy.mutation(api.mcp.list, {})).map((c) => c.id)).toEqual(["mine/n"]);
    const teamSlug = theirs[1]?.slug as string;
    expect((await busy.mutation(api.mcp.list, { library: teamSlug })).map((c) => c.id)).toContain(
      "team/hello",
    );

    // Three people fill three seats: a fourth waits for the admin to buy
    // one (stripe:updateSeats, which records it the way setSeats does).
    const late = new ConvexHttpClient(url as string);
    const { userId: lateId } = signIn(late, "team-late");
    await expect(person(late).mutation(api.team.accept, { code })).rejects.toThrow(/no free seat/);
    runDev("billing:setSeats", { workspaceId: wsId, seats: 4 });
    expect(await person(late).mutation(api.team.accept, { code })).toBe(wsId);
    expect((await owner.query(api.team.overview, {})).seats).toBe(4);
    await person(owner).mutation(api.team.removeMember, { userId: lateId });
    await person(owner).mutation(api.team.removeMember, { userId: busyId });

    // A new link retires the old one; removing the mate takes them off the workspace.
    const fresh = await person(owner).mutation(api.team.createInvite, {});
    expect(await mate.query(api.team.invite, { code })).toBeNull();
    expect(fresh).not.toBe(code);
    await person(owner).mutation(api.team.removeMember, { userId: mateId });
    // Removed from their only library, they get a new one of their own at once.
    const after = await mate.query(api.mcp.whoami, {});
    expect(after?.workspaceId).not.toBe(wsId);
    expect(after?.name).toBe("My library");
  },
  60_000,
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

run("the dashboard attaches a file: an upload URL, the bytes, then the source", async () => {
  const client = new ConvexHttpClient(url as string);
  signIn(client, "attach");
  await client.mutation(api.workspaces.ensure, {});
  const writesLeft = async () => (await client.mutation(api.mcp.status, {})).monthly?.writes.left;
  const before = await writesLeft();
  const bytes = Buffer.from("Notes on the deploy runbook: push to main, then watch CI.\n", "utf8");
  const up = await client.mutation(api.sources.uploadUrl, {
    name: "notes.txt",
    type: "text/plain",
    size: bytes.length,
  });
  if ("error" in up) throw new Error(up.error);
  const res = await fetch(up.upload_url, {
    method: "POST",
    headers: { "Content-Type": up.content_type },
    body: new Uint8Array(bytes),
  });
  const { storageId } = (await res.json()) as { storageId: string };
  const src = await client.mutation(api.sources.attach, { storageId, name: "notes.txt" });
  expect(src).toMatchObject({
    kind: "txt",
    status: "processing",
    file: { name: "notes.txt", mime: "text/plain", bytes: bytes.length },
  });
  let listed: { id: string; status?: string } | undefined;
  for (let i = 0; i < 40 && listed?.status !== "ready"; i++) {
    listed = (await client.mutation(api.sources.list, {})).sources.find((s) => s.id === src.id);
    if (listed?.status !== "ready") await sleep(250);
  }
  // Read, and ready: a file spends no index credits, so nothing waits for them.
  expect(listed).toMatchObject({ status: "ready" });
  expect(listed).not.toHaveProperty("waiting");
  const read = await client.mutation(api.sources.read, { id: src.id });
  expect(read.text).toContain("deploy runbook");
  expect(read.download_url).toMatch(/^https?:\/\/.*\/files\//);
  // A concept drawn from it: the source's page names it with its description, and
  // the concept's page links the file to download again.
  expect(read.cited_concepts).toEqual([]);
  const drawn = (await writesLeft()) as number;
  await client.mutation(api.mcp.ingest, {
    type: "Note",
    id: "notes/from-the-file",
    title: "From the file",
    description: "What the deploy notes say.",
    sources: [`source:${src.id}`],
  });
  const cited = await client.mutation(api.sources.read, { id: src.id });
  expect(cited.cited_concepts).toEqual([
    {
      id: "notes/from-the-file",
      title: "From the file",
      description: "What the deploy notes say.",
    },
  ]);
  const concept = await client.mutation(api.dashboard.concept, { id: "notes/from-the-file" });
  expect(concept.downloads[src.id]).toMatch(/^https?:\/\/.*\/files\//);
  await client.mutation(api.mcp.remove, { id: "notes/from-the-file" });
  const spent = drawn - ((await writesLeft()) as number);
  // Free attaches files of up to 50 MB: a bigger one is refused before it uploads.
  await expect(
    client.mutation(api.sources.uploadUrl, { name: "manual.pdf", size: 60_000_000 }),
  ).rejects.toThrow(/attaches files of up to 50\.0 MB/);
  // Text and pictures only: a recording is refused before it uploads, whatever its size,
  // with why (returned, so the refusal is counted by its kind).
  expect(await client.mutation(api.sources.uploadUrl, { name: "talk.mov", size: 1_000 })).toEqual({
    error: expect.stringMatching(/for a recording, its transcript/),
  });
  await client.mutation(api.sources.remove, { id: src.id });
  // The upload URL, the attach, and the delete each count a write, as an agent's do;
  // a refused file counts none.
  expect(await writesLeft()).toBe((before as number) - 3 - spent);
});

run(
  "Export's file part links a file's bytes, and Import attaches it again under its old id",
  async () => {
    const from = new ConvexHttpClient(url as string);
    signIn(from, "export-files");
    await from.mutation(api.workspaces.ensure, {});
    const bytes = new TextEncoder().encode("# Checklist\n\nExport, then Import.\n");
    const attach = async (client: ConvexHttpClient, extra: { id?: string; location?: string }) => {
      const up = await client.mutation(api.sources.uploadUrl, {
        name: "checklist.md",
        type: "text/markdown",
        size: bytes.length,
      });
      if ("error" in up) throw new Error(up.error);
      const res = await fetch(up.upload_url, {
        method: "POST",
        headers: { "Content-Type": up.content_type },
        body: bytes,
      });
      const { storageId } = (await res.json()) as { storageId: string };
      return await client.mutation(api.sources.attach, {
        storageId,
        name: "checklist.md",
        ...extra,
      });
    };
    const src = await attach(from, { location: "docs/checklist.md" });
    // The export's parts: the file's size, then its part with a link to its bytes.
    const sizes = await from.mutation(api.sources.exportFileSizes, { cursor: null });
    expect(sizes.files).toEqual([{ id: src.id, bytes: bytes.length }]);
    const part = await from.mutation(api.sources.exportFiles, {
      from: src.id,
      to: src.id,
      cursor: null,
    });
    const exported = part.sources.find((s) => s.id === src.id);
    expect(exported?.file).toMatchObject({ name: "checklist.md", bytes: bytes.length });
    const link = (exported as { download_url?: string } | undefined)?.download_url;
    expect(link).toMatch(/\/files\//);
    expect(new Uint8Array(await (await fetch(link as string)).arrayBuffer())).toEqual(bytes);
    // Another library takes the same file under the same id, so the concepts citing it still find it.
    const to = new ConvexHttpClient(url as string);
    signIn(to, "import-files");
    await to.mutation(api.workspaces.ensure, {});
    const again = await attach(to, { id: src.id, location: "docs/checklist.md" });
    expect(again).toMatchObject({ id: src.id, location: "docs/checklist.md" });
  },
);

run(
  "the Library in one call: its list, its filters, and its files",
  async () => {
    const client = new ConvexHttpClient(url as string);
    signIn(client, "library");
    await client.mutation(api.workspaces.ensure, {});
    const kept = (await client.mutation(api.mcp.addSource, {
      title: "Runbook notes",
      text: "Deploys go out from main after review.",
    })) as { id: string; cite: string };
    await client.mutation(api.mcp.ingest, {
      type: "Decision",
      id: "ops/deploy",
      title: "Deploying",
      tags: ["deploys"],
      sources: [kept.cite],
    });
    // Two types: whatever an agent calls it, a concept that isn't a Decision is a Note.
    await client.mutation(api.mcp.ingest, { type: "Runbook", id: "ops/oncall", title: "On call" });

    const all = await client.mutation(api.dashboard.library, { cursor: null });
    expect(all.concepts.map((c) => c.id)).toEqual(["ops/deploy", "ops/oncall"]);
    expect(all.types).toEqual({ Decision: 1, Note: 1 });
    // Needs you is read only when asked; the counts always.
    expect(all.review).toBeNull();
    expect(all.status.concepts).toBe(2);
    const first = await client.mutation(api.dashboard.library, { cursor: null, review: true });
    expect(first.review?.shelf).toEqual([]);
    // A search past its 50 best says so; this one is far below.
    expect(all.capped).toBe(false);
    const found = await client.mutation(api.dashboard.library, { query: "call", cursor: null });
    expect(found.capped).toBe(false);
    expect(all.sources.map((s) => s.id)).toEqual([kept.id]);
    const ids = (r: { concepts: { id: string }[] }) => r.concepts.map((c) => c.id);
    expect(
      ids(await client.mutation(api.dashboard.library, { type: "Note", cursor: null })),
    ).toEqual(["ops/oncall"]);
  },
  60_000,
);

run(
  "the Library sorts newest or oldest first, by last change, a page at a time",
  async () => {
    const client = new ConvexHttpClient(url as string);
    signIn(client, "sort");
    const wsId = await client.mutation(api.workspaces.ensure, {});
    // Written in turn, s/n1 first; the even ones are Decisions; n1 and n4 carry a rare tag.
    const written = ["s/n1", "s/n2", "s/n3", "s/n4", "s/n5"];
    for (const [i, id] of written.entries()) {
      await client.mutation(api.mcp.ingest, {
        type: i % 2 ? "Decision" : "Note",
        id,
        title: `Sorted ${i + 1}`,
        tags: i === 0 || i === 3 ? ["rare-sort"] : [],
      });
    }
    const first = await client.mutation(api.mcp.addSource, { title: "First file", text: "One." });
    const second = await client.mutation(api.mcp.addSource, { title: "Second file", text: "Two." });
    const ids = (r: { concepts: { id: string }[] }) =>
      r.concepts.map((c) => c.id).filter((id) => id.startsWith("s/"));
    const newest = await client.mutation(api.dashboard.library, { cursor: null, order: "newest" });
    expect(ids(newest)).toEqual([...written].reverse());
    const oldest = await client.mutation(api.dashboard.library, { cursor: null, order: "oldest" });
    expect(ids(oldest)).toEqual(written);
    // Files the same way: by when each came in.
    const fileIds = [(first as { id: string }).id, (second as { id: string }).id];
    expect(newest.sources.map((s) => s.id)).toEqual([...fileIds].reverse());
    expect(oldest.sources.map((s) => s.id)).toEqual(fileIds);
    // Two a page, through a filter: no gaps, no repeats. A tag or a shelf is
    // read whole and sorted; all of them, or a type, by a walk in date order.
    const walk = (
      order: "newest" | "oldest",
      filters: { type?: string; tag?: string; shelf?: string } = {},
    ) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = runDevJson("dev:recentPage", {
          workspaceId: wsId,
          order,
          cursor,
          limit: 2,
          ...filters,
        }) as { ids: string[]; cursor: string | null };
        seen.push(...page.ids);
        cursor = page.cursor;
      } while (cursor);
      return seen.filter((id) => id.startsWith("s/"));
    };
    expect(walk("newest")).toEqual([...written].reverse());
    expect(walk("oldest")).toEqual(written);
    expect(walk("oldest", { type: "Decision" })).toEqual(["s/n2", "s/n4"]);
    expect(walk("newest", { shelf: "s" })).toEqual([...written].reverse());
    expect(walk("oldest", { shelf: "s", type: "Decision" })).toEqual(["s/n2", "s/n4"]);
    expect(walk("newest", { tag: "rare-sort" })).toEqual(["s/n4", "s/n1"]);
  },
  60_000,
);

run(
  "a member leaves a library and can't delete it; an admin deletes it; its owner can't leave",
  async () => {
    const owner = new ConvexHttpClient(url as string);
    signIn(owner, "lib-owner");
    const wsId = await owner.mutation(api.workspaces.ensure, {});
    runDev("dev:setPlan", { workspaceId: wsId, plan: "team" });
    const code = await person(owner).mutation(api.team.createInvite, {});
    const mate = new ConvexHttpClient(url as string);
    signIn(mate, "lib-mate");
    await person(mate).mutation(api.team.accept, { code });
    const helper = new ConvexHttpClient(url as string);
    const { userId: helperId } = signIn(helper, "lib-admin");
    await person(helper).mutation(api.team.accept, { code });

    // A member can't delete the library, but can leave it.
    await expect(person(mate).mutation(api.workspaces.deleteLibrary, { id: wsId })).rejects.toThrow(
      /only the library's owner or an admin can delete it/,
    );
    await person(mate).mutation(api.workspaces.leaveLibrary, { id: wsId });
    const ids = async (c: ConvexHttpClient) =>
      (await c.query(api.workspaces.libraries, {})).map((l) => l.id);
    expect(await ids(mate)).not.toContain(wsId);
    // Its owner can't leave it.
    await expect(person(owner).mutation(api.workspaces.leaveLibrary, { id: wsId })).rejects.toThrow(
      /you own this library/,
    );
    // An admin who isn't its owner deletes it, for everyone.
    runDev("dev:setMemberRole", { workspaceId: wsId, userId: helperId, role: "admin" });
    await person(helper).mutation(api.workspaces.deleteLibrary, { id: wsId });
    expect(await ids(owner)).not.toContain(wsId);
    expect(await ids(helper)).not.toContain(wsId);
  },
  60_000,
);

run(
  "a Team covers its owner's libraries: one bill, seats once, shared limits, and Free when it ends",
  async () => {
    const owner = new ConvexHttpClient(url as string);
    const { userId: ownerId } = signIn(owner, "cover-owner");
    const home = await owner.mutation(api.workspaces.ensure, {});
    // Individual first, so a second library can be made, with a concept in each.
    runDev("dev:setPlan", { workspaceId: home, plan: "individual" });
    const second = await person(owner).mutation(api.workspaces.createLibrary, { name: "Second" });
    await owner.mutation(api.mcp.ingest, { type: "Note", id: "n/home", title: "At home" });
    await owner.mutation(api.mcp.ingest, {
      library: second.slug,
      type: "Note",
      id: "n/second",
      title: "In the second",
    });

    // The home turns Team, as Stripe's webhook says it (billing.setStatus):
    // the owner's other library comes under it.
    runDev("billing:setStatus", { workspaceId: home, status: "active", plan: "team" });
    const shown = async () => (await owner.query(api.workspaces.me, {}))?.workspace;
    await person(owner).mutation(api.workspaces.switchLibrary, { id: second.id });
    let ws = await shown();
    expect(ws?.plan).toBe("team");
    expect(ws?.billedWith).toBe("My library");
    // Their limits are the Team's, together: two concepts of 15,000, and
    // each library's room is what the other leaves it.
    expect(ws?.usage).toMatchObject({ libraries: 2, concepts: 2, maxConcepts: 15_000 });
    const status = await owner.mutation(api.mcp.status, { library: second.slug });
    expect(status.max_concepts).toBe(14_999);
    // Credits are the home's.
    runDev("dev:setIndexUsage", { workspaceId: home, used: 100 });
    expect((await shown())?.indexCredits.used).toBe(100);
    // Its plan, seats, and pay-as-you-go change at the home.
    await expect(
      person(owner).action(api.stripe.createCheckoutSession, { plan: "individual" }),
    ).rejects.toThrow(/billed with My library/);
    await expect(person(owner).action(api.stripe.updateSeats, { seats: 5 })).rejects.toThrow(
      /billed with My library/,
    );
    await expect(
      person(owner).mutation(api.workspaces.setPayAsYouGo, { enabled: true }),
    ).rejects.toThrow(/billed with My library/);

    // A library made on the Team comes under it, with no plan to pick.
    const third = await person(owner).mutation(api.workspaces.createLibrary, { name: "Third" });
    ws = await shown();
    expect([ws?.id, ws?.plan, ws?.billedWith]).toEqual([third.id, "team", "My library"]);
    await person(owner).mutation(api.workspaces.switchLibrary, { id: home });
    ws = await shown();
    expect(ws?.billedWith).toBeNull();
    expect(ws?.covers).toEqual(["Second", "Third"]);

    // Seats count each person once, across the Team's libraries.
    const homeCode = await person(owner).mutation(api.team.createInvite, {});
    const mate = new ConvexHttpClient(url as string);
    const { userId: mateId } = signIn(mate, "cover-mate");
    await person(mate).mutation(api.team.accept, { code: homeCode });
    await person(owner).mutation(api.workspaces.switchLibrary, { id: second.id });
    const secondCode = await person(owner).mutation(api.team.createInvite, {});
    await person(mate).mutation(api.team.accept, { code: secondCode });
    const team = await owner.query(api.team.overview, {});
    expect([team.members.length, team.seatsUsed, team.seats, team.libraries]).toEqual([2, 2, 3, 3]);
    // The third seat goes to a third person; a fourth finds none, in any of them.
    const third3 = new ConvexHttpClient(url as string);
    signIn(third3, "cover-third");
    await person(third3).mutation(api.team.accept, { code: homeCode });
    const fourth = new ConvexHttpClient(url as string);
    const { userId: fourthId } = signIn(fourth, "cover-fourth");
    await expect(person(fourth).mutation(api.team.accept, { code: secondCode })).rejects.toThrow(
      /no free seat \(3 on its plan\)/,
    );

    // The month's writes are the Team's: used up at the home, they're used up here.
    runDev("dev:drainMonthly", { workspaceId: home, which: "writes" });
    await expect(
      owner.mutation(api.mcp.ingest, {
        library: second.slug,
        type: "Note",
        id: "n/more",
        title: "More",
      }),
    ).rejects.toThrow(/This library's Team has used its writes/);

    // The Team ends: its libraries go back to Free, with everything in them,
    // and their own month again.
    runDev("billing:setStatus", { workspaceId: home, status: "canceled", plan: "team" });
    ws = await shown();
    expect([ws?.plan, ws?.billedWith, ws?.usage.libraries]).toEqual(["free", null, 1]);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    expect(ids(await owner.mutation(api.mcp.list, { library: second.slug }))).toEqual(["n/second"]);
    await owner.mutation(api.mcp.update, {
      library: second.slug,
      id: "n/second",
      description: "Kept.",
    });

    // Only their owner uses them now: the teammates are paused, their places
    // kept. A teammate's agent is told why, by any way it names a library,
    // and a write makes no library of its own instead.
    const paused = /This library is paused for you: it's no longer on Team/;
    await expect(mate.mutation(api.mcp.list, {})).rejects.toThrow(paused);
    await expect(mate.mutation(api.mcp.list, { library: second.slug })).rejects.toThrow(paused);
    await expect(
      mate.mutation(api.mcp.ingest, { type: "Note", id: "n/mate", title: "Mine" }),
    ).rejects.toThrow(paused);
    // Their dashboard opens a library of their own, and says which are paused.
    const own = await person(mate).mutation(api.workspaces.ensure, {});
    expect([home, second.id]).not.toContain(own);
    const mateMe = await person(mate).query(api.workspaces.me, {});
    expect(mateMe?.workspace?.id).toBe(own);
    expect(mateMe?.paused.map((l) => l.id).sort()).toEqual([home, second.id].sort());
    expect(ids(await person(mate).query(api.workspaces.libraries, {}))).toEqual([own]);
    // A paused admin can't delete it.
    runDev("dev:setMemberRole", { workspaceId: home, userId: mateId, role: "admin" });
    await expect(person(mate).mutation(api.workspaces.deleteLibrary, { id: home })).rejects.toThrow(
      /only the library's owner or an admin can delete it/,
    );
    // Its owner sees them paused.
    await person(owner).mutation(api.workspaces.switchLibrary, { id: home });
    const kept = await owner.query(api.team.overview, {});
    expect(kept.members.filter((m) => m.paused).length).toBe(2);
    expect(kept.members.find((m) => m.owner)?.paused).toBe(false);
    // Team bought again brings back everyone in the libraries it covers, so
    // Checkout's seats start at all of them: four here, though this one has three.
    runDev("dev:addMember", { workspaceId: second.id, userId: fourthId });
    expect(runDevJson("billing:seatsContext", { userId: ownerId }).members).toBe(4);

    // Team again brings everyone back, with their roles.
    runDev("billing:setStatus", { workspaceId: home, status: "active", plan: "team" });
    expect(ids(await mate.mutation(api.mcp.list, { library: second.slug }))).toEqual(["n/second"]);
    expect(ids(await mate.mutation(api.mcp.list, {}))).toEqual(["n/home"]);
    expect((await person(mate).query(api.workspaces.me, {}))?.paused).toEqual([]);
    expect((await owner.query(api.team.overview, {})).members.some((m) => m.paused)).toBe(false);
  },
  120_000,
);
