/**
 * The ready-reference file and Libro's report, their pure parts: folding a
 * question into its key, reading the file, putting a known answer first, the
 * report email, and the unsubscribe token.
 */

import { describe, expect, test } from "vitest";
import { foldQuestion, promote, summarize } from "../convex/reference";
import { previousFirstMonday, type Report, renderReport, unsubscribeToken } from "../convex/report";

describe("the ready-reference file", () => {
  test("a question's key is its content words, so rewordings of the same words meet", () => {
    expect(foldQuestion("How do we rotate the Stripe keys?")).toBe("key rotate stripe");
    expect(foldQuestion("stripe key: rotate")).toBe("key rotate stripe");
    expect(foldQuestion("OAuth refresh-token rotation")).toBe("oauth refresh rotation token");
    // Nothing but stopwords: the text itself, so it still groups with itself.
    expect(foldQuestion("How do I?")).toBe("how do i?");
  });

  test("the desk: asked most with its answer, and what found nothing (latest asking)", () => {
    const row = (key: string, hits: number, t: number, answeredBy?: string) => ({
      text: key,
      key,
      hits,
      _creationTime: t,
      ...(answeredBy ? { answeredBy } : {}),
    });
    const d = summarize([
      row("stripe key", 1, 1, "runbooks/stripe"),
      row("stripe key", 2, 2, "runbooks/stripe"),
      row("stripe key", 2, 3),
      row("sso setup", 0, 4),
      row("sso setup", 0, 5),
      // Found nothing once, then written down: no longer a gap.
      row("pricing", 0, 6),
      row("pricing", 3, 7),
    ]);
    expect(d).toMatchObject({ asked: 7, distinct: 3, found_nothing: 3, answered: 2 });
    expect(d.frequent).toEqual([
      { text: "stripe key", count: 3, answer: "runbooks/stripe" },
      { text: "pricing", count: 2, answer: null },
      { text: "sso setup", count: 2, answer: null },
    ]);
    expect(d.unanswered).toEqual([
      { key: "sso setup", text: "sso setup", count: 2, last_asked: 5 },
    ]);
  });

  test("a known answer goes first and says why; an absent one changes nothing", () => {
    const hits = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(promote(hits, "c")).toEqual([
      { id: "c", ready_reference: true },
      { id: "a" },
      { id: "b" },
    ]);
    expect(promote(hits, "z")).toBe(hits);
  });
});

describe("Libro's report", () => {
  const report: Report = {
    from: 0,
    to: 1,
    period: "week",
    concepts: 42,
    added: {
      count: 3,
      titles: ["Rotate the Stripe key", "SSO", "Pricing <2026>"],
      ids: ["ops/stripe-key", "auth/sso", "pricing"],
    },
    updated: 2,
    stale: { count: 1, ids: ["plans/q4-launch"] },
    shelf: { open: 4 },
    reading: {
      read_this_week: 17,
      never_read: 5,
      most: [{ id: "a", title: "Auth", retrievals: 9 }],
    },
    questions: {
      asked: 12,
      found_nothing: 3,
      unanswered: [{ text: "how do we do sso", count: 2 }],
      frequent: [{ text: "stripe key", count: 4, answer: "runbooks/stripe" }],
    },
    unread_sources: { count: 2, titles: ["Q3 board deck", "Refund policy"] },
  };
  const opts = {
    library: "Acme",
    dashboardUrl: "https://librocat.com/dashboard",
    unsubscribeUrl: "https://librocat.com/api/unsubscribe?m=1&t=x",
  };

  test("the subject says what matters; the body carries each section and the way out", () => {
    const { subject, text, html } = renderReport(report, opts);
    expect(subject).toBe(
      "Libro's report: 3 new concepts, 1 past its review date, 1 unanswered question",
    );
    expect(text).toContain('No answer yet: "how do we do sso" (asked 2 times)');
    expect(text).toContain("answered by runbooks/stripe");
    expect(text).toContain("4 things need you, in the Library's Needs you.");
    expect(text).toContain('2 files no concept cites yet: "Q3 board deck", "Refund policy".');
    expect(text).toContain(`Stop these emails: ${opts.unsubscribeUrl}`);
    // Titles are escaped in HTML.
    expect(html).toContain("Pricing &#60;2026&#62;");
    expect(html).not.toContain("<2026>");
  });

  test("a quiet week still reads right", () => {
    const quiet: Report = {
      ...report,
      added: { count: 0, titles: [], ids: [] },
      updated: 0,
      stale: { count: 0, ids: [] },
      shelf: { open: 0 },
      questions: { asked: 0, found_nothing: 0, unanswered: [], frequent: [] },
      reading: { read_this_week: 0, never_read: 0, most: [] },
      unread_sources: { count: 0, titles: [] },
    };
    const { subject, text } = renderReport(quiet, opts);
    expect(subject).toBe("Libro's report: your library this week");
    expect(text).toContain("Nothing needs you.");
    expect(text).toContain("No questions this week.");
    expect(text).not.toContain("Missing");

    // Free gets it once a month, covering the month.
    const month = renderReport({ ...quiet, period: "month" }, opts);
    expect(month.subject).toBe("Libro's report: your library this month");
    expect(month.text).toContain("This month");
    expect(month.text).toContain("No questions this month.");
  });

  test("Free's report covers the month since the previous month's first Monday", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(previousFirstMonday(at("2026-12-07T08:00:00Z"))).toBe(at("2026-11-02T08:00:00Z"));
    expect(previousFirstMonday(at("2026-11-02T08:00:00Z"))).toBe(at("2026-10-05T08:00:00Z"));
    expect(previousFirstMonday(at("2027-01-04T08:00:00Z"))).toBe(at("2026-12-07T08:00:00Z"));
  });

  test("unsubscribe tokens are per member and per secret", async () => {
    const a = await unsubscribeToken("member-a", "s3cret");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await unsubscribeToken("member-a", "s3cret")).toBe(a);
    expect(await unsubscribeToken("member-b", "s3cret")).not.toBe(a);
    expect(await unsubscribeToken("member-a", "other")).not.toBe(a);
  });
});
