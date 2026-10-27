import { describe, expect, test } from "vitest";
import {
  dump,
  expandQuery,
  extractLinks,
  makeSnippet,
  neighborQuery,
  normalizeTags,
  OKFError,
  parse,
  slugify,
  specificEntry,
  type Thesaurus,
  tagFacet,
  withTerm,
} from "../src/index.ts";

const NOTE = `---
type: Note
title: Kickoff
description: Where it started.
tags: [notes, start]
---
We chose [the decision](/decisions/use-okf.md) at kickoff.
`;

describe("okf", () => {
  test("parse extracts frontmatter, body, and links", () => {
    const c = parse(NOTE, { conceptId: "notes/kickoff" });
    expect(c.type).toBe("Note");
    expect(c.frontmatter.title).toBe("Kickoff");
    expect(c.body).toContain("We chose");
    expect(c.links).toEqual(["decisions/use-okf"]);
  });

  test("dump(parse(x)) is body-stable", () => {
    const c = parse(NOTE, { conceptId: "n" });
    const again = parse(dump(c), { conceptId: "n" });
    expect(again.body).toBe(c.body);
    expect(again.frontmatter).toEqual(c.frontmatter);
  });

  test("parse rejects missing frontmatter and missing type", () => {
    expect(() => parse("no frontmatter", { conceptId: "x" })).toThrow(OKFError);
    expect(() => parse("---\ntitle: t\n---\nbody", { conceptId: "x" })).toThrow(OKFError);
  });

  test("relative links resolve against the source directory", () => {
    const links = extractLinks(
      "see [a](../decisions/a.md) and [b](./b.md) and [self](c.md)",
      "notes/deep/src",
    );
    expect(links).toEqual(["notes/decisions/a", "notes/deep/b", "notes/deep/c"]);
  });

  test("external, anchor, and non-md links are ignored; duplicates dropped", () => {
    const links = extractLinks(
      "x [w](https://x.md) [m](mailto:a@b.md) [p](/a.md#frag) [p2](/a.md) [img](pic.png)",
      "n",
    );
    expect(links).toEqual(["a"]);
  });
});

describe("slugify", () => {
  test("lowercases and dashes", () => {
    expect(slugify("Use SQLite FTS5!")).toBe("use-sqlite-fts5");
    expect(slugify("  ---  ")).toBe("concept");
  });
});

describe("makeSnippet", () => {
  test("brackets matches and marks truncation", () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const snip = makeSnippet(`${text} sqlite rest`, "sqlite");
    expect(snip).toContain("[sqlite]");
    expect(snip).toContain("…");
  });
});

describe("thesaurus", () => {
  test("relations are kept, cleared, and checked under authority control", () => {
    let th: Thesaurus = withTerm({}, "auth", {
      narrower: ["sso", "oauth"],
      use_for: ["authn", "authentication"],
    });
    expect(th.auth?.use_for).toEqual(["authn", "authentication"]);
    // Omitted relations are kept; [] clears one.
    th = withTerm(th, "auth", { broader: ["security"] });
    expect(th.auth).toEqual({
      broader: ["security"],
      narrower: ["sso", "oauth"],
      use_for: ["authn", "authentication"],
    });
    th = withTerm(th, "auth", { narrower: [] });
    expect(th.auth?.narrower).toBeUndefined();
    // A synonym is not a preferred tag, and a synonym has one owner.
    expect(() => withTerm(th, "authn", { narrower: ["x"] })).toThrow(/use_for synonym/);
    expect(() => withTerm(th, "session", { use_for: ["authn"] })).toThrow(/already/);
    expect(withTerm(th, "auth", null).auth).toBeUndefined();
  });

  test("related terms never list the tag itself; scope notes are one trimmed line", () => {
    const th = withTerm({}, "auth", {
      related: ["sessions", "auth"],
      scope_note: "  Who a caller is:   sign-in and tokens.  ",
    });
    expect(th.auth).toEqual({
      related: ["sessions"],
      scope_note: "Who a caller is: sign-in and tokens.",
    });
  });

  test("tags normalize to the preferred spelling; queries and facets expand", () => {
    const th: Thesaurus = {
      security: { narrower: ["auth"] },
      auth: { narrower: ["sso", "oauth"], use_for: ["authn", "authentication"] },
    };
    expect(normalizeTags(["Auth", "auth", "authn", "web"], th)).toEqual(["auth", "web"]);
    // Expansions come first so a partial last word keeps prefix matching.
    expect(expandQuery("auth rot", th)).toBe("sso oauth auth rot");
    expect(tagFacet("security", th).sort()).toEqual(["auth", "oauth", "security", "sso"]);
    // Cycles in the hierarchy never loop.
    const cyclic = { ...th, oauth: { narrower: ["security"] } };
    expect(tagFacet("security", cyclic).sort()).toEqual(["auth", "oauth", "security", "sso"]);
  });

  test("a neighbor query: the title's words first, through the thesaurus, stemmed, once each", () => {
    const th: Thesaurus = { kubernetes: { use_for: ["k8s"] } };
    expect(
      neighborQuery({ title: "Draining k8s nodes", description: "How we drain nodes." }, th),
    ).toBe("kubernet drain k8 node");
    // Short and common words are left out; at most 16 words, the title's kept.
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const q = neighborQuery({ title: "The backups", description: long }, {}).split(" ");
    expect(q[0]).toBe("backup");
    expect(q).toHaveLength(16);
    expect(neighborQuery({ title: "How to do it" }, {})).toBe("");
  });

  test("specific entry: a broader tag goes when a narrower one is present", () => {
    const th = { security: { narrower: ["auth"] }, auth: { narrower: ["oauth"] }, web: {} };
    expect(specificEntry(["security", "oauth", "web"], th)).toEqual(["oauth", "web"]);
    expect(specificEntry(["auth", "security"], th)).toEqual(["auth"]);
    // The inverse relation counts too: oauth names auth as broader.
    expect(specificEntry(["Auth", "oauth"], { oauth: { broader: ["auth"] } })).toEqual(["oauth"]);
    expect(specificEntry(["web", "css"], th)).toEqual(["web", "css"]);
  });
});
