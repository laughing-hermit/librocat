/**
 * Home's pure parts (convex/dashboard.ts): "Found this week" and the
 * questions with no answer yet, from the same summary as Libro's report,
 * and what a dismissal hides.
 */

import { describe, expect, test } from "vitest";
import { answeredOf, gapsOf, undismissed } from "../convex/dashboard";
import { summarize } from "../convex/reference";

const row = (key: string, hits: number, t: number) => ({
  text: `asked: ${key}`,
  key,
  hits,
  _creationTime: t,
});

describe("Home", () => {
  test("answered this week: the questions that found something, of all asked", () => {
    const week = summarize([row("deploy", 2, 1), row("vpn", 0, 2), row("deploy", 1, 3)]);
    expect(answeredOf(week)).toEqual({ asked: 3, answered: 2 });
    expect(answeredOf(summarize([]))).toEqual({ asked: 0, answered: 0 });
  });

  test("couldn't find: a question whose latest asking found nothing, once by its key", () => {
    const week = summarize([
      row("vpn", 0, 1),
      row("vpn", 0, 5),
      row("sso", 0, 2),
      // Found nothing, then something: answered now.
      row("deploy", 0, 3),
      row("deploy", 1, 4),
    ]);
    expect(gapsOf(week, new Map())).toEqual([
      { key: "vpn", text: "asked: vpn", count: 2, at: 5 },
      { key: "sso", text: "asked: sso", count: 1, at: 2 },
    ]);
    expect(gapsOf(week, new Map(), 1).map((g) => g.key)).toEqual(["vpn"]);
  });

  test("a dismissed question stays hidden until it is asked again", () => {
    const week = summarize([row("vpn", 0, 1), row("sso", 0, 10)]);
    expect(gapsOf(week, new Map([["vpn", 5]])).map((g) => g.key)).toEqual(["sso"]);
    expect(gapsOf(week, new Map([["sso", 5]])).map((g) => g.key)).toEqual(["sso", "vpn"]);
    expect(undismissed(10, undefined)).toBe(true);
    expect(undismissed(10, 10)).toBe(false);
    expect(undismissed(11, 10)).toBe(true);
  });
});
