/**
 * Libro, on Jev, writing nothing: Jev's pair screen puts likely duplicates on
 * the shelf on every plan, the person's agent drafts the merge through the
 * MCP (`propose`), Jev checks the draft, and the agent carries out the
 * person's decision (`decide`). Review dates: after a review, what is tied
 * to a date gets a suggested review date on the shelf, the day after a date
 * it writes out or as far out as the kind of claim Jev finds, and the person
 * may pick another when setting it. And a Jev outage
 * during the pair screen leaves the pairs for the next one. Jev's synonym
 * screen puts two tags that mean one thing on the shelf, and approving folds
 * them. The source watch puts up for review only the concepts a page's
 * change affects, and all of them when Jev is down.
 *
 * The source watch fetches a page this test serves on 127.0.0.1, so the
 * deployment needs LIBROCAT_FETCH_PRIVATE=1, as tests/mcp.e2e.test.ts does.
 *
 * Opt-in: a running stack with the fake gateway (docs/cloud.md §Local
 * development): tests/fake-gateway.ts on :8787 (AI_GATEWAY_API_KEY +
 * LIBROCAT_AI_GATEWAY_URL on the deployment).
 *   LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210 LIBROCAT_FAKE_GATEWAY=1 pnpm test
 */

import { execFile, spawnSync } from "node:child_process";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";

const url = process.env.LIBROCAT_E2E_CONVEX_URL;
const run = url && process.env.LIBROCAT_FAKE_GATEWAY === "1" ? test : test.skip;
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD || new URL("..", import.meta.url).pathname;

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON from the CLI
function runDev(fn: string, args: Record<string, unknown>): any {
  const r = spawnSync("node_modules/.bin/convex", ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

/**
 * runDev without blocking this process: the source watch fetches a page this
 * test serves, which can't answer while spawnSync holds the event loop.
 */
function runDevAsync(fn: string, args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      "node_modules/.bin/convex",
      ["run", fn, JSON.stringify(args)],
      { cwd: cliCwd, env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" }, encoding: "utf8" },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim() ? JSON.parse(stdout) : null)),
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

run(
  "on every plan, Jev's pair screen shelves twins; the agent drafts the merge, Jev checks it, and approving settles the pair",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token } = runDev("dev:issueTestAccessToken", {
      email: `libro-jev-${Date.now()}@example.com`,
    });
    client.setAuth(token);
    // Free: the pair screen is Jev only, so every plan gets it.

    // Two concepts Jev reads as one subject: a supersede proposal, by Libro.
    for (const [id, title] of [
      ["notes/twin-a", "Twin rollout plan"],
      ["notes/twin-b", "The twin rollout, revised"],
    ]) {
      await client.mutation(api.mcp.ingest, {
        type: "Note",
        id,
        title,
        description: "How the rollout goes.",
        tags: ["rollout", "plan"],
        body: "Roll out in two waves.",
      });
    }
    expect(await client.mutation(api.libro.runNow, {})).toMatchObject({ proposals: 0 });
    const shelf = async () => (await client.mutation(api.mcp.shelf, {})).proposals;
    let twin: Awaited<ReturnType<typeof shelf>>[number] | undefined;
    for (let i = 0; i < 40 && !twin; i++) {
      twin = (await shelf()).find((p) => p.subject === "notes/twin-a" && p.kind === "supersede");
      if (!twin) await sleep(250);
    }
    expect(twin).toMatchObject({ target: "notes/twin-b", by: "libro" });
    expect(twin?.reason).toMatch(/\d+% sure/);

    // The agent reads both and files merges with its drafts; Jev checks each
    // draft against its two sources, and the shelf shows how well they hold.
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "notes/twin-c",
      title: "Rollout waves",
      description: "The two waves.",
      tags: ["rollout"],
      body: "Wave one is staff, wave two is everyone.",
    });
    const propose = (subject: string, title: string) =>
      client.mutation(api.mcp.propose, {
        kind: "merge",
        subject,
        target: "notes/twin-b",
        reason: "One rollout, told twice.",
        draft: { title, description: "The rollout.", tags: ["rollout"], body: "Two waves." },
      });
    expect((await propose("notes/twin-a", "The rollout plan")).filed).toBe(true);
    expect((await propose("notes/twin-c", "An invented launch date")).filed).toBe(true);
    // The same proposal twice is one proposal.
    expect((await propose("notes/twin-a", "The rollout plan")).filed).toBe(false);
    await expect(
      client.mutation(api.mcp.propose, {
        kind: "merge",
        subject: "notes/twin-a",
        target: "notes/nowhere",
        reason: "No such target.",
        draft: { body: "x" },
      }),
    ).rejects.toThrow(/concept not found: notes\/nowhere/);
    await expect(
      client.mutation(api.mcp.propose, {
        kind: "merge",
        subject: "notes/twin-c",
        target: "notes/twin-a",
        reason: "No draft.",
      }),
    ).rejects.toThrow(/needs a draft/);
    let merges: Awaited<ReturnType<typeof shelf>> = [];
    for (let i = 0; i < 20; i++) {
      merges = (await shelf()).filter((p) => p.kind === "merge");
      if (merges.length === 2 && merges.every((m) => m.support !== null)) break;
      await sleep(250);
    }
    const bySubject = Object.fromEntries(merges.map((m) => [m.subject, m]));
    expect(bySubject["notes/twin-a"]?.support).toBeGreaterThanOrEqual(0.8);
    expect(bySubject["notes/twin-c"]?.support).toBeLessThan(0.8);
    expect(bySubject["notes/twin-a"]?.by).toBe("agent");

    // On the person's yes, the agent approves: the target reads as drafted,
    // the subject is superseded, and the screen's supersede of the pair
    // closes with the merge. The other merge waits.
    const approved = await client.mutation(api.mcp.decide, {
      id: bySubject["notes/twin-a"]?.id as string,
      decision: "approve",
    });
    expect(approved).toEqual({ status: "approved" });
    expect((await client.mutation(api.mcp.get, { id: "notes/twin-b" }))?.title).toBe(
      "The rollout plan",
    );
    expect((await client.mutation(api.mcp.get, { id: "notes/twin-a" }))?.superseded_by).toBe(
      "notes/twin-b",
    );
    expect((await shelf()).map((p) => [p.kind, p.subject])).toEqual([["merge", "notes/twin-c"]]);
    // A revision by the agent that drafted it.
    const history = await client.mutation(api.mcp.history, { id: "notes/twin-b" });
    expect(history.revisions[0]).toMatchObject({ kind: "update", by: "agent" });
    // A proposal can't be decided twice, and an id that isn't one is refused.
    expect(
      await client.mutation(api.mcp.decide, {
        id: bySubject["notes/twin-a"]?.id as string,
        decision: "dismiss",
      }),
    ).toEqual({ status: "approved" });
    await expect(
      client.mutation(api.mcp.decide, { id: "not-a-proposal", decision: "approve" }),
    ).rejects.toThrow(/no proposal/);
  },
  60_000,
);

run(
  "a review date for what is tied to a date: set it, change it, or dismiss it for good",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token, workspaceId } = runDev("dev:issueTestAccessToken", {
      email: `libro-dates-${Date.now()}@example.com`,
    });
    client.setAuth(token);
    // Free: review dates are Jev only, so every plan gets them.
    const write = (id: string, body: string) =>
      client.mutation(api.mcp.ingest, {
        type: "Note",
        id,
        title: id,
        description: "A note.",
        tags: ["plan"],
        body,
      });
    // A date written out that hasn't come yet: code proposes the day after.
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const launchDay = day(Date.now() + 200 * 86_400_000);
    await write("plans/pricing", "The Team plan costs $60 a month.");
    await write("plans/launch", `We launch on ${launchDay}.`);
    await write("notes/search", "Search matches any word of the query.");
    await client.mutation(api.libro.runNow, {});
    const suggested = async () =>
      (await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf)).filter(
        (p) => p.kind === "date",
      );
    let dates = await suggested();
    for (let i = 0; i < 40 && dates.length < 2; i++) {
      await sleep(250);
      dates = await suggested();
    }
    expect(dates.map((p) => p.subject).sort()).toEqual(["plans/launch", "plans/pricing"]);
    const pricing = dates.find((p) => p.subject === "plans/pricing");
    const launch = dates.find((p) => p.subject === "plans/launch");
    expect(launch?.target).toBe(day(Date.parse(launchDay) + 86_400_000));
    expect(launch?.reason).toMatch(
      /^Says \w{3} \d{1,2}, \d{4}\. Check it again by \w{3} \d{1,2}, \d{4}\?$/,
    );
    // A price: a quarter out (the fake gateway says yes to price only).
    const days = (Date.parse(pricing?.target as string) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(91);
    expect(pricing?.reason).toMatch(
      /^States a price \(Libro is 90% sure\)\. Check it again by \w{3} \d{1,2}, \d{4}\?$/,
    );

    // A date the person picks must be one, and after today.
    const picked = day(Date.now() + 45 * 86_400_000);
    await expect(
      client.mutation(api.libro.decide, {
        id: pricing?.id as never,
        decision: "approve",
        date: day(Date.now() - 86_400_000),
      }),
    ).rejects.toThrow(/after today/);
    await expect(
      client.mutation(api.libro.decide, {
        id: pricing?.id as never,
        decision: "approve",
        date: "2027-02-30",
      }),
    ).rejects.toThrow(/not a date/);
    // Set, with the date picked instead: it becomes the concept's review date.
    await client.mutation(api.libro.decide, {
      id: pricing?.id as never,
      decision: "approve",
      date: picked,
    });
    expect((await client.mutation(api.mcp.get, { id: "plans/pricing" }))?.stale_after).toBe(picked);
    // Dismiss: not suggested again, even after the concept changes.
    await client.mutation(api.libro.decide, { id: launch?.id as never, decision: "dismiss" });
    await client.mutation(api.mcp.update, { id: "plans/launch", body: "We launch on 2026-11-01." });
    runDev("dev:clearLibroCooldown", { workspaceId });
    await client.mutation(api.libro.runNow, {});
    await sleep(2000);
    expect(await suggested()).toEqual([]);
  },
  60_000,
);

run(
  "a Jev outage during the pair screen leaves the pairs for the next one",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token, workspaceId } = runDev("dev:issueTestAccessToken", {
      email: `libro-flaky-${Date.now()}@example.com`,
    });
    client.setAuth(token);
    const body =
      "Snapshot the database, pause the writers, run the migration, check the row counts, and resume the writers.";
    // The same steps under two titles that share their words, on one shelf; the
    // fake gateway fails Jev once on them.
    for (const [id, title] of [
      ["ops/migrate", "Twin jev-flaky runbook"],
      ["ops/migrate-v2", "The twin jev-flaky runbook, revised"],
    ]) {
      await client.mutation(api.mcp.ingest, {
        type: "Runbook",
        id,
        title,
        description: "How we migrate.",
        body,
        tags: ["ops"],
      });
    }
    const supersedes = async () =>
      (await client.mutation(api.dashboard.overview, {}).then((o) => o.shelf)).filter(
        (p) => p.kind === "supersede",
      );

    // Jev is down: nothing is filed, and the screen says it will read them again.
    expect(runDev("libro:pairsScreen", { workspaceId })).toEqual({ confirmed: 0, retry: true });
    expect(await supersedes()).toEqual([]);

    // Nothing changed since, and Jev is back: the same pairs are read again.
    expect(runDev("libro:pairsScreen", { workspaceId })).toEqual({ confirmed: 1 });
    expect((await supersedes()).map((p) => [p.subject, p.target])).toEqual([
      ["ops/migrate", "ops/migrate-v2"],
    ]);
  },
  60_000,
);

run(
  "Jev's synonym screen shelves two tags that mean one thing; approving files the rarer under the other",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token } = runDev("dev:issueTestAccessToken", {
      email: `libro-synonyms-${Date.now()}@example.com`,
    });
    client.setAuth(token);
    // Free: the synonym screen is Jev only, so every plan gets it. The fake
    // gateway reads two tags as one meaning when both say "twin".
    for (const [id, title, tags] of [
      ["infra/upgrades", "Cluster upgrades", ["twin-k8s", "twin-kubernetes"]],
      ["infra/draining", "Draining a node", ["twin-k8s", "twin-kubernetes"]],
      ["infra/autoscaling", "Autoscaling pods", ["twin-kubernetes"]],
    ] as const) {
      await client.mutation(api.mcp.ingest, {
        type: "Runbook",
        id,
        title,
        description: "How we run the cluster.",
        tags: [...tags],
        body: "Steps for the cluster.",
      });
    }
    await client.mutation(api.libro.runNow, {});
    const synonyms = async () =>
      (await client.mutation(api.mcp.shelf, {})).proposals.filter((p) => p.kind === "synonym");
    let found = await synonyms();
    for (let i = 0; i < 40 && found.length === 0; i++) {
      await sleep(250);
      found = await synonyms();
    }
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      subject: "twin-k8s",
      target: "twin-kubernetes",
      by: "libro",
    });
    expect(found[0]?.reason).toMatch(
      /"twin-k8s" reads as "twin-kubernetes" \(Libro is \d+% sure\)/,
    );

    // Approved: a use-for term in the thesaurus, and the library retagged.
    await client.mutation(api.libro.decide, { id: found[0]?.id as never, decision: "approve" });
    const th = await client.mutation(api.mcp.thesaurus, {});
    expect(th["twin-kubernetes"]?.use_for).toEqual(["twin-k8s"]);
    const upgrades = await client.mutation(api.mcp.get, { id: "infra/upgrades" });
    expect(upgrades?.tags).toContain("twin-kubernetes");
    expect(upgrades?.tags).not.toContain("twin-k8s");
  },
  60_000,
);

run(
  "a watched page's change puts up for review only the concepts it affects, and all of them when Jev is down",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token, workspaceId } = runDev("dev:issueTestAccessToken", {
      email: `libro-watch-${Date.now()}@example.com`,
      plan: "individual",
    });
    client.setAuth(token);
    const tag = Date.now().toString(36);
    let page =
      `<title>Pricing ${tag}</title><main><p>Team costs $15 a person.</p>` +
      "<p>Support answers within a day.</p></main>";
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const location = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pricing-${tag}`;
    try {
      await client.action(api.fetching.addSourceFromUrl, { location });
      // The fake gateway: a change affects a concept that shares a long word with it.
      for (const [id, title, description] of [
        ["pricing/team", "Team price", "What one Team seat costs a person."],
        ["support/hours", "Support hours", "Support answers within a day."],
      ]) {
        await client.mutation(api.mcp.ingest, {
          type: "Fact",
          id,
          title,
          description,
          body: description,
          tags: ["pricing"],
          sources: [location],
        });
      }
      const stale = async () =>
        (await client.mutation(api.mcp.shelf, {})).proposals
          .filter((p) => p.kind === "stale")
          .map((p) => p.subject)
          .sort();

      // The price changed: Jev reads it as touching the price, not support.
      page = page.replace("$15", "$18");
      expect(await runDevAsync("fetching:watch", { workspaceId, force: true })).toMatchObject({
        changed: 1,
        reviewed: 1,
        unaffected: 1,
        fallback: 0,
      });
      expect(await stale()).toEqual(["pricing/team"]);
      const team = (await client.mutation(api.mcp.shelf, {})).proposals.find(
        (p) => p.kind === "stale",
      );
      expect(team?.reason).toContain(location);
      expect(team?.reason).toMatch(/Libro is \d+% sure/);
      expect((await client.mutation(api.mcp.get, { id: "support/hours" }))?.stale).toBe(false);

      // Jev is down for this change (the fake gateway fails "jev-flaky" once):
      // every citing concept comes up, as before Jev judged.
      page = page.replace("$18 a person.", "$20 a person, jev-flaky.");
      expect(await runDevAsync("fetching:watch", { workspaceId, force: true })).toMatchObject({
        changed: 1,
        fallback: 1,
      });
      expect(await stale()).toContain("support/hours");
    } finally {
      server.close();
    }
  },
  60_000,
);

run(
  "Jev reads a file a person attaches: a description from its own words, and the concept it changes comes up",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const email = `files-jev-${Date.now()}@example.com`;
    const { token, userId } = runDev("dev:issueTestAccessToken", { email });
    client.setAuth(token);
    // A concept the file will contradict.
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "pricing/team",
      title: "Team plan pricing",
      description: "The Team plan costs fifteen dollars a person each month.",
      tags: ["pricing"],
      body: "Team costs $15 a person a month.",
    });
    // Attached on the dashboard: an upload, then attach (no agent: a person's file).
    const text =
      "# Jev pricing sheet 2027\n\nFrom January, the Team plan costs eighteen dollars a " +
      "person each month for every new subscription.\n";
    const step = (await client.mutation(api.sources.uploadUrl, {
      name: "jev-pricing-2027.md",
      type: "text/markdown",
      size: Buffer.byteLength(text),
    })) as { upload_url: string; content_type: string };
    const up = await fetch(step.upload_url, {
      method: "POST",
      headers: { "Content-Type": step.content_type },
      body: text,
    });
    const { storageId } = (await up.json()) as { storageId: string };
    const kept = (await client.mutation(api.sources.attach, {
      storageId,
      name: "jev-pricing-2027.md",
      title: "Jev pricing sheet 2027",
    })) as { id: string };

    // Once read, Jev reads it: a description that is one of its own sentences...
    let src: { description?: string } = {};
    for (let i = 0; i < 60 && !src.description; i++) {
      src = (await client.mutation(api.mcp.getSource, { ref: `source:${kept.id}` })) as {
        description?: string;
      };
      if (!src.description) await sleep(250);
    }
    expect(src.description).toMatch(/eighteen dollars a person/);
    // ...and the concept it contradicts comes up in Needs you, naming the file.
    const stale = (await client.mutation(api.mcp.shelf, {})).proposals.find(
      (p) => p.kind === "stale" && p.subject === "pricing/team",
    );
    expect(stale?.reason).toMatch(/The file “Jev pricing sheet 2027” may change this/);
    expect(stale?.reason).toMatch(/Libro is \d+% sure/);

    // Files use at most half of the month's credits, and never bill: at half,
    // a file is kept and found by its words, and Libro leaves it to the agent.
    const workspaceId = await client.mutation(api.workspaces.ensure, {});
    const status = async () => (await client.mutation(api.mcp.status, {})).index_credits;
    const half = ((await status())?.included ?? 0) / 2;
    runDev("dev:setIndexUsage", { workspaceId, used: half });
    const more =
      "# Jev pricing sheet, draft\n\nA draft of the sheet, with the Team plan at eighteen dollars a person.\n";
    const step2 = (await client.mutation(api.sources.uploadUrl, {
      name: "jev-pricing-draft.md",
      type: "text/markdown",
      size: Buffer.byteLength(more),
    })) as { upload_url: string; content_type: string };
    const up2 = await fetch(step2.upload_url, {
      method: "POST",
      headers: { "Content-Type": step2.content_type },
      body: more,
    });
    const second = (await client.mutation(api.sources.attach, {
      storageId: ((await up2.json()) as { storageId: string }).storageId,
      name: "jev-pricing-draft.md",
      title: "Jev pricing sheet, draft",
    })) as { id: string };
    let read: { status?: string; description?: string } = {};
    for (let i = 0; i < 40 && read.status !== "ready"; i++) {
      read = (await client.mutation(api.mcp.getSource, { ref: `source:${second.id}` })) as {
        status?: string;
        description?: string;
      };
      if (read.status !== "ready") await sleep(250);
    }
    await sleep(2_000);
    read = (await client.mutation(api.mcp.getSource, { ref: `source:${second.id}` })) as {
      description?: string;
    };
    expect(read.description).toBeUndefined();
    expect((await status())?.used).toBe(half);

    // Its waiting reading goes with the library's contents (model.ts
    // deleteSome): emptying the library leaves nothing of the file behind.
    const readings = () =>
      (runDev("dev:identityRows", { userId, email, workspaceId }) as { fileReads: number })
        .fileReads;
    expect(readings()).toBeGreaterThan(0);
    const admin = new ConvexHttpClient(url as string);
    admin.setAuth(runDev("dev:issueTestAccessToken", { email, person: true }).token);
    await admin.mutation(api.concepts.deleteAll, {});
    for (let i = 0; i < 40 && readings() > 0; i++) await sleep(250);
    expect(readings()).toBe(0);
  },
  60_000,
);

run(
  "Libro reads a long file to its end: a change on its last pages is flagged, naming the part, and past the half pay-as-you-go reads on",
  async () => {
    const client = new ConvexHttpClient(url as string);
    // Its person, on the dashboard: pay-as-you-go is theirs to turn on.
    const { token, workspaceId } = runDev("dev:issueTestAccessToken", {
      email: `files-long-${Date.now()}@example.com`,
      plan: "individual",
      person: true,
    });
    client.setAuth(token);
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "pricing/team",
      title: "Team plan pricing",
      description: "The Team plan costs fifteen dollars a person each month.",
      tags: ["pricing"],
      body: "Team costs $15 a person a month.",
    });
    // Files are past their half of the month's credits; pay-as-you-go is on.
    await client.mutation(api.workspaces.setPayAsYouGo, { enabled: true });
    const status = async () =>
      (await client.mutation(api.mcp.status, {})).index_credits as {
        included: number;
        used: number;
        overage: number;
      };
    const half = (await status()).included / 2;
    runDev("dev:setIndexUsage", { workspaceId, used: half });

    // Pages about something else, then the change, on the last page.
    const filler = (i: number) =>
      `Section ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. `.repeat(
        40,
      );
    const text =
      `# Jev handbook\n\n${[1, 2, 3, 4, 5].map(filler).join("\n\n")}\n\n` +
      "From January, the Team plan costs eighteen dollars a person each month.\n";
    const step = (await client.mutation(api.sources.uploadUrl, {
      name: "jev-handbook.md",
      type: "text/markdown",
      size: Buffer.byteLength(text),
    })) as { upload_url: string; content_type: string };
    const up = await fetch(step.upload_url, {
      method: "POST",
      headers: { "Content-Type": step.content_type },
      body: text,
    });
    const kept = (await client.mutation(api.sources.attach, {
      storageId: ((await up.json()) as { storageId: string }).storageId,
      name: "jev-handbook.md",
      title: "Jev handbook",
    })) as { id: string };

    // The change on its last part is found, and the reason says where.
    let stale: { reason?: string } | undefined;
    for (let i = 0; i < 80 && !stale; i++) {
      stale = (await client.mutation(api.mcp.shelf, {})).proposals.find(
        (p) => p.kind === "stale" && p.subject === "pricing/team",
      );
      if (!stale) await sleep(250);
    }
    expect(stale?.reason).toMatch(
      /The file “Jev handbook” may change this \(Libro is \d+% sure; see its part (\d+) of \1\)/,
    );
    // Read to its end, every read past the half billed as pay-as-you-go.
    let page: { libro?: { done: boolean; read: number; total: number } } = {};
    for (let i = 0; i < 40 && !page.libro?.done; i++) {
      page = (await client.mutation(api.sources.read, { id: kept.id })) as typeof page;
      if (!page.libro?.done) await sleep(250);
    }
    expect(page.libro).toMatchObject({ done: true });
    expect(page.libro?.read).toBe(page.libro?.total);
    const after = await status();
    expect(after.used).toBe(half);
    expect(after.overage).toBeGreaterThanOrEqual(2);
  },
  90_000,
);
