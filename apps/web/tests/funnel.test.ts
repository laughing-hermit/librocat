/** The owner's weekly funnel (convex/funnel.ts): the steps, the advice, and the email. */
import { describe, expect, test } from "vitest";
import { appLabel, appOf } from "../convex/apps";
import { biggestDrop, byLab, funnelEmail, funnelOf, laneOf, type Person } from "../convex/funnel";

const DAY = 86_400_000;
const signedUp = Date.UTC(2026, 8, 21, 15); // a Monday, 3 pm UTC
const person = (p: Partial<Person>): Person => ({
  signedUpAt: signedUp,
  verified: true,
  connectedAt: [],
  writes: [],
  searches: [],
  ...p,
});

describe("the funnel", () => {
  test("each step counts the people who reached it in their first week", () => {
    const f = funnelOf([
      person({}), // signed up, nothing else
      person({ connectedAt: [signedUp + 60_000] }),
      person({ connectedAt: [signedUp + 60_000], writes: [signedUp + 120_000] }),
      // Came back: a search two days later.
      person({
        connectedAt: [signedUp + 60_000],
        writes: [signedUp + 120_000],
        searches: [signedUp + 2 * DAY],
      }),
    ]);
    expect(f).toEqual({ signedUp: 4, connected: 3, wrote: 2, cameBack: 1 });
  });

  test("an unverified sign-up isn't counted at all", () => {
    expect(funnelOf([person({ verified: false, writes: [signedUp + 1] })]).signedUp).toBe(0);
  });

  test("coming back means a later day than the sign-up's, within the first week", () => {
    const sameDay = person({ writes: [signedUp + 3_600_000] });
    const day8 = person({ searches: [signedUp + 8 * DAY] });
    const nextDay = person({ searches: [signedUp + DAY] });
    expect(funnelOf([sameDay, day8, nextDay]).cameBack).toBe(1);
  });

  test("the advice names the step that lost the most people", () => {
    expect(biggestDrop({ signedUp: 10, connected: 4, wrote: 3, cameBack: 2 })).toEqual({
      before: "Connected an agent",
      lost: 6,
    });
    expect(biggestDrop({ signedUp: 3, connected: 3, wrote: 3, cameBack: 3 })).toBeNull();
  });
});

describe("the agents connected, by lab", () => {
  test("each of the big three with its apps, then more", () => {
    expect(
      byLab([
        ["Claude Code", 5],
        ["Codex", 4],
        ["Claude", 3],
        ["Cursor", 2],
        ["GitHub Copilot", 2],
        ["ChatGPT", 1],
        ["other", 1],
      ]),
    ).toBe(
      "Claude 8 (Claude Code 5, Claude 3); ChatGPT 5 (Codex 4, ChatGPT 1); Grok 2 (Cursor 2); more 3 (GitHub Copilot 2, other 1)",
    );
    expect(byLab([["Hermes", 2]])).toBe("more 2 (Hermes 2)");
  });
});

describe("which app an agent is", () => {
  test("its registered name picks one of the apps librocat knows, never itself", () => {
    expect(appOf("Claude Code (librocat)")).toBe("Claude Code");
    expect(appOf("Claude")).toBe("Claude");
    expect(appOf("ChatGPT")).toBe("ChatGPT");
    expect(appOf("Codex")).toBe("Codex");
    expect(appOf("Visual Studio Code")).toBe("GitHub Copilot");
    expect(appOf("mcporter")).toBe("OpenClaw");
    expect(appOf("Hermes Agent")).toBe("Hermes");
    expect(appOf("acme-internal-sync")).toBe("other");
  });

  test("its person sees the app, else the name it registered with, short", () => {
    expect(appLabel("Claude Code (librocat)")).toBe("Claude Code");
    expect(appLabel("acme-internal-sync")).toBe("acme-internal-sync");
    expect(appLabel("x".repeat(50))).toBe(`${"x".repeat(39)}…`);
    expect(appLabel("  ")).toBe("An agent");
  });
});

describe("which lane an app is in", () => {
  test("Connect's groups: the coding agents, the desktop agents, then other", () => {
    expect(laneOf("Claude Code")).toBe("coding");
    expect(laneOf("Codex")).toBe("coding");
    expect(laneOf("Cursor")).toBe("coding");
    expect(laneOf("OpenCode")).toBe("coding");
    expect(laneOf("Claude")).toBe("desktop");
    expect(laneOf("ChatGPT")).toBe("desktop");
    expect(laneOf("Grok")).toBe("desktop");
    expect(laneOf("Hermes")).toBe("other");
    expect(laneOf("other")).toBe("other");
  });
});

describe("the email", () => {
  const week = {
    from: Date.UTC(2026, 8, 28),
    to: Date.UTC(2026, 9, 5),
    signUps: 12,
    unverified: 3,
    agentsConnected: 9,
    agentsByApp: [
      ["Claude Code", 5],
      ["Claude", 3],
      ["other", 1],
    ] as [string, number][],
    conceptsWritten: 340,
    searches: 1204,
    paying: { individual: 2, team: 1, byLane: { coding: 3, desktop: 1, other: 0 } },
    refused: { audio: 4, video: 2, other: 1 },
    nearFree: { concepts: 3, storage: 1 },
    largest: { concepts: 4_210, bytes: 1_250_000_000, textBytes: 96_400_000 },
    cohort: {
      from: Date.UTC(2026, 8, 21),
      to: Date.UTC(2026, 8, 28),
      funnel: { signedUp: 8, connected: 6, wrote: 5, cameBack: 3 },
    },
  };

  test("says the week, the funnel with shares, and what to work on", () => {
    const { subject, text, html } = funnelEmail(week, false);
    expect(subject).toBe("librocat: 12 sign-ups, 3 of 8 came back");
    expect(text).toContain("The last 7 days (Sep 28 to Oct 4)");
    expect(text).toContain("12 (and 3 who never entered their code)");
    expect(text).toContain("Connected an agent   6 (75%)");
    // Which apps the agents were, by lab: the big three first, then the rest.
    expect(text).toContain(
      "Agents connected     9: Claude 8 (Claude Code 5, Claude 3); more 1 (other 1)",
    );
    expect(text).toContain("Came back            3 (38%)");
    // A tie (2 lost before each): the earlier step, since fixing it helps every step after.
    expect(text).toContain('Most people stopped before "Connected an agent" (2 of 8)');
    expect(text).toContain("vercel.com/johncaris-projects/librocat/analytics");
    // Refused files, by kind: whether people want recordings kept.
    expect(text).toContain("Files refused        7 (audio 4, video 2, other 1)");
    // The most one library keeps, against the plans' ceilings.
    // Free libraries close to a limit: whether Free is too generous.
    expect(text).toContain(
      "Free near a limit    3 libraries at 80%+ of Free's concepts, 1 of its storage",
    );
    expect(text).toContain("Largest library      4,210 concepts; 1250.0 MB kept; 96.4 MB of text");
    // Which agents the paying libraries use: the marketing follows that lane.
    expect(text).toContain(
      "Paying libraries     3 (Individual 2, Team 1; with coding agents 3, desktop agents 1)",
    );
    expect(html).toContain("<b>6 (75%)</b>");
  });

  test("other agents show in the paying row only when a paying library uses one", () => {
    const { text } = funnelEmail(
      { ...week, paying: { individual: 0, team: 1, byLane: { coding: 0, desktop: 0, other: 1 } } },
      false,
    );
    expect(text).toContain(
      "Paying libraries     1 (Individual 0, Team 1; with coding agents 0, desktop agents 0, other agents 1)",
    );
  });

  test("a self-hosted librocat's email has no Vercel link", () => {
    const { text, html } = funnelEmail(week, true);
    expect(text).not.toContain("vercel.com");
    expect(html).not.toContain("vercel.com");
  });
});
