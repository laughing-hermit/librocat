/** What a paid plan's end does: Free's limits, a pause, a year (convex/grace.ts). */

import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  deleteDate,
  graceEmail,
  KEEP_DAYS,
  keptOf,
  overFree,
  overWords,
  PAUSE_DAYS,
} from "../convex/grace";

const library = (id: string, conceptCount: number, created: number, pausedAt?: number) =>
  ({
    _id: id as Id<"workspaces">,
    _creationTime: created,
    conceptCount,
    pausedAt,
  }) as Doc<"workspaces">;

test("a library pauses 30 days after its plan ends, and what's over goes after a year", () => {
  expect([PAUSE_DAYS, KEEP_DAYS]).toEqual([30, 365]);
});

describe("overFree", () => {
  test("says how far a library is past each of Free's limits, 0 within them", () => {
    expect(
      overFree({ conceptCount: 1_003, sourceBytes: 150e6, textBytes: 4e6, revisionCount: 2_500 }),
    ).toEqual({ concepts: 3, bytes: 50e6, textBytes: 0, revisions: 500 });
    expect(overFree({ conceptCount: 10 })).toEqual({
      concepts: 0,
      bytes: 0,
      textBytes: 0,
      revisions: 0,
    });
    expect(overWords(overFree({ conceptCount: 1_001, sourceBytes: 1.2e9 }))).toBe(
      "1 concept, 1.1 GB of documents and pictures",
    );
  });
});

describe("keptOf", () => {
  const a = library("a", 10, 1);
  const b = library("b", 900, 2);
  const c = library("c", 900, 3);

  test("Free keeps one library active: the one with the most concepts, the oldest on a tie", () => {
    expect(keptOf([a, c, b])).toEqual({ kept: [b], extra: [c, a] });
  });

  test("the one picked when the grace started stays, whatever its size now", () => {
    expect(keptOf([a, b, c], a._id).kept).toEqual([a]);
  });

  test("an active library stays before a paused one", () => {
    const pausedB = library("b", 900, 2, 1);
    expect(keptOf([pausedB, a], pausedB._id)).toEqual({ kept: [a], extra: [pausedB] });
  });
});

describe("graceEmail", () => {
  const base = {
    pausesAt: Date.UTC(2026, 10, 29),
    deletesAt: Date.UTC(2027, 9, 30),
    over: [{ name: "Acme Docs", over: overFree({ conceptCount: 3_400 }) }],
    kept: "Acme Docs",
    extra: ["Notes"],
    libraryUrl: "https://librocat.com/dashboard/library",
    billingUrl: "https://librocat.com/dashboard/billing",
  };

  test("when the plan ends: what pauses and when, what's over, and the year after", () => {
    const { subject, text } = graceEmail({ ...base, kind: "start" });
    expect(subject).toBe("Your paid plan ended: your libraries are on Free");
    expect(text).toContain(
      "On November 29, 2026, Notes pauses, since Free has one library and Acme Docs has the most concepts.",
    );
    expect(text).toContain(
      "Acme Docs is 2,400 concepts over Free's limits: new concepts and files wait until it's under them.",
    );
    expect(text).toContain(
      "If it's still so on October 30, 2027, what's over Free's limits is deleted: Notes, the library past Free's one, then what changed least recently in Acme Docs, until it fits.",
    );
    expect(text).toContain("Nothing within Free's limits is deleted.");
    expect(text).toContain(base.libraryUrl);
    expect(text).toContain(base.billingUrl);
  });

  test("30 and 7 days before the deletion", () => {
    expect(graceEmail({ ...base, kind: "soon" }).subject).toBe(
      "In 30 days: what's over Free's limits is deleted on October 30, 2027",
    );
    const last = graceEmail({ ...base, kind: "last", extra: [] });
    expect(last.subject).toBe(
      "7 days left: what's over Free's limits is deleted on October 30, 2027",
    );
    expect(last.text).toMatch(
      /^On October 30, 2027, what's still over Free's limits in your libraries is deleted: what changed least recently in Acme Docs, until it fits\./,
    );
  });
});

describe("deleteDate", () => {
  const day = 86_400_000;
  const due = Date.UTC(2027, 9, 30);

  test("a warning on time keeps the date", () => {
    expect(deleteDate("soon", due, due - 30 * day)).toBe(due);
    expect(deleteDate("last", due, due - 7 * day)).toBe(due);
  });

  test("a late warning moves it: 30 days after the first, 7 after the second", () => {
    expect(deleteDate("soon", due, due - 2 * day)).toBe(due + 28 * day);
    expect(deleteDate("last", due, due)).toBe(due + 7 * day);
  });

  test("the first email, when the plan ends, never moves it", () => {
    expect(deleteDate("start", due, due + 5 * day)).toBe(due);
  });
});
