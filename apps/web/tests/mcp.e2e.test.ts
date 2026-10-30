/**
 * Hosted librocat end-to-end: drive the remote MCP (the Next.js /mcp route on
 * top of Convex) with the official MCP client over Streamable HTTP.
 *
 * Opt-in — it needs a running stack (docs/cloud.md §Local development). The
 * discovery test needs only the URL; the tool tests need an OAuth access
 * token, which dev:issueTestAccessToken signs for a fixture user (the
 * deployment needs LIBROCAT_E2E=1):
 *   LIBROCAT_MCP_URL=http://localhost:3000/mcp \
 *   LIBROCAT_MCP_TOKEN=$(pnpm exec convex run dev:issueTestAccessToken '{"plan":"individual"}' | jq -r .token) \
 *   pnpm test
 * With LIBROCAT_FAKE_GATEWAY=1 it also expects the fake AI gateway
 * (`node tests/fake-gateway.ts`) on :8787, and checks that automatic indexation
 * spends a credit when Jev catalogs a concept, and gives it back when Jev
 * can pick nothing.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import sharp from "sharp";
import { expect, test } from "vitest";

const url = process.env.LIBROCAT_MCP_URL;
const token = process.env.LIBROCAT_MCP_TOKEN;
const fakeGateway = process.env.LIBROCAT_FAKE_GATEWAY === "1";
const run = url && token ? test : test.skip;
const runDiscovery = url ? test : test.skip;
// A second library for the token's user needs the CLI on the same deployment.
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD;
const runLibraries = url && token && cliCwd ? test : test.skip;

async function connect(bearer: string, library?: string) {
  const endpoint = new URL(url as string);
  if (library) endpoint.searchParams.set("library", library);
  const client = new Client({ name: "cloud-e2e", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
}

// biome-ignore lint/suspicious/noExplicitAny: test assertions poke freely at parsed JSON
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError).toBeFalsy();
  return JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

run("a bad token is refused with 401", async () => {
  await expect(connect("not-a-token")).rejects.toThrow();
});

// What an agent does before its first tool call: follow the 401 to the
// protected-resource metadata, then to the authorization server, then
// register itself. The browser sign-in and consent come after this.
runDiscovery("an agent without a token is sent through OAuth discovery", async () => {
  const res = await fetch(url as string, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0" },
      },
    }),
  });
  expect(res.status).toBe(401);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(
    res.headers.get("www-authenticate") ?? "",
  )?.[1];
  expect(metadataUrl).toBeTruthy();

  const prm = await (await fetch(metadataUrl as string)).json();
  expect(prm.resource).toBe(url);
  const issuer = prm.authorization_servers[0] as string;
  const asMetadata = await (
    await fetch(
      new URL(`/.well-known/oauth-authorization-server${new URL(issuer).pathname}`, issuer),
    )
  ).json();
  expect(asMetadata.issuer).toBe(issuer);
  expect(asMetadata.code_challenge_methods_supported).toContain("S256");
  expect(asMetadata.registration_endpoint).toBeTruthy();

  // Dynamic client registration: a public client, no secret (PKCE instead).
  const reg = await fetch(asMetadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "librocat e2e discovery",
      redirect_uris: ["http://127.0.0.1:33418/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(reg.status).toBeLessThan(300);
  const client = await reg.json();
  expect(client.client_id).toBeTruthy();
  expect(client.client_secret).toBeUndefined();
});

run(
  "the hosted tool surface works end to end over Streamable HTTP",
  async () => {
    const client = await connect(token as string);
    expect(client.getServerVersion()?.name).toBe("librocat");

    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_source",
      "decide",
      "delete",
      "files_changed",
      "get_concept",
      "get_source",
      "graph",
      "ingest",
      "list",
      "propose",
      "review_shelf",
      "search",
      "set_term",
      "status",
      "thesaurus",
      "update",
    ]);

    const stamp = Date.now();
    const a = `e2e/${stamp}/decision`;
    const b = `e2e/${stamp}/note`;
    const before = await call(client, "status", {});
    expect(before.backend).toBe("convex");
    expect(before.index_credits.included).toBeGreaterThanOrEqual(0);

    await call(client, "ingest", {
      type: "Decision",
      id: a,
      title: "Use Convex for the hosted index",
      description: "The Cloud tier stores concepts in Convex with a search index.",
      body: `# Decision\nConvex.\n\nSee [the note](/${b}.md).`,
      tags: ["convex", "cloud"],
      status: "draft",
    });
    // No description, no tags: the writer left the catalog record blank.
    // Batch form: one call, one result per item; a bad item never blocks the rest.
    const batch = await call(client, "ingest", {
      concepts: [
        { type: "Note", id: b, title: "Kickoff", body: "We chose Convex." },
        { type: "Note", id: "thesaurus", title: "Reserved id" },
      ],
    });
    expect(batch.written).toBe(1);
    expect(batch.results[0].result.id).toBe(b);
    expect(batch.results[1].ok).toBe(false);

    const hits = await call(client, "search", { query: "convex hosted index" });
    expect(hits.some((h: { id: string }) => h.id === a)).toBe(true);

    const full = await call(client, "get_concept", { id: a });
    expect(full.status).toBe("draft");
    expect(full.access_count).toBeGreaterThanOrEqual(1);
    expect(full.links.outbound.map((o: { id: string }) => o.id)).toEqual([b]);
    expect((await call(client, "get_concept", { id: b })).links.inbound).toEqual([
      { id: a, title: "Use Convex for the hosted index", exists: true },
    ]);

    const g = await call(client, "graph", { id: a, depth: 2 });
    expect(g.nodes.map((n: { id: string }) => n.id).sort()).toEqual([a, b].sort());
    const drafts = await call(client, "list", { status: "draft", limit: 500 });
    expect(drafts.map((c: { id: string }) => c.id)).toContain(a);

    await call(client, "update", { id: a, status: "stable" });
    expect((await call(client, "get_concept", { id: a })).status).toBe("stable");

    // Code links over the wire: a concept that names its code comes up for
    // review when that code changes.
    await call(client, "update", { id: a, sources: [`e2e/${stamp}/src/index.ts`] });
    const changed = await call(client, "files_changed", {
      paths: [`e2e/${stamp}/src/index.ts`],
      commit: "e2e",
    });
    expect(changed.marked).toEqual([{ id: a, sources: [`e2e/${stamp}/src/index.ts`] }]);
    expect((await call(client, "get_concept", { id: a })).stale).toBe(true);

    // A move is an `update` with `new_id`; the other fields land at the new id.
    const renamed = await call(client, "update", {
      id: b,
      new_id: `${b}-2`,
      title: "Kickoff call",
    });
    expect(renamed.id).toBe(`${b}-2`);
    expect(renamed.relinked).toBe(1);
    expect((await call(client, "get_concept", { id: `${b}-2` })).title).toBe("Kickoff call");
    const relinked = await call(client, "get_concept", { id: a });
    expect(relinked.links.outbound.map((o: { id: string }) => o.id)).toEqual([`${b}-2`]);

    const bad = await client.callTool({
      name: "ingest",
      arguments: { type: "Note", status: "nope" },
    });
    expect(bad.isError).toBe(true);
    const huge = await call(client, "ingest", { type: "Note", body: "x".repeat(70_000) });
    expect(huge.error).toContain("16 KB");

    // Library science over the wire: thesaurus (normalizes tags on write,
    // expands queries), supersession, weeding report, finding aids.
    await call(client, "set_term", {
      tag: "convex",
      use_for: ["convexdb"],
      narrower: ["scheduler"],
    });
    expect((await call(client, "thesaurus", {})).convex.use_for).toEqual(["convexdb"]);
    const c = `e2e/${stamp}/synonym`;
    await call(client, "ingest", {
      type: "Note",
      id: c,
      title: "Scheduler notes",
      description: "How the Convex scheduler runs jobs.",
      tags: ["ConvexDB", "scheduler"],
      body: "scheduler details",
    });
    expect((await call(client, "get_concept", { id: c })).tags).toEqual(["convex", "scheduler"]);
    await call(client, "update", { id: a, superseded_by: c });
    const retired = await call(client, "get_concept", { id: a });
    expect(retired.status).toBe("deprecated");
    expect(retired.superseded_by).toBe(c);
    const ranked = await call(client, "search", { query: "convex", limit: 50 });
    const rankedIds = ranked.map((h: { id: string }) => h.id);
    expect(rankedIds.indexOf(c)).toBeLessThan(rankedIds.indexOf(a)); // deprecated sinks
    const { weeding: weed } = await call(client, "review_shelf", { days: 90, limit: 100 });
    expect(weed.deprecated).toContain(a);
    expect(weed.counts.deprecated).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(weed.never_retrieved)).toBe(true);
    expect(weed.never_retrieved).not.toContain(c); // too young to count as never retrieved
    expect(weed.most_retrieved.some((m: { id: string }) => m.id === a)).toBe(true);
    // The hosted guards: reserved thesaurus id, canonical ids, missing supersession target.
    expect((await call(client, "ingest", { type: "Note", id: "thesaurus" })).error).toContain(
      "thesaurus",
    );
    expect((await call(client, "update", { id: a, superseded_by: "e2e/nope" })).error).toContain(
      "not found",
    );
    const canon = await call(client, "ingest", {
      type: "Note",
      id: `e2e/${stamp}/x/../canon`,
      description: "Canonical id check.",
      tags: ["e2e"],
      body: "z",
    });
    expect(canon.id).toBe(`e2e/${stamp}/canon`);
    const facet = await call(client, "search", { query: "scheduler", tag: "ConvexDB", limit: 10 });
    expect(facet.map((h: { id: string }) => h.id)).toContain(c);
    const aid = await call(client, "list", { format: "markdown", dir: `e2e/${stamp}` });
    expect(aid.aids.some((x: { markdown: string }) => x.markdown.includes(`(/${c}.md)`))).toBe(
      true,
    );
    await call(client, "update", { id: a, status: "stable" }); // back to live for the rest

    // History: create → update → the "commit log" of the hosted tier, and a
    // past revision is readable (the sources, `files_changed`, and status
    // writes above are the updates). Then weed the concept out.
    const { history } = await call(client, "get_concept", { id: a, history: true });
    expect(history.map((r: { kind: string }) => r.kind)).toEqual([
      "update",
      "update",
      "update",
      "update",
      "update",
      "create",
    ]);
    const first = await call(client, "get_concept", { id: a, revision: history[5].revision });
    expect(first.revision.frontmatter.status).toBe("draft");
    expect(first.revision.body).toContain("Convex");
    const renamedHistory = await call(client, "get_concept", { id: `${b}-2`, history: true });
    const kinds = renamedHistory.history.map((r: { kind: string }) => r.kind);
    expect(kinds).toContain("rename"); // the indexer may have added "index" on top by now
    expect(kinds).toContain("create");
    expect(await call(client, "delete", { id: a })).toEqual({ deleted: a });
    expect((await call(client, "get_concept", { id: a })).error).toContain("not found");
    const missing = await call(client, "get_concept", { id: a, history: true });
    expect(missing.error).toContain("not found");

    if (fakeGateway) {
      // Jev catalogs from the concept's own words: a sentence of its body as
      // the description, tags from the library's vocabulary. Nothing is written.
      const j = `e2e/${stamp}/jev`;
      await call(client, "ingest", {
        type: "Note",
        id: j,
        title: "Jev path",
        body: "Jev picks this sentence as the concept summary. The rest is detail.",
      });
      let viaJev: {
        description: string | null;
        tags: string[];
        indexed_at: number | null;
        frontmatter: { cataloged?: Record<string, unknown> };
      } | null = null;
      for (let i = 0; i < 20 && !viaJev?.indexed_at; i++) {
        await sleep(500);
        viaJev = await call(client, "get_concept", { id: j });
      }
      expect(viaJev?.description).toBe("Jev picks this sentence as the concept summary.");
      expect(viaJev?.tags).toHaveLength(2);
      // Selected, not written: transcribed from the concept, tags from the vocabulary.
      expect(viaJev?.frontmatter.cataloged).toMatchObject({
        description: "transcribed",
        tags: "selected",
        by: ["typesafe-ai/jev"],
      });

      // What Jev can't pick stays blank, for the agent to write, and its
      // credit comes back: only the concept Jev cataloged spent one.
      const blank = await call(client, "get_concept", { id: `${b}-2` });
      expect(blank.description ?? null).toBeNull();
      expect(blank.tags).toEqual([]);
      expect(blank.indexed_at).toBeNull();
      const after = await call(client, "status", {});
      expect(after.index_credits.used).toBe(before.index_credits.used + 1);

      // Once a writer sets a field the cataloger filled, it is the writer's.
      await call(client, "update", { id: j, tags: ["mine"] });
      const owned = await call(client, "get_concept", { id: j });
      expect(owned.frontmatter.cataloged.tags).toBeUndefined();
      expect(owned.frontmatter.cataloged.description).toBe("transcribed");
    }

    // Libro's review shelf, worked by the agent: it drafts a merge, and on
    // the person's yes carries it out.
    const older = `e2e/${stamp}/deploy`;
    const newer = `e2e/${stamp}/deploy-current`;
    for (const [id, title] of [
      [older, "Deploy steps"],
      [newer, "Deploy steps, current"],
    ]) {
      await call(client, "ingest", {
        type: "Runbook",
        id,
        title,
        description: "How to deploy.",
        tags: ["deploy"],
        body: "Push to main.",
      });
    }
    const filed = await call(client, "propose", {
      kind: "merge",
      subject: older,
      target: newer,
      reason: "One runbook, told twice.",
      draft: {
        title: "Deploy steps",
        description: "How to deploy.",
        tags: ["deploy"],
        body: "Push to main; CI deploys it.",
      },
    });
    expect(filed.filed).toBe(true);
    const shelf = await call(client, "review_shelf", { kind: "merge" });
    const merge = shelf.proposals.find((p: { subject: string }) => p.subject === older);
    expect(merge).toMatchObject({ kind: "merge", target: newer, by: "agent" });
    expect(await call(client, "decide", { id: merge.id, decision: "approve" })).toEqual({
      status: "approved",
    });
    expect((await call(client, "get_concept", { id: newer })).body).toContain("CI deploys it");
    expect((await call(client, "get_concept", { id: older })).superseded_by).toBe(newer);
    expect((await call(client, "decide", { id: "nope", decision: "approve" })).error).toContain(
      "no proposal",
    );

    // A credential is refused, with what to store instead.
    const secret = await call(client, "ingest", {
      type: "Note",
      id: `e2e/${stamp}/keys`,
      title: "Keys",
      body: `The live key is ${"sk_live_"}${"x".repeat(24)}.`,
    });
    expect(secret.error).toContain("never stores secrets");
    await client.close();
  },
  60_000,
);

run(
  "source copies: kept, read by part and by passage, cited, replaced, and deleted",
  async () => {
    const client = await connect(token as string);
    const tag = Date.now().toString(36);
    const filler = "Filler about something else entirely. ".repeat(40).trim();
    const text = [
      `# Refund policy ${tag}`,
      "Customers may ask for a refund within 30 days of purchase.",
      ...Array(20).fill(filler),
      `The zebra clause ${tag}: refunds go back to the original card.`,
    ].join("\n\n");
    const url = `https://example.com/refunds-${tag}#top`;
    const kept = await call(client, "add_source", {
      title: `Refund policy ${tag}`,
      text,
      location: url,
    });
    expect(kept.cite).toBe(`https://example.com/refunds-${tag}`);
    expect(kept.kind).toBe("html");
    expect(kept.parts).toBeGreaterThan(1);
    // The same text again is the same copy.
    const again = await call(client, "add_source", { title: "Again", text, location: kept.cite });
    expect(again).toMatchObject({ id: kept.id, existing: true });

    // A concept cites it: get_concept lists the copy, and get_source names the concept.
    const cid = `e2e/${tag}/refunds`;
    await call(client, "ingest", {
      type: "Policy",
      id: cid,
      title: "Refunds",
      description: "Refunds within 30 days, back to the card.",
      body: "Refunds within 30 days.",
      sources: [kept.cite],
    });
    const concept = await call(client, "get_concept", { id: cid });
    expect(concept.stored_sources).toEqual([
      { cite: kept.cite, id: kept.id, title: `Refund policy ${tag}`, parts: kept.parts },
    ]);
    const first = await call(client, "get_source", { ref: kept.cite });
    expect(first).toMatchObject({ id: kept.id, part: 1, next_part: 2, cited_by: [cid] });
    expect(first.text).toContain("within 30 days");
    const last = await call(client, "get_source", { ref: `source:${kept.id}`, part: kept.parts });
    expect(last.text).toContain(`zebra clause ${tag}`);
    expect(last.next_part).toBeUndefined();
    expect(last.cited_by).toBeUndefined();
    expect((await call(client, "get_source", { ref: kept.id, part: 999 })).error).toMatch(
      /has parts 1 to/,
    );
    // Several parts in one read, and every source a page at a time (what `pull` does).
    const both = await call(client, "get_source", { ref: kept.id, part: 1, parts: 2 });
    expect(both).toMatchObject({ part: 1, to_part: 2 });
    expect(both.text.startsWith(first.text)).toBe(true);
    const everything = await call(client, "get_source", { cursor: "", limit: 200 });
    expect(everything.sources.map((s: { id: string }) => s.id)).toContain(kept.id);

    // Passages, in one source and across them all.
    let passages: { id: string; part: number; text: string }[] = [];
    for (let i = 0; i < 20 && passages.length === 0; i++) {
      passages = (await call(client, "get_source", { ref: kept.id, query: `zebra ${tag}` }))
        .passages;
      if (passages.length === 0) await sleep(250);
    }
    expect(passages[0]).toMatchObject({ id: kept.id, part: kept.parts });
    const across = await call(client, "get_source", { query: `zebra ${tag}` });
    expect(across.passages[0].id).toBe(kept.id);
    const listed = (await call(client, "get_source", {})).sources.find(
      (s: { id: string }) => s.id === kept.id,
    );
    expect(listed.unread).toBe(false);
    expect((await call(client, "status", {})).sources.count).toBeGreaterThanOrEqual(1);

    // The page changed: the copy is replaced, and the concept citing it comes up for review.
    const changed = await call(client, "add_source", {
      title: `Refund policy ${tag}`,
      text: text.replace("30 days", "14 days"),
      location: kept.cite,
    });
    expect(changed).toMatchObject({ id: kept.id, replaced: true, marked: [cid] });
    expect((await call(client, "get_concept", { id: cid })).stale).toBe(true);

    // Secrets are refused, with their line.
    const secret = await call(client, "add_source", {
      title: "Env",
      text: `A\nB\nSTRIPE=${"sk_live_"}${"y".repeat(24)}`,
    });
    expect(secret.error).toMatch(/line 3 looks like a Stripe secret key/);

    // Deleting it takes its text; the concept keeps its citation, which stops resolving.
    expect(await call(client, "delete", { id: `source:${kept.id}` })).toEqual({
      deleted: kept.id,
      cite: kept.cite,
    });
    expect((await call(client, "get_source", { ref: kept.cite })).error).toMatch(/no kept source/);
    expect((await call(client, "get_concept", { id: cid })).stored_sources).toEqual([]);
    await client.close();
  },
  60_000,
);

runLibraries("a library keeps source text up to its plan's cap", async () => {
  const sub = JSON.parse(
    Buffer.from((token as string).split(".")[1] as string, "base64url").toString(),
  ).sub as string;
  const setBytes = (bytes: number) =>
    spawnSync(
      "node_modules/.bin/convex",
      ["run", "dev:setSourceBytes", JSON.stringify({ userId: sub, bytes })],
      {
        cwd: cliCwd,
        env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
        encoding: "utf8",
      },
    ).status;
  // Individual keeps 5 GB of sources, files and text together.
  expect(setBytes(5_000_000_000 - 10)).toBe(0);
  try {
    const client = await connect(token as string);
    const full = await call(client, "add_source", {
      title: "One too many",
      text: `A note ${Date.now()} that does not fit.`,
    });
    expect(full.error).toMatch(
      /source text quota reached: this library keeps 5000\.0 MB of 5000\.0 MB/,
    );
    await client.close();
  } finally {
    setBytes(0);
  }
});

runLibraries(
  "the reading list keeps a saved page, and source watch flags the concepts when it changes",
  async () => {
    const sub = JSON.parse(
      Buffer.from((token as string).split(".")[1] as string, "base64url").toString(),
    ).sub as string;
    const tag = Date.now().toString(36);
    let page = `<title>Pricing ${tag}</title><nav>Menu</nav><main><p>Team costs $15 a person.</p></main>`;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pricing-${tag}`;
    try {
      const client = await connect(token as string);
      // A URL alone: librocat fetches it (the deployment allows this test's private address).
      const saved = await call(client, "add_source", { location: url });
      expect(saved).toMatchObject({ title: `Pricing ${tag}`, kind: "html", cite: url });
      const listed = (await call(client, "get_source", {})).sources.find(
        (s: { id: string }) => s.id === saved.id,
      );
      expect(listed.unread).toBe(true);
      expect((await call(client, "add_source", { title: "Nothing" })).error).toMatch(
        /pass `text`, a URL as `location`, or a file/,
      );

      const cid = `e2e/${tag}/pricing`;
      await call(client, "ingest", {
        type: "Fact",
        id: cid,
        title: "Team price",
        description: "Team costs $15 a person.",
        body: "Team costs $15 a person.",
        sources: [url],
      });
      // The page changes; source watch fetches it again and flags the concept.
      page = page.replace("$15", "$18");
      const watched = spawnSync(
        "node_modules/.bin/convex",
        ["run", "dev:watchSources", JSON.stringify({ userId: sub })],
        { cwd: cliCwd, env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" }, encoding: "utf8" },
      );
      expect(watched.status, watched.stderr).toBe(0);
      let stale = false;
      for (let i = 0; i < 40 && !stale; i++) {
        await sleep(250);
        stale = (await call(client, "get_concept", { id: cid })).stale;
      }
      expect(stale).toBe(true);
      expect((await call(client, "get_source", { ref: url, part: 1 })).text).toContain("$18");
      await call(client, "delete", { id: `source:${saved.id}` });
      await client.close();
    } finally {
      server.close();
    }
  },
  60_000,
);

runLibraries(
  "?library= on the MCP URL reaches another of the user's libraries, and only theirs",
  async () => {
    const sub = JSON.parse(
      Buffer.from((token as string).split(".")[1] as string, "base64url").toString(),
    ).sub as string;
    const made = spawnSync(
      "node_modules/.bin/convex",
      ["run", "dev:addLibrary", JSON.stringify({ userId: sub, name: "E2E second" })],
      { cwd: cliCwd, env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" }, encoding: "utf8" },
    );
    expect(made.status).toBe(0);
    const slug = JSON.parse(made.stdout) as string;
    expect(slug).toMatch(/^e2e-second-[a-z0-9]{6}$/);

    const plain = await connect(token as string);
    const second = await connect(token as string, slug);
    const id = `e2e/${Date.now()}/elsewhere`;
    await call(second, "ingest", { type: "Note", id, title: "Only in the second library" });
    expect((await call(second, "get_concept", { id })).title).toBe("Only in the second library");
    expect((await call(plain, "get_concept", { id })).error).toMatch(/not found/);
    const status = await call(second, "status", {});
    expect(status.library).toEqual({ name: "E2E second", slug, role: "admin" });
    expect(status.libraries.map((l: { slug: string }) => l.slug)).toContain(slug);

    const unknown = await connect(token as string, "not-a-library-000000");
    expect((await call(unknown, "status", {})).error).toMatch(
      /no library "not-a-library-000000" that you belong to/,
    );
  },
  60_000,
);

runLibraries(
  "a link to a PDF is kept as the PDF, and a site that refuses apps says what to do",
  async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.endsWith(".pdf")) {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(PDF);
      } else {
        // LinkedIn's answer to an app.
        res.writeHead(999);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tag = Date.now().toString(36);
    try {
      const client = await connect(token as string);
      const kept = await call(client, "add_source", { location: `${base}/report-${tag}.pdf` });
      expect(kept).toMatchObject({ kind: "pdf", cite: `${base}/report-${tag}.pdf` });
      const read = await whenRead(client, kept.cite);
      expect(read.status).toBe("ready");
      expect(read.text).toContain("Rotating the Stripe secret key");
      const refused = await client.callTool({
        name: "add_source",
        arguments: { location: `${base}/in/someone-${tag}` },
      });
      expect(JSON.stringify(refused.content)).toMatch(/doesn't let apps read its pages/);
      await call(client, "delete", { id: `source:${kept.id}` });
      await client.close();
    } finally {
      server.close();
    }
  },
  60_000,
);

/** An 8×8 green PNG, and a one-page PDF that says "Rotating the Stripe secret key". */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPQqzXCihiGlgQAlgM3QfcSdGIAAAAASUVORK5CYII=",
  "base64",
);
const PDF = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1Bh" +
    "Z2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVk" +
    "aWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4K" +
    "ZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2MSA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDcyIDcyMCBUZCAoUm90YXRpbmcgdGhlIFN0" +
    "cmlwZSBzZWNyZXQga2V5KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUx" +
    "IC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAg" +
    "biAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM1MiAwMDAw" +
    "MCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQyMgolJUVPRgo=",
  "base64",
);

/** Attach a file the way an agent without a shell does: an upload URL, the bytes, the storageId. */
async function attach(client: Client, name: string, type: string, bytes: Buffer, title: string) {
  const step1 = await call(client, "add_source", { file: { name, type, size: bytes.length } });
  expect(step1.upload_url).toMatch(/^https?:\/\//);
  const up = await fetch(step1.upload_url, {
    method: "POST",
    headers: { "Content-Type": step1.content_type },
    body: new Uint8Array(bytes),
  });
  expect(up.ok).toBe(true);
  const { storageId } = (await up.json()) as { storageId: string };
  return await call(client, "add_source", { storage_id: storageId, filename: name, title });
}

/** A kept source once librocat has read it. */
async function whenRead(client: Client, cite: string) {
  let src: { status?: string } = {};
  for (let i = 0; i < 60 && src.status !== "ready" && src.status !== "failed"; i++) {
    src = await call(client, "get_source", { ref: cite });
    if (src.status !== "ready") await sleep(250);
  }
  return src as Record<string, unknown> & { status?: string };
}

run(
  "files: attached in two steps, read, found by their title, and seen as an image",
  async () => {
    const client = await connect(token as string);
    const tag = Date.now().toString(36);
    const picture = await attach(
      client,
      `pipeline-${tag}.png`,
      "image/png",
      PNG,
      `Release pipeline diagram ${tag}`,
    );
    expect(picture).toMatchObject({
      status: "processing",
      kind: "image",
      file: { name: `pipeline-${tag}.png`, mime: "image/png", bytes: PNG.length },
    });
    const read = await whenRead(client, picture.cite);
    expect(read.status).toBe("ready");
    const media = read.media as { mime: string; download_url: string }[];
    expect(media[0]).toMatchObject({ mime: "image/png" });
    expect(
      Buffer.from(await (await fetch(media[0]?.download_url as string)).arrayBuffer()),
    ).toEqual(PNG);
    // A picture comes back as an image too, for an agent that reads images.
    const raw = (await client.callTool({
      name: "get_source",
      arguments: { ref: picture.cite },
    })) as {
      content: { type: string; mimeType?: string }[];
    };
    expect(raw.content.find((c) => c.type === "image")).toMatchObject({ mimeType: "image/png" });

    // Search finds the picture by its title, in any form of its words, after the concepts.
    let hits: { id: string; type?: string; part?: number; file?: { mime: string } }[] = [];
    for (let i = 0; i < 40; i++) {
      hits = await call(client, "search", { query: `releasing pipelines diagrams ${tag}` });
      if (hits.some((h) => h.type === "Source")) break;
      await sleep(250);
    }
    expect(hits.find((h) => h.type === "Source")).toMatchObject({
      id: picture.cite,
      part: 1,
      file: { mime: "image/png" },
    });
    // Concepts only, when asked.
    const conceptsOnly = await call(client, "search", {
      query: `release pipeline diagram ${tag}`,
      sources: false,
    });
    expect(conceptsOnly.some((h: { type?: string }) => h.type === "Source")).toBe(false);

    // The same file again is the same source.
    const again = await attach(client, `copy-${tag}.png`, "image/png", PNG, "Again");
    expect(again).toMatchObject({ id: picture.id, existing: true });

    // A PDF: librocat reads its text, so a passage quotes it.
    const pdf = await attach(
      client,
      `runbook-${tag}.pdf`,
      "application/pdf",
      PDF,
      `Runbook ${tag}`,
    );
    const pdfRead = await whenRead(client, pdf.cite);
    expect(pdfRead.status).toBe("ready");
    expect(pdfRead.text).toContain("Rotating the Stripe secret key");

    // Bigger than the plan's largest file: refused before any upload.
    const huge = await call(client, "add_source", {
      file: { name: "manual.pdf", type: "application/pdf", size: 300_000_000 },
    });
    expect(huge.error).toMatch(/attaches files of up to 200\.0 MB/);
    // Text and pictures only: a recording or another binary is refused, with what to keep instead.
    const talk = await call(client, "add_source", {
      file: { name: "talk.mp4", type: "video/mp4", size: 5_000_000 },
    });
    expect(talk.error).toMatch(/not video\/mp4 files: .*for a recording, its transcript/);
    const memo = await call(client, "add_source", {
      file: { name: "memo.m4a", size: 900_000 },
    });
    expect(memo.error).toMatch(/keeps text and pictures/);
    const zip = await call(client, "add_source", {
      file: { name: "bundle.zip", type: "application/zip", size: 1_000 },
    });
    expect(zip.error).toMatch(/keeps text and pictures/);

    // Deleting a source deletes its file.
    expect(await call(client, "delete", { id: picture.cite })).toMatchObject({
      deleted: picture.id,
    });
    expect((await fetch(media[0]?.download_url as string)).status).toBe(404);
    await call(client, "delete", { id: pdf.cite });
    await client.close();
  },
  60_000,
);

run(
  "review_shelf lists what's missing, a question no concept answered and a file no concept cites, until the work is done",
  async () => {
    const client = await connect(token as string);
    // A made-up word, so only this test's question and file carry it.
    const w = `zm${Date.now().toString(36)}`;
    // Only made-up words, so no other test's concept answers it.
    const question = `${w} cadence`;
    expect((await call(client, "search", { query: question })).length).toBe(0);
    const kept = await call(client, "add_source", {
      title: `${w} rotation notes`,
      text: `The ${w} keys rotate every quarter.`,
    });
    const before = await call(client, "review_shelf", {});
    const asked = before.missing.questions.find((q: { text: string }) => q.text === question);
    expect(asked).toMatchObject({ asked: 1, last_asked: expect.any(Number) });
    const file = before.missing.files.find((f: { cite: string }) => f.cite === `source:${kept.id}`);
    expect(file).toMatchObject({ title: `${w} rotation notes`, added: expect.any(Number) });
    // One kind of proposal only: no missing.
    expect((await call(client, "review_shelf", { kind: "merge" })).missing).toBeUndefined();
    // The work done: a concept from the file, citing it, then the question asked again.
    await call(client, "ingest", {
      type: "Runbook",
      id: `e2e/${w}/rotation`,
      title: `The ${w} cadence`,
      description: `The ${w} keys rotate every quarter: that's the ${w} cadence.`,
      body: `Rotate the ${w} keys every quarter.`,
      sources: [file.cite],
    });
    expect((await call(client, "search", { query: question })).length).toBeGreaterThan(0);
    const after = await call(client, "review_shelf", {});
    expect(after.missing.questions.map((q: { text: string }) => q.text)).not.toContain(question);
    expect(after.missing.files.map((f: { cite: string }) => f.cite)).not.toContain(file.cite);
  },
  60_000,
);

run(
  "a new concept that rewords an existing one returns it in possible_duplicates",
  async () => {
    const client = await connect(token as string);
    // A made-up word, so only this test's concepts share it.
    const w = `zq${Date.now().toString(36)}`;
    const keys = `e2e/${w}/keys`;
    const drain = `e2e/${w}/drain`;
    await call(client, "ingest", {
      type: "Runbook",
      id: keys,
      title: `Rotating the ${w} signing keys`,
      description: "Replace the signing keys every quarter.",
      tags: ["e2e"],
      body: "Generate, publish, then retire the old key.",
    });
    // A synonym through the thesaurus: the new concept says "swarm" for the "fleet" tag.
    await call(client, "set_term", { tag: `${w}fleet`, use_for: [`${w}swarm`] });
    await call(client, "ingest", {
      type: "Runbook",
      id: drain,
      title: "Draining nodes",
      description: "Move the work off a node before it stops.",
      tags: [`${w}fleet`],
      body: "Cordon, drain, stop.",
    });

    // The same subject in other words: it shares a stem ("rotate", "key").
    const reworded = await call(client, "ingest", {
      type: "Runbook",
      title: `How to rotate ${w} keys`,
      body: "Make a new key, publish it, retire the old one.",
    });
    expect(reworded.possible_duplicates.find((d: { id: string }) => d.id === keys)).toEqual({
      id: keys,
      title: `Rotating the ${w} signing keys`,
      description: "Replace the signing keys every quarter.",
    });
    expect(reworded.possible_duplicates.map((d: { id: string }) => d.id)).not.toContain(
      reworded.id,
    );
    const synonym = await call(client, "ingest", { type: "Note", title: `${w}swarm upkeep` });
    expect(synonym.possible_duplicates.map((d: { id: string }) => d.id)).toContain(drain);

    // A write to an existing concept is not a new one: no lookup.
    const updated = await call(client, "update", { id: reworded.id, title: `Rotating ${w} keys` });
    expect(updated.possible_duplicates).toBeUndefined();
    const overwritten = await call(client, "ingest", {
      type: "Runbook",
      id: keys,
      title: `Rotating the ${w} signing keys`,
    });
    expect(overwritten.possible_duplicates).toBeUndefined();

    for (const id of [keys, drain, reworded.id, synonym.id]) await call(client, "delete", { id });
    await client.close();
  },
  60_000,
);

run(
  "files code reads or converts: a spreadsheet read as CSV, a WebP kept as a JPEG too",
  async () => {
    const client = await connect(token as string);
    const tag = Date.now().toString(36);
    const sheet = await attach(
      client,
      `budget-${tag}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      readFileSync(join(import.meta.dirname, "fixtures/office/budget.xlsx")),
      `Budget ${tag}`,
    );
    expect(sheet).toMatchObject({ kind: "sheet" });
    const sheetRead = await whenRead(client, sheet.cite);
    expect(sheetRead.status).toBe("ready");
    expect(sheetRead.text).toContain('Servers,1250.5,"Convex, Vercel, ""AI Gateway"""');

    // A WebP: converted to a JPEG kept beside it, which the dashboard and an agent can show.
    const webp = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#22aa66" },
    })
      .webp()
      .toBuffer();
    const photo = await attach(client, `photo-${tag}.webp`, "image/webp", webp, `Photo ${tag}`);
    const photoRead = await whenRead(client, photo.cite);
    expect(photoRead.status).toBe("ready");
    expect(photoRead.error).toBeUndefined();
    const media = photoRead.media as { mime: string; download_url: string }[];
    expect(media.map((m) => m.mime)).toEqual(["image/jpeg"]);
    const jpeg = Buffer.from(await (await fetch(media[0]?.download_url as string)).arrayBuffer());
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
    // Deleting the source deletes the converted picture too.
    await call(client, "delete", { id: photo.cite });
    expect((await fetch(media[0]?.download_url as string)).status).toBe(404);
    await call(client, "delete", { id: sheet.cite });
    await client.close();
  },
  60_000,
);
