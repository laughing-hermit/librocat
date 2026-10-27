/**
 * The pure core, `@librocat/core/format`: the one implementation both tiers
 * run. These tests are the contract Cloud inherits, so a Convex row and an
 * OKF file behave the same.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  assertNoSecrets,
  bfsGraph,
  buildFrontmatter,
  canonicalId,
  checkStatus,
  conceptLink,
  coversPath,
  demoteDeprecated,
  deriveConceptId,
  dump,
  extractLinks,
  findSecret,
  isReservedId,
  isStale,
  libraryStats,
  makeSnippet,
  markChanged,
  matchesFilters,
  normalizeSegments,
  OKFError,
  parse,
  pathFacetOf,
  pathsAbove,
  retargetLinks,
  slugify,
  sourcesOf,
  weedRules,
  withSources,
} from "../src/format.ts";
import {
  addToLog,
  notFoundMessage,
  parseLog,
  renderFindingAids,
  renderLog,
  reusedNote,
} from "../src/library.ts";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

test("format.ts and library.ts import nothing from node, so Convex can bundle them", () => {
  for (const f of ["format.ts", "library.ts"]) {
    const text = fs.readFileSync(path.join(src, f), "utf8");
    expect(text).not.toMatch(/from "node:/);
    expect(text).not.toMatch(/from "@orama/);
  }
});

describe("ids", () => {
  test("canonicalId collapses segments and refuses escapes and empties", () => {
    expect(canonicalId("a/../b")).toBe("b");
    expect(canonicalId("./x//y/")).toBe("x/y");
    expect(canonicalId("/abs/z")).toBe("abs/z");
    expect(() => canonicalId("../escape")).toThrow(OKFError);
    expect(() => canonicalId("")).toThrow(OKFError);
  });
  test("normalizeSegments is lenient for link targets", () => {
    expect(normalizeSegments("../x")).toBe("x");
  });
  test("isReservedId names the OKF-reserved files", () => {
    expect(isReservedId("notes/index")).toBe(true);
    expect(isReservedId("log")).toBe(true);
    expect(isReservedId("code/index.py")).toBe(false);
  });
  test("slugify", () => {
    expect(slugify("Use SQLite FTS5!")).toBe("use-sqlite-fts5");
    expect(slugify("  ---  ")).toBe("concept");
  });
  test("deriveConceptId: explicit ids are refused when reserved, auto ids are bumped", async () => {
    const taken = new Set(["hello", "hello-2", "index-2"]);
    const exists = (id: string) => taken.has(id);
    expect(await deriveConceptId({ type: "Note", title: "Hello" }, exists)).toBe("hello-3");
    expect(await deriveConceptId({ type: "Note", title: "index" }, exists)).toBe("index-3");
    expect(await deriveConceptId({ type: "Note", id: "a/../b" }, exists)).toBe("b");
    expect(await deriveConceptId({ type: "Note" }, exists)).toBe("note");
    await expect(deriveConceptId({ type: "Note", id: "notes/index" }, exists)).rejects.toThrow(
      /reserved filename 'index.md'/,
    );
    await expect(deriveConceptId({ type: "Note", id: "thesaurus" }, exists)).rejects.toThrow(
      /thesaurus/,
    );
    // An async `exists` (Cloud) works the same.
    expect(
      await deriveConceptId({ type: "Note", title: "Hello" }, async (id) => taken.has(id)),
    ).toBe("hello-3");
  });
});

describe("frontmatter", () => {
  test("buildFrontmatter rebuilds standard keys, keeps unknown ones, and omits stable", () => {
    const fm = buildFrontmatter(
      { type: "Old", title: "Old", custom: 1, supersededBy: "x" },
      { type: "Note", title: "New", tags: [], status: "stable", extra: { supersededBy: null } },
    );
    expect(fm).toEqual({ custom: 1, type: "Note", title: "New" });
    expect(buildFrontmatter(null, { type: "Note", status: "draft", tags: ["a"] })).toEqual({
      type: "Note",
      status: "draft",
      tags: ["a"],
    });
    expect(() => buildFrontmatter(null, { type: "Note", status: "nope" })).toThrow(OKFError);
  });
  test("checkStatus", () => {
    expect(checkStatus("draft")).toBe("draft");
    expect(() => checkStatus("live")).toThrow(/invalid status/);
  });
  test("dump(parse(x)) is stable", () => {
    const text = "---\ntype: Note\ntitle: Hi\n---\nbody [x](/x.md)\n";
    const c = parse(text, { conceptId: "a" });
    expect(c.links).toEqual(["x"]);
    expect(dump(c)).toBe(text);
  });
});

describe("links", () => {
  test("extractLinks resolves relative and absolute targets, skips the rest", () => {
    const links = extractLinks(
      "[a](b.md) [b](../c.md) [c](/d/e.md#frag) [x](https://x.io/y.md) [m](mailto:a@b.md) [t](t.txt) [a](b.md)",
      "notes/src",
    );
    expect(links).toEqual(["notes/b", "c", "d/e"]);
  });
  test("conceptLink resolves one target the way extractLinks does", () => {
    expect(conceptLink("b.md", "notes/src")).toBe("notes/b");
    expect(conceptLink("/d/e.md#frag", "notes/src")).toBe("d/e");
    expect(conceptLink("../c.md", "notes/src")).toBe("c");
    expect(conceptLink("sibling.md", "top")).toBe("sibling");
    expect(conceptLink("https://x.io/y.md", "notes/src")).toBeNull();
    expect(conceptLink("notes/b", "notes/src")).toBeNull();
  });
  test("retargetLinks rewrites mapped links, keeps anchors, leaves the rest", () => {
    const res = retargetLinks(
      "[a](b.md#top) [o](/other.md) [x](https://x.io/b.md)",
      "notes/src",
      new Map([["notes/b", "moved/b"]]),
    );
    expect(res.changed).toBe(1);
    expect(res.body).toBe("[a](/moved/b.md#top) [o](/other.md) [x](https://x.io/b.md)");
  });
});

describe("search helpers", () => {
  test("makeSnippet brackets matches and marks truncation", () => {
    const snip = makeSnippet(
      "one two three four five six seven eight sqlite nine ten",
      "sqlite",
      4,
    );
    expect(snip).toContain("[sqlite]");
    expect(snip.startsWith("…")).toBe(true);
  });
  test("demoteDeprecated is a stable partition", () => {
    const hits = [
      { id: 1, status: "deprecated" },
      { id: 2, status: "stable" },
      { id: 3, status: "draft" },
    ];
    expect(demoteDeprecated(hits).map((h) => h.id)).toEqual([2, 3, 1]);
  });
  test("matchesFilters", () => {
    const row = { id: "acme/a", type: "Note", status: "stable", tags: ["x"] };
    expect(matchesFilters(row, { type: "Note", tag: "x", shelf: "/acme/" })).toBe(true);
    expect(matchesFilters(row, { status: "draft" })).toBe(false);
    expect(matchesFilters(row, { shelf: "other" })).toBe(false);
  });
});

describe("library science", () => {
  const rows = [
    { id: "a", status: "stable", links: ["b", "ghost"], description: "A", tags: ["t"] },
    { id: "b", status: "deprecated", links: [], description: "", tags: [] },
    { id: "thesaurus", status: "stable", links: [], description: "", tags: [] },
  ];
  test("weedRules: a live concept past its OKF stale_after is stale", () => {
    const now = Date.parse("2026-09-25T00:00:00Z");
    const row = (id: string, stale_after: unknown, status = "stable") => ({
      id,
      status,
      links: [],
      description: "d",
      tags: ["t"],
      stale_after,
    });
    const w = weedRules(
      [
        row("past", "2026-01-01"),
        row("future", "2027-01-01T00:00:00Z"),
        row("none", undefined),
        row("garbage", "someday"),
        row("retired", "2020-01-01", "deprecated"),
      ],
      50,
      now,
    );
    expect(w.stale).toEqual(["past"]);
    expect(w.counts.stale).toBe(1);
    expect(isStale(new Date("2026-09-24"), now)).toBe(true);
  });

  test("weedRules: the five rules, thesaurus skipped, counts before the limit", () => {
    const w = weedRules(rows, 1);
    expect(w.counts).toEqual({
      deprecated: 1,
      broken_links: 1,
      orphans: 1,
      no_description: 1,
      no_tags: 1,
      stale: 0,
    });
    expect(w.deprecated).toEqual(["b"]);
    expect(w.broken_links).toEqual([{ id: "a", missing: ["ghost"] }]);
    expect(w.orphans).toEqual(["a"]);
    expect(w.no_description).toEqual(["b"]);
  });
  test("libraryStats counts the vocabulary and broken links", () => {
    const st = libraryStats(
      rows.map((r) => ({ id: r.id, type: "Note", tags: r.tags, links: r.links })),
    );
    expect(st).toEqual({
      concepts: 3,
      by_type: { Note: 3 },
      by_tag: { t: 1 },
      links: 2,
      broken_links: 1,
    });
  });
  test("bfsGraph walks to depth, caps nodes, and prunes dangling edges", async () => {
    const adj: Record<string, string[]> = { a: ["b"], b: ["c"], c: [] };
    const neighborsOf = (id: string) => ({
      outbound: (adj[id] ?? []).map((x) => ({ id: x })),
      inbound: Object.entries(adj)
        .filter(([, out]) => out.includes(id))
        .map(([src]) => ({ id: src })),
    });
    const nodeFor = (id: string) => ({ id, title: null, exists: id in adj });
    const g1 = await bfsGraph("a", { depth: 1 }, neighborsOf, nodeFor);
    expect(g1.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    const g2 = await bfsGraph("a", { depth: 2 }, neighborsOf, nodeFor);
    expect(g2.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    expect(g2.edges).toEqual([
      { src: "a", dst: "b" },
      { src: "b", dst: "c" },
    ]);
    const capped = await bfsGraph("a", { depth: 2, maxNodes: 2 }, neighborsOf, nodeFor);
    expect(capped.nodes).toHaveLength(2);
    expect(capped.edges).toEqual([{ src: "a", dst: "b" }]);
  });
});

describe("no secrets", () => {
  test("recognizes common credential formats", () => {
    expect(findSecret(`key: ${"sk_live_"}${"a".repeat(24)}`)).toBe("a Stripe secret key");
    expect(findSecret(`token ${"ghp_"}${"A".repeat(36)}`)).toBe("a GitHub token");
    expect(findSecret(`${"AKIA"}ABCDEFGHIJKLMNOP`)).toBe("an AWS access key");
    expect(findSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe("a private key");
  });

  test("lets a reference to a secret through", () => {
    expect(
      findSecret("The Stripe key is STRIPE_SECRET_KEY, in Doppler at prod/stripe."),
    ).toBeNull();
    expect(findSecret("sk_live keys are rotated yearly")).toBeNull();
    // AWS's own documentation key is a placeholder.
    expect(findSecret(`aws_access_key_id = ${"AKIA"}IOSFODNN7EXAMPLE`)).toBeNull();
  });

  test("assertNoSecrets refuses the write and says what to store instead", () => {
    expect(() => assertNoSecrets("ok", `x ${"xoxb-"}1234567890-abcdef`)).toThrow(
      /never stores secrets/,
    );
    expect(() => assertNoSecrets(null, undefined, "plain text")).not.toThrow();
  });
});

describe("accessions: an id is never reused (Dana, ch. XIX)", () => {
  test("the update log is OKF §9: date headings, newest first; the newest entry per id wins", () => {
    let log = addToLog(null, { id: "notes/old", at: "2026-09-20", title: "Old\nnotes" });
    log = addToLog(log, { id: "notes/a", at: "2026-09-20", moved_to: "notes/b" });
    log = addToLog(log, { id: "notes/old", at: "2026-09-26" });
    expect(log).toBe(
      [
        "# Update log",
        "",
        "## 2026-09-26",
        "",
        "* **Deletion**: `notes/old`",
        "",
        "## 2026-09-20",
        "",
        "* **Rename**: `notes/a` → `notes/b`",
        "* **Deletion**: `notes/old` — Old notes",
        "",
      ].join("\n"),
    );
    expect(parseLog(log)).toEqual(
      new Map([
        ["notes/old", { id: "notes/old", at: "2026-09-26" }],
        ["notes/a", { id: "notes/a", at: "2026-09-20", moved_to: "notes/b" }],
      ]),
    );
  });

  test("a hand-written log keeps its own entries; renderLog groups by day", () => {
    const mine = "# Log\n\n## 2026-01-02\n\n* **Update**: wrote the plan.\n";
    const log = addToLog(mine, { id: "x", at: "2026-02-01", title: "X" });
    expect(log).toContain("* **Update**: wrote the plan.");
    expect(log.indexOf("## 2026-02-01")).toBeLessThan(log.indexOf("## 2026-01-02"));
    expect(parseLog(log).get("x")).toEqual({ id: "x", at: "2026-02-01", title: "X" });
    const all = renderLog([
      { id: "b", at: "2026-01-01" },
      { id: "a", at: "2026-03-01", moved_to: "c" },
    ]);
    expect(all.indexOf("## 2026-03-01")).toBeLessThan(all.indexOf("## 2026-01-01"));
    expect(parseLog(all).size).toBe(2);
  });

  test("messages say what became of the id", () => {
    expect(notFoundMessage("n")).toBe("concept not found: n");
    expect(notFoundMessage("n", { id: "n", at: "2026-09-20", title: "Old" })).toBe(
      'concept not found: n (deleted on 2026-09-20 ("Old"))',
    );
    expect(notFoundMessage("n", { id: "n", at: "2026-09-20", moved_to: "m" })).toBe(
      "concept not found: n (renamed to m on 2026-09-20)",
    );
    expect(reusedNote({ id: "n", at: "2026-09-20" })).toMatch(
      /^this id was deleted on 2026-09-20;/,
    );
  });
});

describe("code links: a concept about code comes up for review when it changes", () => {
  test("a source covers a changed file: the same path, a directory, or a blob or tree link", () => {
    expect(coversPath("src/auth/login.ts", "src/auth/login.ts")).toBe(true);
    expect(coversPath("./src/auth/login.ts", "/src/auth/login.ts")).toBe(true);
    expect(coversPath("src/auth/login.ts", "src/auth/logout.ts")).toBe(false);
    expect(coversPath("src/auth/", "src/auth/session/store.ts")).toBe(true);
    expect(coversPath("src/auth/", "src/authz.ts")).toBe(false);
    expect(coversPath("https://github.com/a/b/blob/main/src/x.ts", "src/x.ts")).toBe(true);
    expect(coversPath("https://github.com/a/b/tree/main/src", "src/y/z.ts")).toBe(true);
    expect(coversPath("https://gitlab.com/a/b/-/blob/dev/lib/q.rb#L3", "lib/q.rb")).toBe(true);
    expect(coversPath("https://example.com/docs", "docs")).toBe(false);
    // A file name alone is not a path: index.ts is in every directory.
    expect(coversPath("index.ts", "src/index.ts")).toBe(false);
  });

  test("a changed file's lookups find exactly the sources that cover it", () => {
    const cases: [string, string][] = [
      ["src/auth/login.ts", "src/auth/login.ts"],
      ["./src/auth/login.ts", "/src/auth/login.ts"],
      ["src/auth/login.ts", "src/auth/logout.ts"],
      ["src/auth/", "src/auth/session/store.ts"],
      ["src/auth/", "src/authz.ts"],
      ["src/auth/", "src/auth/"],
      ["https://github.com/a/b/blob/main/src/x.ts", "src/x.ts"],
      ["https://github.com/a/b/tree/main/src", "src/y/z.ts"],
      ["https://gitlab.com/a/b/-/blob/dev/lib/q.rb#L3", "lib/q.rb"],
      ["https://example.com/docs", "docs"],
      ["index.ts", "src/index.ts"],
    ];
    for (const [resource, changed] of cases) {
      const facet = pathFacetOf(resource);
      const found = facet !== null && pathsAbove(changed).includes(facet);
      expect(found, `${resource} / ${changed}`).toBe(coversPath(resource, changed));
    }
    expect(pathFacetOf("https://example.com/docs")).toBeNull();
    expect(pathsAbove("src/auth/login.ts")).toEqual(["src/auth/login.ts", "src/", "src/auth/"]);
  });

  test("sources keep what they said; resource counts too; markChanged dates both", () => {
    const prev = [{ resource: "a.ts", id: "a", last_modified: "2026-01-01T00:00:00Z" }, "b.ts"];
    expect(withSources(prev, ["a.ts", "c.ts", "a.ts"])).toEqual([
      { resource: "a.ts", id: "a", last_modified: "2026-01-01T00:00:00Z" },
      { resource: "c.ts" },
    ]);
    expect(withSources(prev, [])).toBeNull();
    const fm: Record<string, unknown> = {
      resource: "src/app.ts",
      sources: [{ resource: "src/lib/" }, { resource: "docs/x.md" }],
    };
    expect(sourcesOf(fm)).toEqual(["src/app.ts", "src/lib/", "docs/x.md"]);
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(markChanged(fm, ["README.md"], now)).toEqual([]);
    expect(fm.stale_after).toBeUndefined();
    expect(markChanged(fm, ["src/lib/a.ts", "src/app.ts"], now)).toEqual([
      "src/app.ts",
      "src/lib/",
    ]);
    expect(fm.stale_after).toBe("2026-09-26T12:00:00.000Z");
    expect(fm.sources).toEqual([
      { resource: "src/lib/", last_modified: "2026-09-26T12:00:00.000Z" },
      { resource: "docs/x.md" },
    ]);
    // Already past its date: the date stays, so the review shelf keeps one proposal.
    markChanged(fm, ["src/app.ts"], now + 86_400_000);
    expect(fm.stale_after).toBe("2026-09-26T12:00:00.000Z");
  });
});

describe("lists of additions (Dana, ch. XXV)", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const entry = (id: string, added: number | null) => ({
    id,
    title: id,
    description: null,
    type: "Note",
    status: "stable",
    added,
  });
  test("the root finding aid opens with what arrived in the last seven days, newest first", () => {
    const aids = renderFindingAids(
      [
        entry("a/old", now - 30 * 86_400_000),
        entry("a/new", now - 86_400_000),
        entry("b/newest", now - 3_600_000),
      ],
      { additions: { since: now - 7 * 86_400_000 } },
    );
    const root = aids.find((a) => a.dir === "")?.markdown ?? "";
    const news = root.slice(
      root.indexOf("## New in the last 7 days"),
      root.indexOf("## Everything"),
    );
    expect(news).toMatch(/b\/newest[\s\S]*a\/new/);
    expect(news).toContain("_(added 2026-09-26)_");
    expect(news).not.toContain("a/old");
    // Only the front page carries it; a shelf's aid does not.
    expect(aids.find((a) => a.dir === "a")?.markdown).not.toContain("New in the last");
  });

  test("nothing new, or no dates: the aid is as before", () => {
    const plain = renderFindingAids([entry("a/old", null)]);
    const quiet = renderFindingAids([entry("a/old", now - 30 * 86_400_000)], {
      additions: { since: now - 7 * 86_400_000 },
    });
    expect(quiet).toEqual(plain);
  });
});
