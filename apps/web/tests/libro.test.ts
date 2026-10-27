/**
 * Libro's Jev screens (convex/libro.ts): the dates a concept writes out, the
 * questions, how the answers become review dates, how the pair screen ranks its candidates, which tag
 * pairs the synonym screen asks about, and what the source watch tells Jev
 * changed.
 */

import { describe, expect, test } from "vitest";
import type { Evaluation } from "../convex/jev";
import {
  AFFECTED,
  type Candidate,
  changeAffectsQuestions,
  changeSummary,
  dateReason,
  datesPicks,
  datesQuestions,
  dayAfter,
  humanDate,
  KIND_DAYS,
  overlap,
  pickedDate,
  rankCandidates,
  SAME_TAG,
  sameSubjectQuestions,
  sameTagMeaningQuestions,
  statedDate,
  tagPairs,
  usedOn,
} from "../convex/libro";

describe("Libro's review dates", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");

  test("a date written out that hasn't come yet: the soonest, in any common form", () => {
    expect(statedDate("We launch on 2026-11-01.", now)).toBe("2026-11-01");
    expect(statedDate("The launch is October 15, 2027.", now)).toBe("2027-10-15");
    expect(statedDate("Due Oct 15 2027, review Sept. 3rd, 2027", now)).toBe("2027-09-03");
    expect(statedDate("Renewal on 9 March 2027.", now)).toBe("2027-03-09");
    expect(statedDate("Ships in Q1 2027.", now)).toBe("2027-03-31");
    expect(statedDate("Ships in q4 2026.", now)).toBe("2026-12-31");
    // Today counts; the day after it is the review.
    expect(statedDate("Cutover is 2026-10-21.", now)).toBe("2026-10-21");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
  });

  test("past dates, impossible dates, and bare numbers are not dates ahead", () => {
    expect(statedDate("We launched on 2026-10-01 and October 2, 2025.", now)).toBeNull();
    expect(statedDate("Due 2027-02-30, or February 30, 2027.", now)).toBeNull();
    expect(statedDate("Version 2027 of the spec, build 1234-56-78.", now)).toBeNull();
    expect(statedDate("Q3 2026 was a good quarter.", now)).toBeNull();
  });

  test("four yes/no questions per concept: a schedule, a price, a version, an owner", () => {
    const q = datesQuestions(2);
    expect(Object.keys(q)).toEqual([
      "schedule0",
      "price0",
      "version0",
      "owner0",
      "schedule1",
      "price1",
      "version1",
      "owner1",
    ]);
    expect(q.owner1?.instructions).toContain("`concepts[1]`");
    expect(Object.values(q).every((x) => x.type === "boolean")).toBe(true);
    expect(Object.keys(q).map((k) => k.replace(/\d+$/, ""))).toEqual([
      ...Object.keys(KIND_DAYS),
      ...Object.keys(KIND_DAYS),
    ]);
  });

  test("the soonest kind Jev is sure of sets the date; none sure, no date", () => {
    const b = (probability: number) => ({ type: "boolean" as const, probability });
    const e: Evaluation = {
      cost: 0,
      answers: {
        // An owner and a price: the price, sooner.
        owner0: b(0.95),
        price0: b(0.85),
        // Only an owner.
        owner1: b(0.9),
        version1: b(0.5),
        // Nothing sure.
        schedule2: b(0.79),
        price2: b(0.6),
        // A schedule beats a version.
        version3: b(0.99),
        schedule3: b(0.81),
      },
    };
    expect(datesPicks(e, ["a", "b", "c", "d"])).toEqual([
      { id: "a", kind: "price", days: 90, p: 0.85 },
      { id: "b", kind: "owner", days: 182, p: 0.9 },
      { id: "d", kind: "schedule", days: 30, p: 0.81 },
    ]);
  });

  test("the reason names the kind or the date, and every date as the dashboard writes it", () => {
    expect(humanDate("2027-01-19")).toBe("Jan 19, 2027");
    expect(humanDate("2026-09-05")).toBe("Sep 5, 2026");
    expect(dateReason({ kind: "price", p: 0.921 }, "2027-01-19")).toBe(
      "States a price (Libro is 92% sure). Check it again by Jan 19, 2027?",
    );
    expect(dateReason({ stated: "2026-11-01" }, "2026-11-02")).toBe(
      "Says Nov 1, 2026. Check it again by Nov 2, 2026?",
    );
  });

  test("a tag pair says how many concepts each tag is on, in words", () => {
    expect(usedOn(1, 1)).toBe("used on 1 concept each");
    expect(usedOn(3, 3)).toBe("used on 3 concepts each");
    expect(usedOn(2, 5)).toBe("used on 2 and 5 concepts");
  });

  test("a date picked on approving must be real and after today", () => {
    expect(pickedDate("2026-10-22", now)).toBe("2026-10-22");
    expect(() => pickedDate("2026-10-21", now)).toThrow(/after today/);
    expect(() => pickedDate("2027-02-30", now)).toThrow(/not a date/);
    expect(() => pickedDate("next week", now)).toThrow(/not a date/);
  });
});

describe("Libro's pair screen", () => {
  test("one yes/no question per pair, pointing at the pair in the state", () => {
    const q = sameSubjectQuestions(2);
    expect(Object.keys(q)).toEqual(["same0", "same1"]);
    expect(q.same1?.instructions).toContain("`pairs[1].older`");
    expect(q.same1?.type).toBe("boolean");
  });

  type C = { cid: string; title?: string; tags: string[] };
  const c = (cid: string, title: string, tags: string[] = []): C => ({ cid, title, tags });

  test("a pair overlaps on two shared tags or most of a title's words", () => {
    expect(overlap(c("a", "x", ["ops", "db"]), c("b", "y", ["ops", "db"]))).toBe(3);
    expect(overlap(c("a", "Rotate signing keys"), c("b", "Rotate the signing keys"))).toBe(0.75);
    expect(overlap(c("a", "Rotate keys"), c("b", "Drain nodes"))).toBe(0);
  });

  test("word-index neighbors join the shelf pairs, one per pair, best first", () => {
    const keys = c("ops/keys", "Rotating signing keys", ["ops", "security"]);
    const keys2 = c("security/rotate", "How to rotate keys", ["ops", "security"]);
    const drain = c("ops/drain", "Draining nodes");
    const backup = c("ops/backup", "Backups");
    const same = c("ops/backups", "Backup");
    const ranked = rankCandidates<C>([
      // Same shelf, nothing shared: not a candidate.
      { a: keys, b: drain, overlap: 0 },
      // Found by words, third nearest, nothing else shared.
      { a: drain, b: backup, overlap: 0, rank: 2 },
      // Shares two tags, and is found by words too, both ways round.
      { a: keys, b: keys2, overlap: 3, rank: 1 },
      { a: keys2, b: keys, overlap: 3, rank: 0 },
      // The same folded title is the mechanical pass's.
      { a: backup, b: same, overlap: 1, rank: 0 },
    ] satisfies Candidate<C>[]);
    expect(ranked.map((p) => [p.a.cid, p.b.cid, p.rank])).toEqual([
      ["ops/keys", "security/rotate", 0],
      ["ops/drain", "ops/backup", 2],
    ]);
  });
});

describe("Libro's synonym screen", () => {
  type D = { cid: string; title: string; status: string; tags: string[] };
  const d = (cid: string, tags: string[], status = "draft"): D => ({
    cid,
    title: `Title of ${cid}`,
    status,
    tags,
  });
  const pairsOf = (docs: D[], th = {}) =>
    tagPairs(docs as never, th).map((p) => [p.a.tag, p.b.tag, p.together]);

  test("tags carried together twice, or sharing a stem, are asked about; the rarer is filed under the other", () => {
    const docs = [
      d("a", ["k8s", "kubernetes", "ops"]),
      d("b", ["k8s", "kubernetes"]),
      d("c", ["kubernetes"]),
      d("d", ["deploying", "deploy-scripts"]),
      // Carried together once: not enough.
      d("e", ["ops", "billing"]),
    ];
    expect(pairsOf(docs)).toEqual([
      ["k8s", "kubernetes", 2],
      // Used as often: the first by name is the target.
      ["deploying", "deploy-scripts", 1],
    ]);
  });

  test("each tag comes with how often it is used and a few titles", () => {
    const docs = ["a", "b", "c", "d"].map((cid) => d(cid, ["k8s", "kubernetes"]));
    const [pair] = tagPairs(docs as never, {});
    expect(pair?.a).toEqual({
      tag: "kubernetes",
      uses: 4,
      examples: ["Title of a", "Title of b", "Title of c"],
    });
  });

  test("what the thesaurus or the mechanical pass settles is left out", () => {
    const together = (a: string, b: string) => [d(`${a}1`, [a, b]), d(`${a}2`, [a, b])];
    // The same foldKey: the mechanical pass's.
    expect(pairsOf(together("api-keys", "api key"))).toEqual([]);
    // Deprecated concepts don't count.
    expect(
      pairsOf([d("x", ["a1", "b1"], "deprecated"), d("y", ["a1", "b1"], "deprecated")]),
    ).toEqual([]);
    // A use-for term, two preferred tags, and a related pair.
    expect(pairsOf(together("k8s", "kube"), { kubernetes: { use_for: ["kube"] } })).toEqual([]);
    expect(pairsOf(together("ops", "infra"), { ops: {}, infra: {} })).toEqual([]);
    expect(pairsOf(together("ops", "infra"), { ops: { related: ["infra"] } })).toEqual([]);
    expect(pairsOf(together("ops", "infra"), { infra: { narrower: ["ops"] } })).toEqual([]);
  });

  test("a preferred tag is the target, however rarely it is used", () => {
    const docs = [d("a", ["k8s", "kubernetes"]), d("b", ["k8s", "kubernetes"]), d("c", ["k8s"])];
    expect(pairsOf(docs)).toEqual([["kubernetes", "k8s", 2]]);
    expect(pairsOf(docs, { kubernetes: {} })).toEqual([["k8s", "kubernetes", 2]]);
  });

  test("one yes/no question per pair, confirmed at 85%", () => {
    const q = sameTagMeaningQuestions(2);
    expect(Object.keys(q)).toEqual(["sameTag0", "sameTag1"]);
    expect(q.sameTag1?.instructions).toContain("`pairs[1].a.tag`");
    expect(q.sameTag1?.type).toBe("boolean");
    expect(SAME_TAG).toBe(0.85);
  });
});

describe("the source watch's change summary", () => {
  test("only the paragraphs that changed, without what they share at either end", () => {
    const before = "# Pricing\n\nTeam costs $15 a person.\n\nSupport answers within a day.";
    const after = "# Pricing\n\nTeam costs $18 a person.\n\nSupport answers within a day.";
    expect(changeSummary(before, after)).toEqual({
      removed: "Team costs $15 a person.",
      added: "Team costs $18 a person.",
    });
  });

  test("a paragraph only one side has is all that side says", () => {
    expect(changeSummary("One.\n\nTwo.", "One.\n\nTwo.\n\nThree is new.")).toEqual({
      removed: "",
      added: "Three is new.",
    });
    expect(changeSummary("One.\n\nGone now.", "One.")).toEqual({ removed: "Gone now.", added: "" });
  });

  test("a long paragraph is cut to the change, with some context, and each side is bounded", () => {
    const lead = "word ".repeat(200);
    const tail = " more".repeat(200);
    const c = changeSummary(`${lead}costs $15${tail}`, `${lead}costs $18${tail}`, 400);
    expect(c.removed.startsWith("…")).toBe(true);
    expect(c.removed.endsWith("…")).toBe(true);
    expect(c.removed).toContain("costs $15");
    expect(c.added).toContain("costs $18");
    expect(c.removed.length).toBeLessThanOrEqual(400);
    const big = changeSummary("", "x".repeat(5000), 400);
    expect(big.added.length).toBeLessThanOrEqual(400);
  });

  test("one question per citing concept, affected at 60%", () => {
    const q = changeAffectsQuestions(3);
    expect(Object.keys(q)).toEqual(["affects0", "affects1", "affects2"]);
    expect(q.affects2?.instructions).toContain("`concepts[2]`");
    expect(q.affects0?.instructions).toContain("`change.removed`");
    expect(AFFECTED).toBe(0.6);
  });
});
