/** The catalog index (convex/model.ts facetsOf): what a concept is filed under. */
import { normalizeCite } from "@librocat/core/sources";
import { expect, test } from "vitest";
import { facetsOf } from "../convex/model";

const row = {
  type: "Note",
  status: "stable",
  tags: ["auth", "oauth", "auth"],
  authors: ["human:u1", "Claude Code"],
  frontmatter: { sources: ["https://Example.com/Guide/", "source:abc"], supersededBy: "x/new" },
};

test("a concept is filed under its type, status, tags, authors, cites, and successor, once each", () => {
  expect(facetsOf(row)).toEqual([
    { kind: "type", value: "Note" },
    { kind: "status", value: "stable" },
    { kind: "tag", value: "auth" },
    { kind: "tag", value: "oauth" },
    { kind: "author", value: "human:u1" },
    { kind: "author", value: "Claude Code" },
    { kind: "cite", value: normalizeCite("https://Example.com/Guide/") },
    { kind: "cite", value: "source:abc" },
    { kind: "superseded_by", value: "x/new" },
  ]);
});

test("a retired concept cites nothing: its sources no longer count as read", () => {
  const kinds = facetsOf({ ...row, status: "deprecated" }).map((f) => f.kind);
  expect(kinds).not.toContain("cite");
  expect(kinds).toContain("tag");
});
