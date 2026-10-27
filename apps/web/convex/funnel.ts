/**
 * The owner's weekly funnel email (docs/cloud.md, "The weekly funnel"): how
 * far the people who signed up got. It adds no tracking: sign-ups and agent
 * approvals are Better Auth's rows, writes are revisions, and searches are
 * the reference desk's questions, each already recording who made it.
 * Refused files are counted by kind alone (sources.ts refuseFile), to show
 * whether people want recordings kept.
 *
 * Every Monday at 09:00 UTC (crons.ts) to LIBROCAT_FUNNEL_EMAIL (one address,
 * or several separated by commas); unset, nothing is sent. `preview` returns
 * the numbers without sending; `send` sends now.
 */

import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { type ActionCtx, internalAction, internalQuery, type QueryCtx } from "./_generated/server";
import { clientName } from "./agents";
import { appOf } from "./apps";
import { ownerAddresses, sendEmail } from "./email";
import { CONCEPT_QUOTAS, SELF_HOST, SOURCE_BYTES } from "./model";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** Revisions carry a concept's body (up to 64 KB), so they're read a hundred at a time. */
const REVISION_PAGE = 100;
const PAGE = 500;
/** Each approval's app is a lookup of its agent's name, so approvals are read a hundred at a time. */
const CONSENT_PAGE = 100;
/** Where librocat Cloud's page views and events are counted (Vercel Web Analytics, by route). */
const VISITORS_URL = "https://vercel.com/johncaris-projects/librocat/analytics";

/** One person who signed up, and what they did in their first week. */
export type Person = {
  signedUpAt: number;
  verified: boolean;
  /** When they approved an agent (OAuth grants), if they did. */
  connectedAt: number[];
  /** When a write (a concept written or changed) was made for them. */
  writes: number[];
  /** When they searched. */
  searches: number[];
};

export type Funnel = { signedUp: number; connected: number; wrote: number; cameBack: number };

const dayOf = (t: number) => Math.floor(t / DAY);

/**
 * The funnel of people who each had a full first week. Pure:
 * - signed up: verified their email;
 * - connected an agent: approved one in their first week;
 * - wrote a concept: had one written for them in their first week;
 * - came back: wrote or searched on a later day than the one they signed
 *   up on, within their first week.
 */
export function funnelOf(people: Person[]): Funnel {
  const verified = people.filter((p) => p.verified);
  const inWeek = (p: Person, t: number) => t >= p.signedUpAt && t < p.signedUpAt + WEEK;
  const later = (p: Person, t: number) => inWeek(p, t) && dayOf(t) > dayOf(p.signedUpAt);
  return {
    signedUp: verified.length,
    connected: verified.filter((p) => p.connectedAt.some((t) => inWeek(p, t))).length,
    wrote: verified.filter((p) => p.writes.some((t) => inWeek(p, t))).length,
    cameBack: verified.filter((p) => [...p.writes, ...p.searches].some((t) => later(p, t))).length,
  };
}

const STEPS: [keyof Funnel, string][] = [
  ["signedUp", "Signed up"],
  ["connected", "Connected an agent"],
  ["wrote", "Wrote a concept"],
  ["cameBack", "Came back"],
];

/** The step that lost the most people from the one before it, or null when none lost any. Pure. */
export function biggestDrop(f: Funnel): { before: string; lost: number } | null {
  let worst: { before: string; lost: number } | null = null;
  for (let i = 1; i < STEPS.length; i++) {
    const [prevKey] = STEPS[i - 1] as [keyof Funnel, string];
    const [key, label] = STEPS[i] as [keyof Funnel, string];
    const lost = f[prevKey] - f[key];
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { before: label, lost };
  }
  return worst;
}

export type Week = {
  /** The week the report covers: [from, to). */
  from: number;
  to: number;
  signUps: number;
  /** Started signing up but never entered the emailed code. */
  unverified: number;
  agentsConnected: number;
  /** The agents approved, by the app each is (appOf): most first, "other" last. */
  agentsByApp: [string, number][];
  conceptsWritten: number;
  searches: number;
  /**
   * Paying libraries by plan, and by the lanes of the agents their members
   * connected (laneOf): one library can count in more than one lane.
   */
  paying: { individual: number; team: number; byLane: Record<Lane, number> };
  /**
   * Free libraries at 80% or more of Free's concepts or storage: the ones
   * about to need a plan. Whether Free is too generous is read here: if,
   * a month after launch, few active Free libraries ever come near a limit
   * (and few people open a second library), Free's concepts go down.
   */
  nearFree: { concepts: number; storage: number };
  /** Files librocat refused (it keeps text and pictures), by kind. */
  refused: { audio: number; video: number; other: number };
  /** The most any one library keeps, against the plans' ceilings (limits.ts, model.ts). */
  largest: { concepts: number; bytes: number; textBytes: number };
  /** The people who signed up the week before, each with a full first week. */
  cohort: { from: number; to: number; funnel: Funnel };
};

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const date = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (n: number, of: number) => (of > 0 ? ` (${Math.round((100 * n) / of)}%)` : "");

/** The email: plain text, and the same as a small HTML table. Pure. */
export function funnelEmail(
  w: Week,
  selfHosted: boolean,
): { subject: string; text: string; html: string } {
  const f = w.cohort.funnel;
  const recent: [string, string][] = [
    [
      "Sign-ups",
      `${w.signUps}${w.unverified ? ` (and ${w.unverified} who never entered their code)` : ""}`,
    ],
    [
      "Agents connected",
      `${w.agentsConnected}${w.agentsByApp.length ? `: ${byLab(w.agentsByApp)}` : ""}`,
    ],
    ["Concepts written", `${w.conceptsWritten}`],
    ["Searches", `${w.searches}`],
    [
      "Paying libraries",
      `${w.paying.individual + w.paying.team} (Individual ${w.paying.individual}, Team ${w.paying.team}; ` +
        `with coding agents ${w.paying.byLane.coding}, desktop agents ${w.paying.byLane.desktop}` +
        `${w.paying.byLane.other ? `, other agents ${w.paying.byLane.other}` : ""})`,
    ],
    [
      "Free near a limit",
      `${w.nearFree.concepts} libraries at 80%+ of Free's concepts, ${w.nearFree.storage} of its storage`,
    ],
    [
      "Largest library",
      `${w.largest.concepts.toLocaleString("en-US")} concepts; ${mb(w.largest.bytes)} kept; ` +
        `${mb(w.largest.textBytes)} of text`,
    ],
    [
      "Files refused",
      `${w.refused.audio + w.refused.video + w.refused.other} (audio ${w.refused.audio}, video ${w.refused.video}, other ${w.refused.other})`,
    ],
  ];
  const steps: [string, string][] = STEPS.map(([key, label]) => [
    label,
    `${f[key]}${key === "signedUp" ? "" : pct(f[key], f.signedUp)}`,
  ]);
  const drop = biggestDrop(f);
  const advice = drop
    ? `Most people stopped before "${drop.before}" (${drop.lost} of ${f.signedUp}): that's the step to work on first.`
    : f.signedUp > 0
      ? "Nobody dropped off at any step."
      : "Nobody signed up that week.";
  const visitors = selfHosted ? null : `Visitors: Vercel Web Analytics, ${VISITORS_URL}`;
  const week = `${date(w.from)} to ${date(w.to - DAY)}`;
  const cohort = `${date(w.cohort.from)} to ${date(w.cohort.to - DAY)}`;
  const subject = `librocat: ${w.signUps} sign-up${w.signUps === 1 ? "" : "s"}, ${f.cameBack} of ${f.signedUp} came back`;
  const pad = (rows: [string, string][]) =>
    rows.map(([k, val]) => `  ${k.padEnd(20)} ${val}`).join("\n");
  const text = [
    `The last 7 days (${week})`,
    pad(recent),
    ...(visitors ? [`  ${visitors}`] : []),
    "",
    `How the week before's sign-ups did (${cohort}, a full first week each)`,
    pad(steps),
    "",
    advice,
  ].join("\n");
  const table = (rows: [string, string][]) =>
    `<table style="border-collapse:collapse">${rows
      .map(
        ([k, val]) =>
          `<tr><td style="padding:2px 16px 2px 0">${k}</td><td style="padding:2px 0"><b>${val}</b></td></tr>`,
      )
      .join("")}</table>`;
  const html = [
    `<p><b>The last 7 days</b> (${week})</p>`,
    table(recent),
    visitors ? `<p>Visitors: <a href="${VISITORS_URL}">Vercel Web Analytics</a></p>` : "",
    `<p><b>How the week before's sign-ups did</b> (${cohort}, a full first week each)</p>`,
    table(steps),
    `<p>${advice}</p>`,
  ].join("\n");
  return { subject, text, html };
}

type AuthUser = { _id: string; createdAt: number; emailVerified: boolean };
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** People who signed up in [from, to): a page of Better Auth's users, by creation time. */
export const usersPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }) => {
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      where: [
        { field: "createdAt", operator: "gte", value: from },
        { field: "createdAt", operator: "lt", value: to },
      ],
      paginationOpts: { numItems: PAGE, cursor },
    })) as unknown as Page<AuthUser>;
    return {
      page: res.page.map((u) => ({ id: u._id, at: u.createdAt, verified: u.emailVerified })),
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

/** A person's agent approvals (OAuth grants), up to a hundred. */
async function consentsFor(ctx: QueryCtx, userId: string) {
  const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "oauthConsent",
    where: [{ field: "userId", value: userId }],
    paginationOpts: { numItems: 100, cursor: null },
  })) as unknown as Page<{ clientId: string; createdAt?: number | null }>;
  return res.page;
}

/** When each of these people approved an agent. */
export const consentsOf = internalQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, { userIds }) => {
    const out: Record<string, number[]> = {};
    for (const userId of userIds) {
      out[userId] = (await consentsFor(ctx, userId))
        .map((c) => c.createdAt ?? 0)
        .filter((t) => t > 0);
    }
    return out;
  },
});

/**
 * The big three by their apps: Claude Code and the Claude apps are Claude,
 * Codex and ChatGPT are ChatGPT, and Cursor (whose plugins Grok Bot takes)
 * and Grok are Grok.
 */
const LABS: [string, string[]][] = [
  ["Claude", ["Claude Code", "Claude"]],
  ["ChatGPT", ["Codex", "ChatGPT"]],
  ["Grok", ["Cursor", "Grok"]],
];

/**
 * The agents connected, by lab: each of the big three with its apps, then
 * "more" with every other app, in the order given (most first, "other"
 * last). Pure.
 */
export function byLab(apps: [string, number][]): string {
  const group = (name: string, rows: [string, number][]) =>
    `${name} ${rows.reduce((sum, [, n]) => sum + n, 0)} (${rows.map(([app, n]) => `${app} ${n}`).join(", ")})`;
  const parts = LABS.map(
    ([lab, names]) => [lab, apps.filter(([app]) => names.includes(app))] as const,
  )
    .filter(([, rows]) => rows.length > 0)
    .map(([lab, rows]) => group(lab, rows));
  const more = apps.filter(([app]) => !LABS.some(([, names]) => names.includes(app)));
  if (more.length) parts.push(group("more", more));
  return parts.join("; ");
}

export type Lane = "coding" | "desktop" | "other";

/**
 * The lanes by their apps: the coding agents (Connect's four, and the others
 * that connect through MCP + Skills), and the desktop agents that work on
 * your computer.
 */
const LANES: [Lane, string[]][] = [
  ["coding", ["Claude Code", "Codex", "Cursor", "GitHub Copilot", "OpenCode", "Antigravity"]],
  ["desktop", ["Claude", "ChatGPT", "Grok"]],
];

/**
 * The lane an app (appOf's) is in: a coding agent, a desktop agent, or
 * other. The marketing follows the lane the paying libraries use. Pure.
 */
export function laneOf(app: string): Lane {
  return LANES.find(([, apps]) => apps.includes(app))?.[0] ?? "other";
}

/** Agents approved in [from, to), counted by app. */
export const consentsPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }) => {
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "oauthConsent",
      where: [
        { field: "createdAt", operator: "gte", value: from },
        { field: "createdAt", operator: "lt", value: to },
      ],
      paginationOpts: { numItems: CONSENT_PAGE, cursor },
    })) as unknown as Page<{ clientId: string }>;
    const apps: Record<string, number> = {};
    for (const c of res.page) {
      const app = appOf(await clientName(ctx, c.clientId));
      apps[app] = (apps[app] ?? 0) + 1;
    }
    return { apps, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Writes made in [from, to): who for, when, and whether one created a concept. */
export const writesPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }) => {
    const res = await ctx.db
      .query("revisions")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", from).lt("_creationTime", to))
      .paginate({ numItems: REVISION_PAGE, cursor });
    return {
      page: res.page.map((r) => ({
        userId: r.userId ?? null,
        at: r._creationTime,
        created: r.kind === "create",
      })),
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

/** Searches made in [from, to): who by, and when. */
export const searchesPage = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }) => {
    const res = await ctx.db
      .query("questions")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", from).lt("_creationTime", to))
      .paginate({ numItems: PAGE, cursor });
    return {
      page: res.page.map((q) => ({ userId: q.userId ?? null, at: q._creationTime })),
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

/** Files refused in [from, to), by kind. */
export const refusedIn = internalQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const out = { audio: 0, video: 0, other: 0 };
    for await (const r of ctx.db
      .query("refusals")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", from).lt("_creationTime", to))) {
      out[r.kind] += 1;
    }
    return out;
  },
});

/** The most any one library keeps: concepts, bytes kept, and text (three index reads). */
export const largest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const most = (index: "by_concepts" | "by_source_bytes" | "by_text_bytes") =>
      ctx.db.query("workspaces").withIndex(index).order("desc").first();
    return {
      concepts: (await most("by_concepts"))?.conceptCount ?? 0,
      bytes: (await most("by_source_bytes"))?.sourceBytes ?? 0,
      textBytes: (await most("by_text_bytes"))?.textBytes ?? 0,
    };
  },
});

/** Free libraries the last 20% gets read from (NEAR of Free's ceilings). */
const NEAR = 0.8;
/** At most this many libraries read per count, so the email's reads stay bounded. */
const NEAR_CAP = 1_000;

/**
 * Free libraries at NEAR or more of Free's concepts and of its storage, read
 * from the largest down on each index, so the reads are the libraries counted.
 */
export const nearFree = internalQuery({
  args: {},
  handler: async (ctx) => {
    const concepts = await ctx.db
      .query("workspaces")
      .withIndex("by_concepts", (q) => q.gte("conceptCount", CONCEPT_QUOTAS.free * NEAR))
      .take(NEAR_CAP);
    const storage = await ctx.db
      .query("workspaces")
      .withIndex("by_source_bytes", (q) => q.gte("sourceBytes", SOURCE_BYTES.free * NEAR))
      .take(NEAR_CAP);
    const free = (rows: { plan: string }[]) => rows.filter((w) => w.plan === "free").length;
    return { concepts: free(concepts), storage: free(storage) };
  },
});

/**
 * Libraries on a paid plan with a live subscription: only those that ever had
 * a Stripe customer, and not one a Team covers (its home pays, teamCover.ts).
 */
export const paying = internalQuery({
  args: {},
  handler: async (ctx) => {
    const customers = await ctx.db
      .query("workspaces")
      .withIndex("by_stripe_customer", (q) => q.gte("stripeCustomerId", ""))
      .collect();
    const live = customers.filter(
      (w) =>
        w.plan !== "free" &&
        !w.coveredBy &&
        ["active", "trialing", "past_due"].includes(w.subscriptionStatus ?? ""),
    );
    return {
      individual: live.filter((w) => w.plan === "individual").length,
      team: live.filter((w) => w.plan === "team").length,
      ids: live.map((w) => w._id),
    };
  },
});

/**
 * The lanes of the agents a library's members approved (laneOf), read one
 * library at a time, so a query's reads stay within one team's seats.
 */
export const lanesOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const lanes = new Set<Lane>();
    for (const m of members) {
      for (const c of await consentsFor(ctx, m.userId)) {
        lanes.add(laneOf(appOf(await clientName(ctx, c.clientId))));
      }
      if (lanes.size === 3) break;
    }
    return [...lanes];
  },
});

/** The week ending `now`, and the funnel of the week before's sign-ups. */
async function weekOf(ctx: ActionCtx, now: number): Promise<Week> {
  const from = now - WEEK;
  const cohortFrom = from - WEEK;

  // Every page of a paginated internal query, in order.
  async function all<T>(
    fetch: (
      cursor: string | null,
    ) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    for (;;) {
      const res = await fetch(cursor);
      out.push(...res.page);
      if (res.isDone) return out;
      cursor = res.continueCursor;
    }
  }

  const recentUsers = await all((cursor) =>
    ctx.runQuery(internal.funnel.usersPage, { from, to: now, cursor }),
  );
  const cohortUsers = await all((cursor) =>
    ctx.runQuery(internal.funnel.usersPage, { from: cohortFrom, to: from, cursor }),
  );
  const writes = await all((cursor) =>
    ctx.runQuery(internal.funnel.writesPage, { from: cohortFrom, to: now, cursor }),
  );
  const searches = await all((cursor) =>
    ctx.runQuery(internal.funnel.searchesPage, { from: cohortFrom, to: now, cursor }),
  );
  const byApp: Record<string, number> = {};
  let cursor: string | null = null;
  for (;;) {
    const res: { apps: Record<string, number>; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(internal.funnel.consentsPage, { from, to: now, cursor });
    for (const [app, n] of Object.entries(res.apps)) byApp[app] = (byApp[app] ?? 0) + n;
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  // Most first; "other" last, whatever its count.
  const agentsByApp = Object.entries(byApp).sort(
    ([a, x], [b, y]) =>
      Number(a === "other") - Number(b === "other") || y - x || a.localeCompare(b),
  );
  const agentsConnected = agentsByApp.reduce((sum, [, n]) => sum + n, 0);
  const consents: Record<string, number[]> = await ctx.runQuery(internal.funnel.consentsOf, {
    userIds: cohortUsers.map((u) => u.id),
  });

  const { individual, team, ids } = await ctx.runQuery(internal.funnel.paying, {});
  const byLane: Record<Lane, number> = { coding: 0, desktop: 0, other: 0 };
  for (const workspaceId of ids) {
    for (const lane of await ctx.runQuery(internal.funnel.lanesOf, { workspaceId })) {
      byLane[lane] += 1;
    }
  }

  const timesFor = (rows: { userId: string | null; at: number }[], userId: string) =>
    rows.filter((r) => r.userId === userId).map((r) => r.at);
  const people: Person[] = cohortUsers.map((u) => ({
    signedUpAt: u.at,
    verified: u.verified,
    connectedAt: consents[u.id] ?? [],
    writes: timesFor(writes, u.id),
    searches: timesFor(searches, u.id),
  }));

  return {
    from,
    to: now,
    signUps: recentUsers.filter((u) => u.verified).length,
    unverified: recentUsers.filter((u) => !u.verified).length,
    agentsConnected,
    agentsByApp,
    conceptsWritten: writes.filter((w) => w.created && w.at >= from).length,
    searches: searches.filter((s) => s.at >= from).length,
    paying: { individual, team, byLane },
    nearFree: await ctx.runQuery(internal.funnel.nearFree, {}),
    refused: await ctx.runQuery(internal.funnel.refusedIn, { from, to: now }),
    largest: await ctx.runQuery(internal.funnel.largest, {}),
    cohort: { from: cohortFrom, to: from, funnel: funnelOf(people) },
  };
}

/** The numbers, without sending: `npx convex run --prod funnel:preview`. */
export const preview = internalAction({
  args: {},
  handler: async (ctx) => {
    const week = await weekOf(ctx, Date.now());
    return { week, email: funnelEmail(week, SELF_HOST) };
  },
});

/** Send the email to LIBROCAT_FUNNEL_EMAIL now; the Monday cron calls this. */
export const send = internalAction({
  args: {},
  handler: async (ctx) => {
    const to = ownerAddresses();
    if (to.length === 0) return { sent: 0 };
    const email = funnelEmail(await weekOf(ctx, Date.now()), SELF_HOST);
    for (const address of to) await sendEmail({ to: address, ...email });
    return { sent: to.length };
  },
});
