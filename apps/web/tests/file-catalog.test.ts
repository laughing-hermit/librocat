/** Jev reading a person's file (convex/fileCatalog.ts): its questions, and its picks read back. */

import { describe, expect, test } from "vitest";
import {
  CHECKED,
  FLAG,
  fileChangesQuestions,
  filePicks,
  READ_CHARS,
  readQuery,
  readSpan,
} from "../convex/fileCatalog";
import type { Evaluation } from "../convex/jev";

const vocabulary = [
  { tag: "pricing", filed: ["Team plan pricing"] },
  { tag: "billing", filed: [] },
];
const candidates = ["From January, the Team plan costs eighteen dollars a person each month."];
const concepts = [{ id: "pricing/team" }, { id: "ops/deploy" }];

const evaluation = (answers: Evaluation["answers"]): Evaluation => ({ answers, cost: 0 });

describe("Jev reads a file", () => {
  test("one yes-or-no question a concept: does the file change what it says?", () => {
    const q = fileChangesQuestions(2);
    expect(Object.keys(q)).toEqual(["affects0", "affects1"]);
    expect(q.affects1?.type).toBe("boolean");
    expect(q.affects1?.instructions).toContain("`concepts[1]`");
  });

  test("its picks: a sentence, tags, and the concepts it changes, past the threshold", () => {
    const picked = filePicks(
      evaluation({
        description: { type: "choice", choice: "c0", probabilities: { c0: 0.9, none: 0.1 } },
        tag0: { type: "boolean", probability: 0.9 },
        tag1: { type: "boolean", probability: 0.2 },
        affects0: { type: "boolean", probability: 0.8 },
        affects1: { type: "boolean", probability: 0.45 },
      }),
      candidates,
      vocabulary,
      {},
      concepts,
    );
    expect(picked).toEqual({
      description: candidates[0],
      tags: ["pricing"],
      affected: [{ id: "pricing/team", p: 0.8 }],
    });
  });

  test("nothing Jev is sure of is nothing at all, so the credit comes back", () => {
    const picked = filePicks(
      evaluation({
        description: { type: "choice", choice: "none", probabilities: { c0: 0.2, none: 0.8 } },
        affects0: { type: "boolean", probability: 0.49 },
      }),
      candidates,
      vocabulary,
      {},
      concepts,
    );
    expect(picked).toEqual({ description: undefined, tags: [], affected: [] });
  });
});

describe("Libro reads a whole file, a few pages at a time", () => {
  test("a read is whole parts up to its size, and at least one", () => {
    expect(READ_CHARS).toBe(8_000);
    expect(readSpan([4_000, 3_900, 4_000])).toBe(2);
    expect(readSpan([4_000, 4_100])).toBe(1);
    // A part bigger than a read is still read, alone.
    expect(readSpan([9_000, 100])).toBe(1);
    expect(readSpan([])).toBe(0);
  });

  test("a read's search: its most frequent words, then the file's tags and name last", () => {
    const text = "Pricing pricing pricing seats seats invoice. This that with from have.";
    const q = readQuery(text, "Price sheet 2027", ["billing"]);
    expect(q.startsWith("pricing seats invoice")).toBe(true);
    expect(q.endsWith("billing Price sheet 2027")).toBe(true);
    // The common words aren't searched for.
    expect(q).not.toMatch(/\b(this|that|with|from|have)\b/);
    // A query keeps its last 16 words: the name and tags always fit.
    const long = readQuery(
      Array.from({ length: 40 }, (_, i) => `word${"x".repeat(i)}`).join(" "),
      "Name",
    );
    expect(long.split(" ").length).toBeLessThanOrEqual(16);
    expect(long.endsWith("Name")).toBe(true);
  });

  test("it errs toward flagging: 50% sure, and up to 20 concepts a read", () => {
    expect(FLAG).toBe(0.5);
    expect(CHECKED).toBe(20);
  });
});
