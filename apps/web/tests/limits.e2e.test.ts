/**
 * librocat.com's limits (convex/limits.ts): search, by words, calling no
 * model on any plan, the calls a library may make a minute and a month, and
 * pay-as-you-go's monthly cap (model.ts spendCredits).
 *
 * Opt-in: a running stack with the fake gateway (docs/cloud.md §Local
 * development), its key set on the deployment. `pnpm run e2e` runs it.
 *   LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210 LIBROCAT_FAKE_GATEWAY=1 pnpm test
 */

import { spawnSync } from "node:child_process";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Jev's evaluations the fake gateway has answered. */
const evaluations = () =>
  fetch("http://127.0.0.1:8787/calls")
    .then((r) => r.json() as Promise<{ evaluations: number }>)
    .then((c) => c.evaluations);

/** The evaluation count once nothing else is in flight: the same twice, half a second apart. */
async function settledEvaluations() {
  let last = await evaluations();
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const now = await evaluations();
    if (now === last) return now;
    last = now;
  }
  return last;
}

/**
 * A Free library of its own, signed in the way an approved agent is, or as
 * its person on the dashboard (`person`), for what only a person does.
 */
function freeLibrary(label: string, person = false) {
  const client = new ConvexHttpClient(url as string);
  const { token, workspaceId, userId } = runDev("dev:issueTestAccessToken", {
    email: `limits-${label}-${Date.now()}@example.com`,
    ...(person ? { person } : {}),
  });
  client.setAuth(token);
  return { client, workspaceId, userId: userId as string };
}

/** Upload a text file without attaching it: its storage id. */
async function uploadText(client: ConvexHttpClient, name: string, text: string) {
  const bytes = Buffer.from(text, "utf8");
  const up = (await client.mutation(api.mcp.addSource, {
    file: { name, type: "text/plain", size: bytes.length },
  })) as { upload_url: string };
  const res = await fetch(up.upload_url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: new Uint8Array(bytes),
  });
  return ((await res.json()) as { storageId: string }).storageId;
}

/** Upload a file and attach it: its id. */
async function attachText(client: ConvexHttpClient, name: string, text: string) {
  const storageId = await uploadText(client, name, text);
  const src = (await client.mutation(api.mcp.addSource, {
    storage_id: storageId,
    filename: name,
    title: name,
  })) as { id: string };
  return src.id;
}

run(
  "search answers by words, on every plan, with no allowance of its own, and calls no model",
  async () => {
    const { client, workspaceId } = freeLibrary("words");
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "s/deploys",
      title: "Deploys",
      description: "Push to main.",
      tags: ["ops"],
      body: "Push to main and wait for the build.",
    });
    // A description and tags: nothing to catalog, so Jev has nothing to do.
    const before = await settledEvaluations();
    // Any form of the word finds it (stemmed); a word no concept has finds nothing.
    const hits = await client.mutation(api.mcp.searchWords, { query: "deploying" });
    expect(hits.map((h) => h.id)).toEqual(["s/deploys"]);
    expect(await client.mutation(api.mcp.searchWords, { query: "postgres" })).toEqual([]);
    // The action an older Next.js calls during a deploy runs the same search.
    const viaAction = await client.action(api.mcp.search, { query: "deploys" });
    expect(viaAction.map((h: { id: string }) => h.id)).toEqual(["s/deploys"]);
    // A paid plan searches the same way.
    runDev("dev:setPlan", { workspaceId, plan: "individual" });
    expect(
      (await client.mutation(api.mcp.searchWords, { query: "deploy" })).map((h) => h.id),
    ).toEqual(["s/deploys"]);
    await sleep(1500);
    expect(await evaluations()).toBe(before);
    // No search allowance to report: calls and writes a month are the ceilings.
    const status = await client.mutation(api.mcp.status, {});
    expect(status).not.toHaveProperty("meaning_searches");
    expect(status.monthly?.calls.included).toBe(30_000);
  },
  60_000,
);

run(
  "past a Free library's calls per minute, the agent is told when to try again",
  async () => {
    const { client } = freeLibrary("calls");
    await client.mutation(api.mcp.ingest, { type: "Note", id: "n/one", title: "One" });
    let ok = 1;
    let refused: Error | null = null;
    for (let i = 0; i < 120 && !refused; i++) {
      try {
        await client.mutation(api.mcp.get, { id: "n/one" });
        ok += 1;
      } catch (e) {
        refused = e as Error;
      }
    }
    // 60 a minute, refilled as it goes: a few more get through while the loop runs.
    expect(refused?.message).toMatch(
      /Too many calls to this library: try again in \d+ s\. Free allows 60 a minute/,
    );
    expect(ok).toBeGreaterThanOrEqual(60);
    expect(ok).toBeLessThan(90);
  },
  60_000,
);

run(
  "pay-as-you-go stops at the library's monthly cap, and its admins hear of it",
  async () => {
    const client = new ConvexHttpClient(url as string);
    // Its person, on the dashboard: pay-as-you-go is theirs to turn on.
    const { token, workspaceId } = runDev("dev:issueTestAccessToken", {
      email: `limits-cap-${Date.now()}@example.com`,
      plan: "individual",
      person: true,
    });
    client.setAuth(token);
    await client.mutation(api.workspaces.setPayAsYouGo, { enabled: true });
    // Whole dollars, from $1 to $1,000.
    for (const dollars of [0, 2.5, 1_001]) {
      await expect(client.mutation(api.workspaces.setPayAsYouGoCap, { dollars })).rejects.toThrow(
        /whole number of dollars from 1 to 1,000/,
      );
    }
    expect(await client.mutation(api.workspaces.setPayAsYouGoCap, { dollars: 1 })).toBe(100);

    const credits = async () => (await client.mutation(api.mcp.status, {})).index_credits;
    // The fake Jev catalogs a concept whose title names it.
    const blank = (id: string, body: string) =>
      client.mutation(api.mcp.ingest, { type: "Note", id, title: `Jev ${id}`, body });
    const cataloged = async (id: string) => {
      for (let i = 0; i < 20; i++) {
        if ((await client.mutation(api.mcp.get, { id }))?.indexed_at) return true;
        await sleep(500);
      }
      return false;
    };

    // The included credits are spent, and $0.99 of the $1 cap.
    runDev("dev:setIndexUsage", { workspaceId, used: 500, overage: 99 });
    // The last cent under the cap: cataloged, and the cap email goes out.
    await blank("cap/one", "Jev picks this sentence as the summary. The rest is detail.");
    expect(await cataloged("cap/one")).toBe(true);
    expect(await credits()).toMatchObject({ overage: 100, overage_cents: 100, cap_cents: 100 });
    expect(runDev("dev:capState", { workspaceId }).notice).toMatchObject({ level: 100 });

    // At the cap: the next concept waits, uncataloged, and nothing more is spent.
    await blank("cap/two", "Jev picks this sentence as the summary. It waits for credits.");
    expect(await cataloged("cap/two")).toBe(false);
    expect((await credits())?.overage).toBe(100);

    // A higher cap: the next write is cataloged, and the cap emails start over.
    await client.mutation(api.workspaces.setPayAsYouGoCap, { dollars: 2 });
    expect(runDev("dev:capState", { workspaceId })).toEqual({ capCents: 200, notice: null });
    await client.mutation(api.mcp.update, {
      id: "cap/two",
      body: "Jev picks this sentence as the summary. Now there is room under the cap.",
    });
    expect(await cataloged("cap/two")).toBe(true);
    expect((await credits())?.overage).toBe(101);
  },
  60_000,
);

run(
  "a library past its calls or writes a month is told which, and when it can go on",
  async () => {
    const { client, workspaceId } = freeLibrary("monthly");
    await client.mutation(api.mcp.ingest, { type: "Note", id: "m/one", title: "One" });
    const { monthly } = await client.mutation(api.mcp.status, {});
    expect(monthly).toMatchObject({
      calls: { included: 10_000 },
      writes: { included: 1_500 },
      transfer_bytes: { included: 1_000_000_000 },
    });
    expect(monthly?.writes.left).toBeLessThan(1_500);

    // Writes used up: a write is refused, and a read still goes.
    runDev("dev:drainMonthly", { workspaceId, which: "writes" });
    await expect(
      client.mutation(api.mcp.ingest, { type: "Note", id: "m/two", title: "Two" }),
    ).rejects.toThrow(/used its writes for now: Free allows 1,500 a month, refilled day by day/);
    expect((await client.mutation(api.mcp.get, { id: "m/one" }))?.id).toBe("m/one");

    // Calls used up: reads too, through the meter the read tools go through.
    runDev("dev:drainMonthly", { workspaceId, which: "calls" });
    await expect(client.mutation(api.mcp.get, { id: "m/one" })).rejects.toThrow(
      /used its calls for now: Free allows 10,000 a month/,
    );
    await expect(client.mutation(api.mcp.meter, {})).rejects.toThrow(/used its calls for now/);
  },
  60_000,
);

run(
  "file transfer counts what's attached and what links serve; past it, links answer 429 and attaching waits",
  async () => {
    const { client, workspaceId } = freeLibrary("transfer");
    const left = async () =>
      (await client.mutation(api.mcp.status, {})).monthly?.transfer_bytes.left ?? 0;
    // Big enough that the allowance's refill (about 385 bytes a second on Free) can't
    // hide it while the test runs.
    const text = `The file's text.\n${"x".repeat(100_000)}\n`;
    const attachedFrom = await left();
    const id = await attachText(client, "one.txt", text);
    // Attaching reads the file to index it: it counts.
    expect(attachedFrom - (await left())).toBeGreaterThan(90_000);
    const read = async () =>
      (await client.mutation(api.mcp.getSource, { ref: `source:${id}` })) as {
        download_url?: string;
        file_transfer?: string;
      };

    // librocat's own link, never the storage's.
    const link = (await read()).download_url as string;
    expect(link).toMatch(/\/files\/[^/]+\/one\.txt$/);
    const before = await left();
    const served = await fetch(link);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-disposition")).toContain('filename="one.txt"');
    expect(await served.text()).toBe(text);
    expect(before - (await left())).toBeGreaterThan(90_000);

    // A link whose token asks for more bytes than it was signed for is refused.
    const wider = new URL(link);
    const [, files, token = "", name] = wider.pathname.split("/");
    const fields = token.split(".");
    fields[3] = String(Number(fields[3]) + 1);
    wider.pathname = ["", files, fields.join("."), name].join("/");
    expect(wider.href).not.toBe(link);
    expect((await fetch(wider)).status).toBe(403);

    // Used up: the same link answers 429 and says why, the text comes without links,
    // and a new file waits before a byte is sent.
    runDev("dev:drainMonthly", { workspaceId, which: "transfer_bytes" });
    const refused = await fetch(link);
    expect(refused.status).toBe(429);
    expect(await refused.text()).toMatch(/used its file transfer for now \(1 GB a month/);
    const capped = await read();
    expect(capped.download_url).toBeUndefined();
    expect(capped.file_transfer).toMatch(/used its file transfer for now \(1 GB a month/);
    await expect(
      client.mutation(api.mcp.addSource, {
        file: { name: "two.txt", type: "text/plain", size: 200_000 },
      }),
    ).rejects.toThrow(/used its file transfer for now \(1 GB a month[^)]*\): more comes back in/);
  },
  60_000,
);

run(
  "text has its own room: past it, text is refused and a file is kept without its text",
  async () => {
    const { client, userId } = freeLibrary("text");
    // Free keeps 10 MB of text: fill it but for a little.
    runDev("dev:setSourceBytes", { userId, bytes: 9_990_000, textBytes: 9_990_000 });
    const sources = (await client.mutation(api.mcp.status, {})).sources as {
      text_bytes: number;
      max_text_bytes: number;
    };
    expect(sources).toMatchObject({ text_bytes: 9_990_000, max_text_bytes: 10_000_000 });
    await expect(
      client.mutation(api.mcp.addSource, { title: "Notes", text: "y".repeat(20_000) }),
    ).rejects.toThrow(/text quota reached: .*10\.0 MB its plan allows/);
    // A file still fits: kept, found by its title, without its text, and saying why.
    const id = await attachText(client, "manual.txt", `A manual.\n${"z".repeat(20_000)}\n`);
    let src: { status?: string; note?: string; bytes?: number } = {};
    for (let i = 0; i < 40 && src.status !== "ready"; i++) {
      src = (await client.mutation(api.mcp.getSource, { ref: `source:${id}` })) as typeof src;
      if (src.status !== "ready") await sleep(250);
    }
    expect(src).toMatchObject({ status: "ready", bytes: 0 });
    expect(src.note).toMatch(/Its text isn't kept: text quota reached/);
  },
  60_000,
);

run(
  "the catalog index keeps status, lists, and citations exact through writes, renames, and deletes",
  async () => {
    const { client } = freeLibrary("catalog");
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    const status = () => client.mutation(api.mcp.status, {});
    const citedBy = async (ref: string) =>
      ((await client.mutation(api.mcp.getSource, { ref })) as { cited_by: string[] }).cited_by;
    const src = (await client.mutation(api.mcp.addSource, {
      title: "Runbook",
      text: "Restart the queue, then drain it.",
    })) as { id: string; cite: string };
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "ops/restart",
      title: "Restart",
      tags: ["ops", "queue"],
      body: "After a [deploy](deploy.md), restart the queue.",
      sources: [src.cite],
    });
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "ops/deploy",
      title: "Deploy",
      tags: ["ops"],
    });
    await client.mutation(api.mcp.ingest, {
      type: "Decision",
      id: "arch/queue",
      title: "Queue",
      tags: ["queue"],
    });

    let st = await status();
    expect(st.by_type).toMatchObject({ Note: 2, Decision: 1 });
    expect(st.by_tag).toMatchObject({ ops: 2, queue: 2 });
    expect(st.links).toBe(1);
    expect(ids(await client.mutation(api.mcp.list, { tag: "queue" }))).toEqual([
      "arch/queue",
      "ops/restart",
    ]);
    expect(ids(await client.mutation(api.mcp.list, { type: "Note" }))).toEqual([
      "ops/deploy",
      "ops/restart",
    ]);
    expect(ids(await client.mutation(api.mcp.list, { shelf: "ops" }))).toEqual([
      "ops/deploy",
      "ops/restart",
    ]);
    expect(ids(await client.mutation(api.mcp.list, { type: "Note", tag: "queue" }))).toEqual([
      "ops/restart",
    ]);
    expect(ids(await client.mutation(api.mcp.list, { tag: "queue", offset: 1, limit: 1 }))).toEqual(
      ["ops/restart"],
    );
    expect(await citedBy(src.cite)).toEqual(["ops/restart"]);
    // An offset past the first 500 is refused, and says to page by cursor.
    await expect(client.mutation(api.mcp.list, { offset: 5_000, limit: 1 })).rejects.toThrow(
      /page with `cursor`/,
    );

    // A rename moves what the concept is filed under; the counts hold.
    await client.mutation(api.mcp.update, { id: "ops/restart", new_id: "ops/restart-queue" });
    expect(ids(await client.mutation(api.mcp.list, { tag: "queue" }))).toEqual([
      "arch/queue",
      "ops/restart-queue",
    ]);
    expect(await citedBy(src.cite)).toEqual(["ops/restart-queue"]);
    st = await status();
    expect(st.by_tag).toMatchObject({ ops: 2, queue: 2 });

    // A retired citer no longer counts: the source is unread again.
    await client.mutation(api.mcp.update, { id: "ops/restart-queue", status: "deprecated" });
    const listed = (await client.mutation(api.mcp.getSource, {})) as {
      sources: { id: string; unread: boolean }[];
    };
    expect(listed.sources.find((s) => s.id === src.id)?.unread).toBe(true);
    expect(await citedBy(src.cite)).toEqual([]);

    // A delete takes its counts with it.
    await client.mutation(api.mcp.remove, { id: "arch/queue" });
    st = await status();
    expect(st.by_type.Decision).toBeUndefined();
    expect(st.by_tag).toMatchObject({ queue: 1 });
  },
  60_000,
);

run("a concept body holds 16 KB", async () => {
  const { client } = freeLibrary("body");
  await expect(
    client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "b/long",
      title: "Long",
      body: "w".repeat(16_500),
    }),
  ).rejects.toThrow(/concept body is over 16 KB/);
});

run(
  "history keeps a concept's last 100 revisions, and a write that changes nothing keeps none",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token } = runDev("dev:issueTestAccessToken", {
      email: `limits-revisions-${Date.now()}@example.com`,
      plan: "individual",
    });
    client.setAuth(token);
    // A full catalog record, so no cataloging revision comes between the writes.
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "r/one",
      title: "One",
      description: "A concept rewritten many times.",
      tags: ["history"],
      body: "version 0",
    });
    for (let i = 1; i <= 104; i++) {
      await client.mutation(api.mcp.update, { id: "r/one", body: `version ${i}` });
    }
    const revisions = async () =>
      (await client.mutation(api.mcp.history, { id: "r/one", limit: 100 })).revisions as {
        revision: string;
      }[];
    let revs = await revisions();
    expect(revs).toHaveLength(100);
    expect(revs[0]?.revision).toBe("105");
    expect(revs.at(-1)?.revision).toBe("6");
    await expect(client.mutation(api.mcp.history, { id: "r/one", revision: "5" })).rejects.toThrow(
      /revision not found/,
    );

    // The same body again: nothing changed, so no revision.
    await client.mutation(api.mcp.update, { id: "r/one", body: "version 104" });
    revs = await revisions();
    expect(revs[0]?.revision).toBe("105");
  },
  120_000,
);

run(
  "a file nothing holds is deleted after a day, an attached one stays, and no library attaches another's",
  async () => {
    const a = freeLibrary("prune-a");
    const b = freeLibrary("prune-b");
    const from = Date.now() - 1_000;
    const kept = await uploadText(a.client, "kept.txt", "Kept: attached to a source.");
    const dropped = await uploadText(a.client, "dropped.txt", "Dropped: never attached.");
    const src = (await a.client.mutation(api.mcp.addSource, {
      storage_id: kept,
      filename: "kept.txt",
      title: "kept.txt",
    })) as { id: string };
    // Another library's file is no upload of this one's, even by its storage id.
    await expect(
      b.client.mutation(api.mcp.addSource, { storage_id: kept, filename: "kept.txt" }),
    ).rejects.toThrow(/no uploaded file/);
    // A day on (the window reaches past now): the file nothing holds goes, the attached one stays.
    runDev("sources:pruneUnattached", { from, to: Date.now() + 1_000 });
    await expect(
      a.client.mutation(api.mcp.addSource, { storage_id: dropped, filename: "dropped.txt" }),
    ).rejects.toThrow(/no uploaded file/);
    const read = (await a.client.mutation(api.mcp.getSource, { ref: `source:${src.id}` })) as {
      download_url?: string;
    };
    expect(read.download_url).toMatch(/\/files\//);
    expect((await fetch(read.download_url as string)).status).toBe(200);
  },
  60_000,
);

run(
  "Stripe's events: a payment that hasn't settled waits, another subscription changes nothing, and an overdue one pauses pay-as-you-go",
  async () => {
    const { client, workspaceId } = freeLibrary("stripe", true);
    const plan = async () => {
      const s = (await client.mutation(api.mcp.status, {})) as {
        plan?: string;
        index_credits?: { pay_as_you_go_paused?: true };
      };
      return { plan: s.plan, paused: s.index_credits?.pay_as_you_go_paused ?? false };
    };
    const sub = "sub_e2e_current";
    // Checkout done, the bank debit not settled: the ids are kept, the plan waits.
    runDev("billing:activate", {
      workspaceId,
      plan: "individual",
      customerId: "cus_e2e",
      subscriptionId: sub,
      paid: false,
    });
    expect(await plan()).toEqual({ plan: "free", paused: false });
    runDev("billing:setStatus", {
      workspaceId,
      subscriptionId: sub,
      status: "active",
      plan: "individual",
    });
    expect(await plan()).toEqual({ plan: "individual", paused: false });
    // An old subscription ending is not this library's: nothing changes.
    runDev("billing:setStatus", { workspaceId, subscriptionId: "sub_e2e_old", status: "canceled" });
    expect(await plan()).toEqual({ plan: "individual", paused: false });
    // A failed renewal keeps the plan while Stripe retries the card; pay-as-you-go waits.
    await client.mutation(api.workspaces.setPayAsYouGo, { enabled: true });
    runDev("billing:setStatus", {
      workspaceId,
      subscriptionId: sub,
      status: "past_due",
      plan: "individual",
    });
    expect(await plan()).toEqual({ plan: "individual", paused: true });
    runDev("billing:setStatus", {
      workspaceId,
      subscriptionId: sub,
      status: "active",
      plan: "individual",
    });
    expect(await plan()).toEqual({ plan: "individual", paused: false });
  },
  60_000,
);

run(
  "a read counts what it reads, called straight on Convex too, and past the ceiling it waits",
  async () => {
    const { client, workspaceId } = freeLibrary("reads");
    for (let i = 0; i < 20; i++) {
      await client.mutation(api.mcp.ingest, {
        type: "Note",
        id: `big/note-${i}`,
        title: `Note ${i}`,
        description: "A long note.",
        tags: ["long"],
        body: `Note ${i}. ${"Words that fill the body. ".repeat(600)}`,
      });
    }
    const callsLeft = async () =>
      ((await client.mutation(api.mcp.status, {})) as { monthly: { calls: { left: number } } })
        .monthly.calls.left;
    // A small read counts once (this client calls Convex directly, with the agent's token).
    const first = await callsLeft();
    expect(first - (await callsLeft())).toBe(1);
    // An export page reads 20 concepts with their bodies, about 1 MB: it counts by the 256 KB.
    const before = await callsLeft();
    await client.mutation(api.concepts.exportPage, { cursor: null });
    const counted = before - (await callsLeft()) - 1;
    expect(counted).toBeGreaterThanOrEqual(3);
    expect(counted).toBeLessThanOrEqual(6);
    // Past the month's calls, the next read waits.
    runDev("dev:drainMonthly", { workspaceId, which: "calls" });
    await expect(client.mutation(api.mcp.list, {})).rejects.toThrow(/used its calls/);
  },
  120_000,
);

run(
  "list pages by cursor through a whole library, filtered or not; get_concept reads 20 at once",
  async () => {
    const { client, workspaceId } = freeLibrary("pages");
    // Individual writes 300 a minute: 130 concepts in a few seconds fit.
    runDev("dev:setPlan", { workspaceId, plan: "individual" });
    const ids: string[] = [];
    for (let i = 0; i < 130; i++) {
      const id = `page/c-${String(i).padStart(3, "0")}`;
      ids.push(id);
      await client.mutation(api.mcp.ingest, {
        type: i % 2 ? "Note" : "Decision",
        id,
        title: `Concept ${i}`,
        description: "One of many.",
        tags: ["paged"],
        body: `Concept ${i}.`,
      });
    }
    const walk = async (filters: { type?: string; shelf?: string }) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { concepts: { id: string }[]; cursor: string | null } = await client.mutation(
          api.mcp.listPage,
          { ...filters, limit: 50, cursor },
        );
        seen.push(...page.concepts.map((c) => c.id));
        cursor = page.cursor;
      } while (cursor);
      return seen;
    };
    // By id, and led by the type's facet: every concept once, in id order.
    expect(await walk({ shelf: "page" })).toEqual(ids);
    expect(await walk({ type: "Note" })).toEqual(ids.filter((_, i) => i % 2));
    // The first page by offset matches the first page by cursor.
    const byOffset = await client.mutation(api.mcp.list, { shelf: "page", limit: 50 });
    expect(byOffset.map((c) => c.id)).toEqual(ids.slice(0, 50));
    // Offsets stop at 500: past them, the error names the cursor.
    await expect(client.mutation(api.mcp.list, { offset: 480, limit: 50 })).rejects.toThrow(
      /cursor/,
    );
    // Twenty at once, as they are; one that isn't there says so.
    const many = await client.mutation(api.mcp.getMany, {
      ids: [...ids.slice(0, 19), "page/none"],
    });
    expect(many.concepts.map((c) => c.id)).toEqual(ids.slice(0, 19));
    expect(many.missing).toEqual(["page/none"]);
    await expect(client.mutation(api.mcp.getMany, { ids: ids.slice(0, 21) })).rejects.toThrow(
      /at most 20/,
    );
    // The migrations for this change run, and run again, cleanly.
    runDev("migrations:indexPaths", {});
    runDev("migrations:dropSearchText", {});
  },
  180_000,
);

run(
  "a concept Libro couldn't catalog waits, and the daily job catalogs it once Jev answers and credits allow",
  async () => {
    const { client, workspaceId } = freeLibrary("retry");
    const state = (cid: string) => runDev("dev:catalogState", { workspaceId, cid });
    /** Its cataloging once no job is in flight. */
    const settled = async (cid: string) => {
      for (let i = 0; i < 40; i++) {
        const s = state(cid);
        if (s && !s.inFlight) return s;
        await sleep(500);
      }
      return state(cid);
    };
    const used = async () => (await client.mutation(api.mcp.status, {})).index_credits?.used;
    const body = "Jev picks this sentence as the summary. The rest is detail.";

    // Jev is down for it (the fake gateway fails "jev-flaky" once): it waits,
    // and its credit comes back.
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "retry/outage",
      title: "Jev jev-flaky outage",
      body,
    });
    expect(await settled("retry/outage")).toMatchObject({ waiting: true, cataloged: false });
    expect(await used()).toBe(0);
    // The daily job: Jev answers, and it's cataloged for one credit.
    runDev("indexation:resumeWaiting", {});
    expect(await settled("retry/outage")).toMatchObject({ waiting: false, cataloged: true });
    expect(await used()).toBe(1);

    // Out of credits: the next waits, and the daily job passes it over for free.
    runDev("dev:setIndexUsage", { workspaceId, used: 200 });
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "retry/credits",
      title: "Jev waits for credits",
      body,
    });
    expect(await settled("retry/credits")).toMatchObject({ waiting: true, cataloged: false });
    runDev("indexation:resumeWaiting", {});
    expect(await settled("retry/credits")).toMatchObject({ waiting: true, cataloged: false });
    expect(await used()).toBe(200);
    // Credits renew: the daily job catalogs it.
    runDev("dev:setIndexUsage", { workspaceId, used: 0 });
    runDev("indexation:resumeWaiting", {});
    expect(await settled("retry/credits")).toMatchObject({ waiting: false, cataloged: true });

    // Jev answered but found nothing to pick: not asked again, which would
    // pay for the same answer twice.
    await client.mutation(api.mcp.ingest, {
      type: "Note",
      id: "retry/none",
      title: "A plain note",
      body,
    });
    expect(await settled("retry/none")).toMatchObject({ waiting: false, cataloged: false });
  },
  90_000,
);
