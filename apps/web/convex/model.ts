/**
 * Shared data logic. Both the dashboard functions (concepts.ts, auth-scoped)
 * and the remote MCP endpoint (mcp.ts, token-scoped) call these helpers, so
 * reads and writes behave the same in one place.
 *
 * Everything that is not storage comes from `@librocat/core/format` (pure, no
 * node:fs): the OKF format, ids, links, snippets, statuses, and the
 * library-science algorithms, applied here to Convex rows.
 *
 * Storage: a concept is a `concepts` row (the catalog record: metadata and
 * links) plus a `bodies` row (the Markdown body and the search text). The
 * metadata paths collect a whole workspace in one transaction, which Convex
 * caps at 16 MiB read, so bodies stay out of those rows.
 */

import {
  assertNoSecrets,
  bfsGraph,
  buildFrontmatter,
  canonicalId,
  checkStaleAfter,
  checkStatus,
  demoteDeprecated,
  deriveConceptId,
  extractLinks,
  isReservedId,
  isStale,
  makeSnippet,
  markChanged,
  markVerified,
  matchesFilters,
  pathFacetOf,
  pathsAbove,
  retargetLinks,
  STATUSES,
  type Status,
  sourcesOf,
  staleAfterOf,
  stemQuery,
  stemText,
  weedRules,
  withSources,
} from "@librocat/core/format";
import {
  ADDITIONS_DAYS,
  expandQuery,
  logDay,
  neighborQuery,
  normalizeTags,
  normalType,
  notFoundMessage,
  renderFindingAids,
  reusedNote,
  shelfPrefix,
  type Term,
  THESAURUS_CONCEPT,
  THESAURUS_ID,
  type Thesaurus,
  type Tombstone,
  tagFacet,
  thesaurusFrom,
  withTerm,
} from "@librocat/core/library";
import { normalizeCite, parseSourceRef, sourceCite } from "@librocat/core/sources";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hasAi, modelsInUse } from "./ai";
import { sizeOf, takeUpTo } from "./size";
import { payerOf, pooled, poolOf } from "./teamCover";

// Every quota in librocat is stated in concepts, never in bytes or GB — a
// concept is the unit of memory users think in. Plans: free (a hosted
// library to start with: 1,000 concepts, cataloged by Jev), individual
// ($12/mo, $10/mo annual, per library), team ($15 a person a month, $12.50
// annual, 3 people or more). A self-hosted librocat (LIBROCAT_SELF_HOST=1,
// below) has no plans. Source copies are the one exception to "never bytes":
// their text is capped in bytes (SOURCE_BYTES).
//
// The ceiling: the metadata paths collect every `concepts` row of a workspace
// in one transaction (16 MiB read, 32,000 documents scanned). At under 1 KB
// per catalog record, 15,000 rows read about 12 MiB.
// ponytail: paginate list/status/weeding before selling more than ~15k.
export const CONCEPT_QUOTAS = { free: 1_000, individual: 5_000, team: 15_000 } as const;

/**
 * Team is priced per person (a seat), at least MIN_TEAM_SEATS and at most
 * MAX_TEAM_SEATS; the subscription's quantity is the seats (stripe.ts).
 * Free and Individual have one.
 */
export const MIN_TEAM_SEATS = 3;
export const MAX_TEAM_SEATS = 100;

/**
 * Free libraries one person may own. One: enough to find out what librocat
 * does, and a second library (a client's, a team's) is a reason to pay. Each
 * library has its own plan and quota; a paid one never counts here.
 */
export const FREE_LIBRARIES = 1;

// Index credits: automatic cataloging (indexation.ts). After `ingest` or
// `update`, a Convex action catalogs a concept that arrived without a
// description or without tags: Jev selects a sentence and tags from what the
// concept and the library already have, through the Vercel AI Gateway with
// librocat's own key, and writes nothing (the person's agent writes). One
// indexed concept spends one credit. Each plan includes this many credits per
// calendar month; past them, indexation continues only when the workspace
// opted into pay-as-you-go (INDEX_CREDIT_OVERAGE_CENTS per credit, metered
// through Stripe), up to its monthly cap. A self-hosted librocat uses the Jev
// its operator names (ai.ts). Free gets fewer than Individual: more on a paid
// plan would cost more than it brings in (BLOCKER, "Is librocat profitable?"),
// and fewer on Free cost nothing and give a reason to upgrade.
export const INDEX_CREDITS = { free: 200, individual: 500, team: 2_500 } as const;
export const INDEX_CREDIT_OVERAGE_CENTS = 1;

/**
 * Pay-as-you-go's monthly cap, in cents: the most a library's extra credits
 * bill in a calendar month. Its admins set it on Billing, in whole dollars
 * from min to max; unset reads as the default. Past it, indexing waits, as it
 * does without pay-as-you-go. The admins get an email at CAP_WARNING of the
 * cap and at the cap (convex/billing.ts).
 */
export const PAY_AS_YOU_GO_CAP_CENTS = { default: 1_000, min: 100, max: 100_000 } as const;
export const CAP_WARNING = 0.8;

/** A library's pay-as-you-go cap for a month, in cents. */
export const capCentsOf = (ws: Pick<Doc<"workspaces">, "payAsYouGoCapCents">) =>
  ws.payAsYouGoCapCents ?? PAY_AS_YOU_GO_CAP_CENTS.default;

/**
 * The cap email a pay-as-you-go spend calls for: 100 when it reaches the cap
 * or is refused for it (`afterCents` null), 80 from CAP_WARNING of the cap,
 * null below. Pure, exported for tests.
 */
export function capNotice(capCents: number, afterCents: number | null): 80 | 100 | null {
  if (afterCents === null || afterCents >= capCents) return 100;
  return afterCents >= capCents * CAP_WARNING ? 80 : null;
}

/**
 * Kept sources (convex/sources.ts, convex/attachments.ts), per library: the
 * text agents keep and the files people attach, counted together. A file is
 * cheap to keep (Convex Pro: 100 GB included, then $0.03 a GB a month), and
 * reading it spends no index credits: no model reads it. One source's text
 * holds at most MAX_SOURCE_BYTES.
 */
export const SOURCE_BYTES = {
  free: 100_000_000,
  individual: 5_000_000_000,
  team: 25_000_000_000,
} as const;

/**
 * Of SOURCE_BYTES, how much may be text: kept text, and text read from
 * attached files. Text lives in the database, where a GB costs about $4 a
 * month with its daily backup and word-search index, against $0.03 for a GB
 * of files; so it gets its own ceiling. A file past it is kept without its
 * text (found by its title); text past it is refused.
 */
export const TEXT_BYTES = {
  free: 10_000_000,
  individual: 250_000_000,
  team: 1_000_000_000,
} as const;

/**
 * The largest file one attachment may be: what a Node action (512 MB) can
 * read whole. Free keeps it smaller. A self-hosted librocat stores a bigger
 * file, but doesn't read it.
 */
export const MAX_FILE_BYTES = { free: 50_000_000, paid: 200_000_000 } as const;

/**
 * A self-hosted deployment (LIBROCAT_SELF_HOST=1) has no plans: every limit
 * is the operator's own, and billing is off. Without the flag the plan
 * limits apply, so a hosted deployment can never fall open by accident.
 */
export const SELF_HOST = process.env.LIBROCAT_SELF_HOST === "1";
const UNLIMITED = 1_000_000_000;
type Plan = keyof typeof CONCEPT_QUOTAS;
export const conceptQuota = (plan: Plan) => (SELF_HOST ? UNLIMITED : CONCEPT_QUOTAS[plan]);
export const includedIndexCredits = (plan: Plan) => (SELF_HOST ? UNLIMITED : INDEX_CREDITS[plan]);
export const sourceQuota = (plan: Plan) =>
  SELF_HOST ? Number.POSITIVE_INFINITY : SOURCE_BYTES[plan];
/** Of a library's source quota, how much may be text (TEXT_BYTES). */
export const textQuota = (plan: Plan) => (SELF_HOST ? Number.POSITIVE_INFINITY : TEXT_BYTES[plan]);
/** The largest file a library on `plan` may attach; self-hosted, any (bigger ones stay unread). */
export const maxFileBytes = (plan: Plan) =>
  SELF_HOST
    ? Number.POSITIVE_INFINITY
    : plan === "free"
      ? MAX_FILE_BYTES.free
      : MAX_FILE_BYTES.paid;
/** People a library can have (convex/team.ts): on Team, the seats its subscription pays for. */
export const seatsOf = (ws: { plan: Plan; seats?: number }) =>
  SELF_HOST
    ? UNLIMITED
    : ws.plan === "team"
      ? Math.min(MAX_TEAM_SEATS, Math.max(MIN_TEAM_SEATS, ws.seats ?? MIN_TEAM_SEATS))
      : 1;
export const freeLibraries = () => (SELF_HOST ? UNLIMITED : FREE_LIBRARIES);
/**
 * What paid plans add (the reading list and source watch, weekly reports),
 * on a paid plan or on a self-hosted librocat, which has no plans.
 */
export const paidFeatures = (plan: Plan) => SELF_HOST || plan !== "free";

/**
 * The revision history a library keeps (recordRevision): the last
 * REVISIONS_PER_CONCEPT of each concept, and at most REVISIONS_KEPT in all,
 * two for each concept its plan allows. Past either, the oldest go first. A
 * revision holds the concept whole (up to MAX_BODY_BYTES), so this bounds
 * what history can cost in the database and its daily backup. A self-hosted
 * librocat keeps every one.
 */
export const REVISIONS_PER_CONCEPT = 100;
export const REVISIONS_KEPT = { free: 2_000, individual: 10_000, team: 30_000 } as const;
export const revisionsKept = (plan: Plan) => (SELF_HOST ? UNLIMITED : REVISIONS_KEPT[plan]);

// A concept is one idea. The body cap keeps storage and search costs bounded
// per concept (the quota is a count; a body is stored three times, for its
// two search indexes) and enforces the authoring rule "summarize and link,
// do not paste whole files". 16 KB is about 2,500 words; a self-hosted
// librocat takes 64 KB, so bundles from before the cap still push.
export const MAX_BODY_BYTES = SELF_HOST ? 64_000 : 16_000;
/**
 * A concept's catalog record (its frontmatter: title, description, tags,
 * sources) and its links have ceilings too: every list, pass, and search
 * reads the record, so a few huge ones would make each of them heavy.
 */
export const MAX_RECORD_BYTES = SELF_HOST ? 16_000 : 4_000;
export const MAX_LINKS = SELF_HOST ? 1_000 : 200;
/** The tag thesaurus, read by every write and search. */
export const MAX_THESAURUS_BYTES = 64_000;

/** OKF lifecycle statuses (from the core); re-exported for the Convex validators. */
export { STATUSES, type Status };

/** Current UTC calendar month, the index-credit period key. */
export function currentPeriod(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

/**
 * Whether pay-as-you-go billed credits this month, so a cancellation bills
 * them at once (stripe.ts cancelSubscription) rather than a $0 invoice.
 */
export function usedPayAsYouGo(
  ws: Pick<Doc<"workspaces">, "indexPeriod" | "indexOverage">,
  now = Date.now(),
): boolean {
  return ws.indexPeriod === currentPeriod(now) && (ws.indexOverage ?? 0) > 0;
}

/**
 * Spend `n` index credits: the plan's included credits first, then metered
 * pay-as-you-go on a paid plan that turned it on, up to its monthly cap. Null
 * when there aren't enough: the caller leaves the work for later, and nothing
 * is spent. Pay-as-you-go waits while a payment is overdue (Stripe's
 * `past_due`, when the plan stays on while Stripe retries the card), so
 * nothing more is billed to a card that isn't paying; it resumes once Stripe
 * collects. A self-hosted librocat never runs out. `includedUpTo` keeps
 * the included credits this spend may reach below the plan's (a file's
 * reads: half, spendFileCredit).
 */
export async function spendCredits(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  n: number,
  { includedUpTo = includedIndexCredits(ws.plan) }: { includedUpTo?: number } = {},
): Promise<{ kind: "credit" | "overage"; period: string; n: number } | null> {
  // A Team's libraries spend its home's credits, under its pay-as-you-go (teamCover.ts).
  const payer = await payerOf(ctx, ws);
  const period = currentPeriod();
  const fresh = payer.indexPeriod === period;
  const used = fresh ? (payer.indexUsed ?? 0) : 0;
  const overage = fresh ? (payer.indexOverage ?? 0) : 0;
  if (used + n <= includedUpTo) {
    await ctx.db.patch(payer._id, {
      indexPeriod: period,
      indexUsed: used + n,
      indexOverage: overage,
    });
    return { kind: "credit", period, n };
  }
  if (payAsYouGoOn(payer)) {
    const cap = capCentsOf(payer);
    const after = (overage + n) * INDEX_CREDIT_OVERAGE_CENTS;
    // After the cap email, nothing more is billed this month, as it says,
    // even if a smaller item would still fit; a new cap clears the email.
    const capped = payer.capNotice?.period === period && payer.capNotice.level >= 100;
    const allowed = !capped && after <= cap;
    await noticeCap(ctx, payer, period, capNotice(cap, allowed ? after : null));
    if (!allowed) return null;
    await ctx.db.patch(payer._id, {
      indexPeriod: period,
      indexUsed: used,
      indexOverage: overage + n,
    });
    return { kind: "overage", period, n };
  }
  return null;
}

/**
 * How many credits a library could spend now (spendCredits): what's left of
 * the month's, then pay-as-you-go up to its cap. `payer` is the library that
 * pays (payerOf).
 */
export function creditsLeft(payer: Doc<"workspaces">): number {
  const c = indexCreditsOf(payer);
  if (!payAsYouGoOn(payer)) return c.remaining;
  const capped = payer.capNotice?.period === c.period && payer.capNotice.level >= 100;
  const overage = Math.floor((c.cap_cents - c.overage_cents) / INDEX_CREDIT_OVERAGE_CENTS);
  return c.remaining + (capped ? 0 : Math.max(0, overage));
}

/**
 * Give back a credit spendCredits took, when the work it paid for couldn't
 * run (Jev unreachable): to the library that paid it (payerOf), and only
 * inside the period it came from.
 */
export async function refundCredit(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  kind: string,
  period: string,
) {
  const payer = await payerOf(ctx, ws);
  if (payer.indexPeriod !== period) return;
  await ctx.db.patch(
    payer._id,
    kind === "credit"
      ? { indexUsed: Math.max(0, (payer.indexUsed ?? 0) - 1) }
      : { indexOverage: Math.max(0, (payer.indexOverage ?? 0) - 1) },
  );
}

/**
 * A credit for one read of a person's file (fileCatalog.ts): an included
 * credit while more than half of the month's are left, so a big upload
 * can't spend what concepts need; past the half, pay-as-you-go when it's on
 * (under the cap, as spendCredits). Otherwise null: the file waits, and
 * Libro reads the rest when credits renew.
 */
export async function spendFileCredit(ctx: MutationCtx, ws: Doc<"workspaces">) {
  return await spendCredits(ctx, ws, 1, { includedUpTo: includedIndexCredits(ws.plan) / 2 });
}

/** Whether pay-as-you-go bills now: on, on a paid plan, and no payment overdue. */
export const payAsYouGoOn = (ws: Doc<"workspaces">): boolean =>
  ws.payAsYouGo === true && ws.plan !== "free" && ws.subscriptionStatus !== "past_due";

/** Email the library's admins about its cap, once a month for each level (billing.ts). */
async function noticeCap(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  period: string,
  level: 80 | 100 | null,
) {
  const sent = ws.capNotice?.period === period ? ws.capNotice.level : 0;
  if (!level || level <= sent) return;
  await ctx.db.patch(ws._id, { capNotice: { period, level } });
  await ctx.scheduler.runAfter(0, internal.billing.sendCapNotice, { workspaceId: ws._id, level });
}

/** The workspace's index-credit state for the current period (a lapsed period reads as zero). */
export function indexCreditsOf(ws: Doc<"workspaces">, now = Date.now()) {
  const period = currentPeriod(now);
  const fresh = ws.indexPeriod === period;
  const included = includedIndexCredits(ws.plan);
  const used = fresh ? (ws.indexUsed ?? 0) : 0;
  const overage = fresh ? (ws.indexOverage ?? 0) : 0;
  return {
    period,
    included,
    used,
    remaining: Math.max(0, included - used),
    overage,
    pay_as_you_go: ws.payAsYouGo === true,
    // On, but waiting while a payment is overdue (payAsYouGoOn).
    ...(ws.payAsYouGo === true && !payAsYouGoOn(ws) && ws.plan !== "free"
      ? { pay_as_you_go_paused: true }
      : {}),
    // On, and this month's cap reached: its email went out (spendCredits).
    ...(ws.payAsYouGo === true && ws.capNotice?.period === period && ws.capNotice.level >= 100
      ? { pay_as_you_go_capped: true }
      : {}),
    overage_cents_per_credit: INDEX_CREDIT_OVERAGE_CENTS,
    // This month's pay-as-you-go so far, and its cap, in cents.
    overage_cents: overage * INDEX_CREDIT_OVERAGE_CENTS,
    cap_cents: capCentsOf(ws),
  };
}

export interface ConceptArgs {
  type: string;
  title?: string;
  description?: string;
  body?: string;
  tags?: string[];
  id?: string;
  status?: string;
  /** OKF `stale_after`: when to check this concept again (ISO date). */
  stale_after?: string;
  /** What the concept describes (OKF `sources`): repository paths or URLs. */
  sources?: string[];
  /** Extra frontmatter keys to set (e.g. supersededBy, terms). Existing unknown keys are kept. */
  extra?: Record<string, unknown>;
}

function summaryOf(doc: Doc<"concepts">) {
  const fm = (doc.frontmatter ?? {}) as Record<string, unknown>;
  return {
    id: doc.cid,
    type: doc.type,
    title: doc.title ?? null,
    description: doc.description ?? null,
    resource: fm.resource == null ? null : String(fm.resource),
    tags: doc.tags,
    status: doc.status,
    superseded_by: fm.supersededBy == null ? null : String(fm.supersededBy),
    stale_after: staleAfterOf(fm),
    stale: isStale(fm.stale_after),
    // How many kept sources it cites (`source:<sid>`): read from the doc, no lookup.
    cites: sourcesOf(fm).filter((r) => normalizeCite(r)?.startsWith("source:")).length,
    path: null as string | null,
  };
}

// ---- author entry (Cutter's object D) -----------------------------------------------

const ACTOR_PREFIX = /^(human|process):/;

/**
 * The author keys a write adds to its concept: the person it was made for
 * (`human:<userId>`) and the agent that made it (its client name), or the
 * process (`process:libro`). The cataloger fills in catalog fields and is not
 * an author.
 */
function authorKeys(by: Writer): string[] {
  const w = writerFields(by);
  if (w.by === "indexer") return [];
  const keys = [...(w.userId ? [`human:${w.userId}`] : []), ...(w.client ? [w.client] : [])];
  if (keys.length > 0) return keys;
  return [w.by === "agent" ? "agent" : `process:${w.by}`];
}

export const userById = (ctx: QueryCtx, id: string) =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: id }],
  }) as Promise<{ _id: string; email: string } | null>;

/** A member of the workspace by email, as an author key; null when nobody there has it. */
async function memberKey(ctx: QueryCtx, ws: Id<"workspaces">, email: string) {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: email.trim().toLowerCase() }],
  })) as { _id: string } | null;
  if (!user) return null;
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  return member.some((m) => m.workspaceId === ws) ? `human:${user._id}` : null;
}

/**
 * The `author` filter as a test on a concept's authors: "me" (the caller), a
 * member's email (also as `human:<email>`), an OKF actor (`human:<id>`,
 * `process:libro`), or an agent's name, case aside. An email that is not a
 * member's matches nothing.
 */
export async function authorFilter(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  author: string,
  me?: string,
): Promise<(authors: string[] | undefined) => boolean> {
  const a = author.trim();
  const email = a.replace(/^human:/, "");
  let key: string | null;
  if (a.toLowerCase() === "me") key = me ? `human:${me}` : null;
  else if (email.includes("@")) key = await memberKey(ctx, ws, email);
  else if (ACTOR_PREFIX.test(a)) key = a;
  else {
    const name = a.toLowerCase();
    return (authors) =>
      (authors ?? []).some((k) => !ACTOR_PREFIX.test(k) && k.toLowerCase() === name);
  }
  return (authors) => key !== null && (authors ?? []).includes(key);
}

/** The exact author key an `author` filter names, or null when it matches agents by name. */
async function authorKeyOf(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  author: string,
  me?: string,
): Promise<string | null> {
  const a = author.trim();
  const email = a.replace(/^human:/, "");
  if (a.toLowerCase() === "me") return me ? `human:${me}` : null;
  if (email.includes("@")) return await memberKey(ctx, ws, email);
  return ACTOR_PREFIX.test(a) ? a : null;
}

/** A concept's authors as readers see them: people by email, agents by name. */
async function authorsOf(ctx: QueryCtx, keys: string[] | undefined): Promise<string[]> {
  const out: string[] = [];
  for (const k of keys ?? []) {
    const id = k.startsWith("human:") ? k.slice("human:".length) : null;
    const user = id ? await userById(ctx, id) : null;
    out.push(user ? `human:${user.email}` : k);
  }
  return out;
}

// ---- library science: thesaurus, weeding, finding aids -----------------------

/** The workspace's tag thesaurus, read from the `thesaurus` concept. */
export async function thesaurusOf(ctx: QueryCtx, ws: Id<"workspaces">): Promise<Thesaurus> {
  const row = await getByCid(ctx, ws, THESAURUS_ID);
  return thesaurusFrom(row?.frontmatter as Record<string, unknown> | undefined);
}

/** Set (or remove, with null) one preferred tag's relations. */
export async function setTerm(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  tag: string,
  term: Term | null,
  by: Writer = "agent",
) {
  const next = withTerm(await thesaurusOf(ctx, ws._id), tag, term);
  if (sizeOf(next) > MAX_THESAURUS_BYTES) {
    throw new Error(
      `the thesaurus would be over ${Math.round(MAX_THESAURUS_BYTES / 1000)} KB: shorten scope ` +
        "notes, or remove terms no concept uses",
    );
  }
  const existing = await getByCid(ctx, ws._id, THESAURUS_ID);
  await writeRow(
    ctx,
    ws,
    THESAURUS_ID,
    { ...THESAURUS_CONCEPT, extra: { terms: next } },
    existing,
    by,
  );
  return { thesaurus: next };
}

/** The most concepts one retag changes in a transaction; the rest follow (libro.ts retagMore). */
export const RETAG_PAGE = 500;

/**
 * Retag the concepts carrying `from` to `to` (a synonym folded into its
 * preferred tag), RETAG_PAGE at a time: how many changed, and whether more
 * carry it.
 */
export async function retag(ctx: MutationCtx, ws: Id<"workspaces">, from: string, to: string) {
  const filed = await filedUnder(ctx, ws, "tag", from).take(RETAG_PAGE);
  let changed = 0;
  for (const f of filed) {
    const d = await getByCid(ctx, ws, f.cid);
    if (!d?.tags.includes(from)) continue;
    const tags = [...new Set(d.tags.map((t) => (t === from ? to : t)))];
    const fm = { ...(d.frontmatter as Record<string, unknown>), tags };
    await ctx.db.patch(d._id, {
      tags,
      frontmatter: fm,
      updatedAt: Date.now(),
      catalogStem: catalogStemOf({ ...d, tags }),
    });
    const b = await bodyOf(ctx, ws, d.cid);
    if (b) await ctx.db.patch(b._id, searchFieldsOf({ ...d, tags, body: b.body }));
    await reindexConcept(ctx, ws, d, await ctx.db.get(d._id));
    changed += 1;
  }
  return { changed, more: filed.length === RETAG_PAGE };
}

/**
 * Finding aids: one Markdown shelf list per directory (optionally under
 * `dir`). The root one opens with the list of additions: what arrived in the
 * last ADDITIONS_DAYS.
 */
export async function findingAids(ctx: QueryCtx, ws: Doc<"workspaces">, dir?: string) {
  const scan = await scanConcepts(ctx, ws, "id");
  const { docs, whole } = scan;
  const wanted = dir?.replace(/^\/+|\/+$/g, "");
  const since = Date.now() - ADDITIONS_DAYS * 86_400_000;
  const aids = renderFindingAids(
    docs.map((d) => ({
      id: d.cid,
      title: d.title ?? null,
      description: d.description ?? null,
      type: d.type,
      status: d.status,
      added: d._creationTime,
    })),
    { additions: { since } },
  ).filter((a) => wanted === undefined || a.dir === wanted || a.dir.startsWith(`${wanted}/`));
  return {
    aids,
    written: 0,
    note:
      "Cloud returns the aids; the export zip includes them as index.md" +
      (whole
        ? ""
        : `. ${scannedNote(ws, "the first by id; the export has every shelf", docs.length)}`),
  };
}

/**
 * The CREW/MUSTIE weeding report, mechanically, plus circulation: never
 * retrieved (or not in `days` days) and most retrieved.
 */
export async function weedReport(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  opts: { days?: number; limit?: number },
  /** A pass already read (the Overview shares one when the library fits it). */
  given?: Scan,
) {
  const days = Math.max(1, opts.days ?? 90);
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const cutoff = Date.now() - days * 86_400_000;
  // Weeding looks at what's gone longest unchanged first.
  const scan = given ?? (await scanConcepts(ctx, ws, "oldest"));
  const { docs, whole } = scan;
  // The mechanical rules run in the core (the same code as Local); only the
  // circulation lists are Cloud's own, because only Cloud records access.
  const w = weedRules(
    docs.map((d) => ({
      id: d.cid,
      status: d.status,
      links: d.links,
      description: d.description ?? null,
      tags: d.tags,
      stale_after: (d.frontmatter as Record<string, unknown> | undefined)?.stale_after,
    })),
    limit,
  );
  const never: string[] = [];
  for (const d of [...docs].sort((a, b) => (a.cid < b.cid ? -1 : 1))) {
    if (d.cid === THESAURUS_ID) continue;
    // Only concepts old enough to have had their chance count as never retrieved.
    if (d._creationTime < cutoff && (!d.lastAccessedAt || d.lastAccessedAt < cutoff)) {
      never.push(d.cid);
    }
  }
  const most = docs
    .filter((d) => (d.accessCount ?? 0) > 0)
    .sort((a, b) => (b.accessCount ?? 0) - (a.accessCount ?? 0))
    .slice(0, 10)
    .map((d) => ({ id: d.cid, retrievals: d.accessCount ?? 0 }));
  // Over part of a library, a link may point past the part: check those with the index.
  if (!whole) {
    const broken = [];
    for (const b of w.broken_links) {
      const missing = [];
      for (const id of b.missing) if (!(await getByCid(ctx, ws._id, id))) missing.push(id);
      if (missing.length > 0) broken.push({ ...b, missing });
    }
    const orphans = [];
    for (const id of w.orphans) {
      const inbound = await ctx.db
        .query("links")
        .withIndex("by_ws_dst", (q) => q.eq("workspaceId", ws._id).eq("dst", id))
        .first();
      if (!inbound) orphans.push(id);
    }
    w.broken_links = broken;
    w.orphans = orphans;
    w.counts = { ...w.counts, broken_links: broken.length, orphans: orphans.length };
  }
  return {
    days,
    ...w,
    counts: { ...w.counts, never_retrieved: never.length },
    never_retrieved: never.slice(0, limit),
    most_retrieved: most,
    ...(whole ? {} : { note: scannedNote(ws, "the longest unchanged", docs.length) }),
  };
}

/** A kept weeding report serves this long, while the library is unchanged. */
const WEEDING_FRESH_MS = 86_400_000;

/**
 * The weeding report for an agent's review_shelf, kept a day per library:
 * it reads up to the whole library, and an agent may ask again and again.
 * A write or delete since (the revision and concept counts) or other
 * options make a new one. Its circulation lists may be a day old.
 */
export async function keptWeedReport(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  opts: { days?: number; limit?: number },
): Promise<Awaited<ReturnType<typeof weedReport>>> {
  const key = [opts.days ?? "", opts.limit ?? "", ws.revisionCount ?? 0, ws.conceptCount].join(":");
  const kept = await ctx.db
    .query("weedings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
    .first();
  if (kept && kept.key === key && Date.now() - kept.at < WEEDING_FRESH_MS) {
    return kept.report as Awaited<ReturnType<typeof weedReport>>;
  }
  const report = await weedReport(ctx, ws, opts);
  const row = { workspaceId: ws._id, key, at: Date.now(), report };
  if (kept) await ctx.db.replace(kept._id, row);
  else await ctx.db.insert("weedings", row);
  return report;
}

// ---- rows -------------------------------------------------------------------------

export async function getByCid(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  return await ctx.db
    .query("concepts")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws).eq("cid", cid))
    .unique();
}

/**
 * Concepts' titles by id, for a dashboard page that names them: from `known`
 * (a scan the page already read), else a row read each, at most `max` ids.
 */
export async function titlesOf(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  cids: string[],
  known: Map<string, string> = new Map(),
  max = 200,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const cid of [...new Set(cids)].slice(0, max)) {
    const title = known.get(cid) || (await getByCid(ctx, ws, cid))?.title;
    if (title) out[cid] = title;
  }
  return out;
}

/** The body row of a concept (null for a record with no body row yet). */
export async function bodyOf(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  return await ctx.db
    .query("bodies")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws).eq("cid", cid))
    .unique();
}

// ---- accessions: an id is never reused (Dana, A Library Primer, ch. XIX) ---------

async function tombstoneRow(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  return await ctx.db
    .query("tombstones")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws).eq("cid", cid))
    .unique();
}

function asTombstone(row: Doc<"tombstones">): Tombstone {
  return {
    id: row.cid,
    at: logDay(row.at),
    ...(row.title ? { title: row.title } : {}),
    ...(row.movedTo ? { moved_to: row.movedTo } : {}),
  };
}

/** What became of an id that is not in the library: deleted, or renamed away. */
export async function tombstoneOf(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  cid: string,
): Promise<Tombstone | null> {
  const row = await tombstoneRow(ctx, ws, cid);
  return row ? asTombstone(row) : null;
}

/** Every retired id of the workspace, for the export's update log (log.md). */
export async function tombstonesOf(ctx: QueryCtx, ws: Id<"workspaces">): Promise<Tombstone[]> {
  const rows = await ctx.db
    .query("tombstones")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws))
    .take(5_000);
  return rows.map(asTombstone);
}

/** The not-found error for an id, saying what became of it. */
async function notFound(ctx: QueryCtx, ws: Id<"workspaces">, cid: string): Promise<Error> {
  return new Error(notFoundMessage(cid, await tombstoneOf(ctx, ws, cid)));
}

/** For a read of an id that is not there: an error when it was retired, else null. */
export async function explainMissing(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  if (await tombstoneRow(ctx, ws, cid)) throw await notFound(ctx, ws, cid);
  return null;
}

/** Retire an id: a concept was deleted, or renamed away from it (`movedTo`). */
async function retire(
  ctx: MutationCtx,
  ws: Id<"workspaces">,
  cid: string,
  fields: { title?: string; movedTo?: string },
) {
  const row = {
    workspaceId: ws,
    cid,
    at: Date.now(),
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.movedTo ? { movedTo: fields.movedTo } : {}),
  };
  const existing = await tombstoneRow(ctx, ws, cid);
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("tombstones", row);
}

export async function getConcept(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  const doc = await getByCid(ctx, ws, cid);
  if (!doc) return null;
  const b = await bodyOf(ctx, ws, cid);
  return {
    ...summaryOf(doc),
    frontmatter: doc.frontmatter,
    body: b?.body ?? "",
    created_at: doc._creationTime,
    updated_at: doc.updatedAt ?? null,
    last_accessed_at: doc.lastAccessedAt ?? null,
    access_count: doc.accessCount ?? 0,
    indexed_at: doc.indexedAt ?? null,
    authors: await authorsOf(ctx, doc.authors),
    // The sources it cites that the library keeps a copy of: `get_source` reads them.
    stored_sources: await storedSourcesOf(ctx, ws, doc.frontmatter),
  };
}

// ---- source copies (convex/sources.ts) ------------------------------------------------

/**
 * The kept copy a source string names: `source:<sid>`, a URL a copy was kept
 * from, or the path one was added from (the newest, when several were).
 */
export async function sourceByRef(ctx: QueryCtx, ws: Id<"workspaces">, ref: string) {
  const r = parseSourceRef(ref);
  if ("url" in r) {
    return await ctx.db
      .query("sources")
      .withIndex("by_workspace_location", (q) => q.eq("workspaceId", ws).eq("location", r.url))
      .order("desc")
      .first();
  }
  const bySid = await ctx.db
    .query("sources")
    .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws).eq("sid", r.sid))
    .unique();
  if (bySid || ref.trim().startsWith("source:")) return bySid;
  return await ctx.db
    .query("sources")
    .withIndex("by_workspace_location", (q) => q.eq("workspaceId", ws).eq("location", ref.trim()))
    .order("desc")
    .first();
}

/** A concept's cited sources that have a kept copy, for `get_concept`. */
async function storedSourcesOf(ctx: QueryCtx, ws: Id<"workspaces">, frontmatter: unknown) {
  const out: { cite: string; id: string; title: string; parts: number }[] = [];
  for (const ref of sourcesOf(frontmatter as Record<string, unknown>).slice(0, 20)) {
    const src = await sourceByRef(ctx, ws, ref);
    if (src) out.push({ cite: ref, id: src.sid, title: src.title, parts: src.parts });
  }
  return out;
}

// ---- the catalog index -----------------------------------------------------------
//
// What each concept is filed under (`facets`) and how many concepts carry each
// type and tag (`facetCounts`, with the library's links in all), kept as
// concepts change (reindexConcept), so a filter, a citation, or a count is a
// lookup: no call reads the whole library, whatever its size.

/** One thing a concept is filed under: its type, status, a tag, an author, a cite, a code path, or what supersedes it. */
export type Facet = { kind: string; value: string };

/** The kinds the library counts (`status`, cataloging). */
const COUNTED = new Set(["type", "tag"]);

const facetKey = (f: Facet) => `${f.kind}\u0000${f.value}`;

/**
 * What a concept is filed under; its cites, and the code paths among them,
 * only while it's live, as a citation counts. Pure.
 */
export function facetsOf(row: {
  type: string;
  status: string;
  tags: string[];
  authors?: string[];
  frontmatter?: unknown;
}): Facet[] {
  const out = new Map<string, Facet>();
  const add = (kind: string, value: unknown) => {
    if (typeof value === "string" && value) out.set(facetKey({ kind, value }), { kind, value });
  };
  add("type", row.type);
  add("status", row.status);
  for (const t of row.tags) add("tag", t);
  for (const a of row.authors ?? []) add("author", a);
  const fm = (row.frontmatter ?? {}) as Record<string, unknown>;
  if (row.status !== "deprecated") {
    for (const r of sourcesOf(fm)) {
      add("cite", normalizeCite(r));
      add("path", pathFacetOf(r));
    }
  }
  add("superseded_by", fm.supersededBy);
  return [...out.values()];
}

async function bumpCount(ctx: MutationCtx, ws: Id<"workspaces">, f: Facet, n: number) {
  const row = await ctx.db
    .query("facetCounts")
    .withIndex("by_kind_value", (q) =>
      q.eq("workspaceId", ws).eq("kind", f.kind).eq("value", f.value),
    )
    .unique();
  const count = (row?.count ?? 0) + n;
  if (row && count > 0) await ctx.db.patch(row._id, { count });
  else if (row) await ctx.db.delete(row._id);
  else if (count > 0) await ctx.db.insert("facetCounts", { workspaceId: ws, ...f, count });
}

/**
 * File a concept again after it changed: `before` and `after` are its rows
 * (null when it's new, or gone). Its facet rows change by the difference, and
 * so do the library's counts. A concept filed before the index existed is
 * filed whole (migrations.ts indexCatalog files the rest).
 */
export async function reindexConcept(
  ctx: MutationCtx,
  ws: Id<"workspaces">,
  before: Doc<"concepts"> | null,
  after: Doc<"concepts"> | null,
) {
  const rows = before
    ? await ctx.db
        .query("facets")
        .withIndex("by_cid", (q) => q.eq("workspaceId", ws).eq("cid", before.cid))
        .collect()
    : [];
  const filed = rows.length > 0;
  const was = filed && before ? facetsOf(before) : [];
  const is = after ? facetsOf(after) : [];
  const wasKeys = new Set(was.map(facetKey));
  const isKeys = new Set(is.map(facetKey));
  const moved = before !== null && after !== null && before.cid !== after.cid;
  for (const r of rows) if (moved || !isKeys.has(facetKey(r))) await ctx.db.delete(r._id);
  if (after) {
    for (const f of is) {
      if (moved || !wasKeys.has(facetKey(f))) {
        await ctx.db.insert("facets", { workspaceId: ws, cid: after.cid, ...f });
      }
    }
  }
  for (const f of was)
    if (COUNTED.has(f.kind) && !isKeys.has(facetKey(f))) await bumpCount(ctx, ws, f, -1);
  for (const f of is)
    if (COUNTED.has(f.kind) && !wasKeys.has(facetKey(f))) await bumpCount(ctx, ws, f, 1);
  const links = (after?.links.length ?? 0) - (filed && before ? before.links.length : 0);
  if (links !== 0) await bumpCount(ctx, ws, { kind: "links", value: "" }, links);
}

/** The concepts filed under one facet, in id order (a cursor over the index). */
export function filedUnder(ctx: QueryCtx, ws: Id<"workspaces">, kind: string, value: string) {
  return ctx.db
    .query("facets")
    .withIndex("by_kind_value", (q) => q.eq("workspaceId", ws).eq("kind", kind).eq("value", value));
}

/** The values of a counted kind most concepts carry, and how many each: at most `max`. */
export async function topCounts(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  kind: string,
  max = 100,
): Promise<Record<string, number>> {
  const rows = await ctx.db
    .query("facetCounts")
    .withIndex("by_kind_count", (q) => q.eq("workspaceId", ws).eq("kind", kind))
    .order("desc")
    .take(max);
  return Object.fromEntries(rows.map((r) => [r.value, r.count]));
}

/** The cites a kept copy answers to: its cite, `source:<id>`, and where it came from. */
export function citesOfSource(src: Doc<"sources">): string[] {
  return [
    ...new Set([
      sourceCite(src),
      `source:${src.sid}`,
      ...(src.location ? [normalizeCite(src.location)] : []),
    ]),
  ];
}

/** Whether a live concept cites this kept copy (the catalog index). */
export async function isCited(ctx: QueryCtx, ws: Id<"workspaces">, src: Doc<"sources">) {
  for (const cite of citesOfSource(src)) {
    if (await filedUnder(ctx, ws, "cite", cite).first()) return true;
  }
  return false;
}

/** The live concepts that cite a kept copy, by id, in order (the catalog index). */
export async function citersOf(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  src: Doc<"sources">,
  max = 1_000,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const cite of citesOfSource(src)) {
    for (const r of await filedUnder(ctx, ws, "cite", cite).take(max)) ids.add(r.cid);
  }
  return [...ids].sort();
}

/**
 * The most concepts a review pass reads at once, and about the most bytes: a
 * quarter of what one Convex function may read (16 MiB), whatever the
 * concepts weigh. Every Free and Individual library of ordinary concepts
 * fits whole.
 */
export const SCAN = 5_000;
export const SCAN_BYTES = 4_000_000;

/** A pass over part of the library: its concepts, and whether that's all of them. */
export type Scan = { docs: Doc<"concepts">[]; whole: boolean };

/**
 * Concepts for a pass over the library, at most SCAN of them and SCAN_BYTES:
 * by id, the most recently changed, or the longest unchanged. `whole` says
 * whether that's all.
 */
export async function scanConcepts(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  order: "id" | "recent" | "oldest",
): Promise<Scan> {
  const query =
    order === "id"
      ? ctx.db.query("concepts").withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws._id))
      : ctx.db
          .query("concepts")
          .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", ws._id))
          .order(order === "recent" ? "desc" : "asc");
  return await takeUpTo(query, SCAN, SCAN_BYTES);
}

/** What a pass over part of a library says it covered. */
export const scannedNote = (ws: Doc<"workspaces">, which: string, counted: number) =>
  `Counted over ${counted.toLocaleString("en-US")} of this library's ` +
  `${ws.conceptCount.toLocaleString("en-US")} concepts (${which}).`;

/** What's kept, of the library's room (roomOf: on a Team, less what its other libraries keep). */
function sourcesSummary(ws: Doc<"workspaces">, room: Room) {
  return {
    count: ws.sourceCount ?? 0,
    bytes: ws.sourceBytes ?? 0,
    ...(SELF_HOST ? {} : { max_bytes: room.bytes }),
    // Of the bytes, the text, which lives in the database (TEXT_BYTES).
    text_bytes: ws.textBytes ?? 0,
    ...(SELF_HOST ? {} : { max_text_bytes: room.textBytes }),
  };
}

/** How many hits each search index gives before the two are fused. */
const FUSE_DEPTH = 20;
/** Bodies a filtered search reads past the fused hits, for matches the filter keeps. */
const SEARCH_MORE = 100;
/** The most hits a search returns. */
export const SEARCH_MAX = 50;
const searchLimit = (limit?: number) => Math.min(Math.max(1, Math.floor(limit ?? 20)), SEARCH_MAX);
/** A match in the catalog record (title, description, tags) weighs this many times one in the body. */
const CATALOG_WEIGHT = 2;

/**
 * Search by words. The query is expanded through the thesaurus and stemmed
 * as the indexes are ("deploying" finds "deploys"; Convex doesn't stem), and
 * two indexes rank it: the catalog records (on `concepts`), whose matches
 * weigh twice, and all the text (on `bodies`); reciprocal rank fusion joins
 * them. Measured on 2026-09-28 (BLOCKER.md): with an agent's searches, the
 * right concept came first 75% of the time, from 61% unstemmed and
 * unweighted.
 */
export async function search(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  args: {
    query: string;
    type?: string;
    tag?: string;
    status?: string;
    shelf?: string;
    author?: string;
    /** The caller, for `author: "me"`. */
    me?: string;
    limit?: number;
  },
) {
  const limit = searchLimit(args.limit);
  if (args.query.trim() === "") return [];
  const byAuthor = args.author ? await authorFilter(ctx, ws, args.author, args.me) : null;
  const th = await thesaurusOf(ctx, ws);
  const query = stemQuery(expandQuery(args.query, th));
  if (!query) return [];
  // A tag filter includes the tag's narrower terms (library.ts tagFacet).
  const tags = args.tag ? tagFacet(args.tag, th) : undefined;
  const shelf = args.shelf ? shelfPrefix(args.shelf) : "";

  // Both rankings, fused: weight / (60 + rank), the catalog's weighted up.
  const score = new Map<string, number>();
  const add = (cids: string[], weight: number) => {
    for (const [i, cid] of cids.entries())
      score.set(cid, (score.get(cid) ?? 0) + weight / (60 + i + 1));
  };
  const catalog = await ctx.db
    .query("concepts")
    .withSearchIndex("search_catalog", (q) => {
      let s = q.search("catalogStem", query).eq("workspaceId", ws);
      if (args.type) s = s.eq("type", normalType(args.type));
      if (args.status) s = s.eq("status", args.status);
      return s;
    })
    .take(FUSE_DEPTH);
  add(
    catalog.map((d) => d.cid),
    CATALOG_WEIGHT,
  );
  const all = ctx.db
    .query("bodies")
    .withSearchIndex("search_stem", (q) => {
      let s = q.search("searchStem", query).eq("workspaceId", ws);
      if (args.type) s = s.eq("type", normalType(args.type));
      if (args.status) s = s.eq("status", args.status);
      return s;
    })
    [Symbol.asyncIterator]();
  const bodies = new Map<string, Doc<"bodies">>();
  // Convex refuses a read past the end of a query: remember reaching it.
  let exhausted = false;
  while (bodies.size < FUSE_DEPTH) {
    const r = await all.next();
    if (r.done) {
      exhausted = true;
      break;
    }
    bodies.set(r.value.cid, r.value);
  }
  add([...bodies.keys()], 1);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([cid]) => cid);

  // Read only as far as needed: `limit` live hits (deprecated ones sink and
  // are kept aside), capped so a tag filter cannot scan the whole workspace.
  const out: (ReturnType<typeof summaryOf> & { snippet: string })[] = [];
  let live = 0;
  const keep = async (cid: string, b?: Doc<"bodies"> | null) => {
    if (shelf && !cid.startsWith(shelf)) return false;
    const doc = catalog.find((d) => d.cid === cid) ?? (await getByCid(ctx, ws, cid));
    if (!doc) return false;
    if (tags && !doc.tags.some((t) => tags.includes(t))) return false;
    if (byAuthor && !byAuthor(doc.authors)) return false;
    const body = (b ?? (await bodyOf(ctx, ws, cid)))?.body;
    const source = body || doc.description || doc.title || "";
    out.push({ ...summaryOf(doc), snippet: makeSnippet(source, args.query) });
    if (doc.status !== "deprecated") live += 1;
    return (args.status ? out.length : live) >= limit;
  };
  let done = false;
  for (const cid of ranked) {
    done = await keep(cid, bodies.get(cid));
    if (done) break;
  }
  // A filter can use up the fused hits: the next ones by all the text, a few.
  let scanned = bodies.size;
  while (!done && !exhausted && scanned < FUSE_DEPTH + SEARCH_MORE) {
    const r = await all.next();
    if (r.done) break;
    scanned += 1;
    if (!score.has(r.value.cid)) done = await keep(r.value.cid, r.value);
  }
  return args.status ? out : demoteDeprecated(out).slice(0, limit);
}

/** Rows a neighbor lookup reads past the `n` it returns: the concept itself, and a few retired ones. */
const NEIGHBOR_SLACK = 5;

/**
 * A concept's nearest neighbors by words, on any shelf: the live concepts
 * whose catalog record (title, description, tags, stemmed) best matches the
 * words of its title and description, through the thesaurus (library.ts
 * neighborQuery), best first. These are the candidates for a duplicate that
 * a person or Jev then judges; the word index finds rewordings that share a
 * stem or a synonym, which a same-shelf comparison of titles misses. It
 * reads at most `n` + NEIGHBOR_SLACK rows of the catalog index and no
 * bodies, so a write or a review can afford it per concept.
 */
export async function wordNeighbors(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  row: { cid: string; title?: string; description?: string },
  th: Thesaurus,
  n: number,
): Promise<Doc<"concepts">[]> {
  const query = neighborQuery(row, th);
  if (!query) return [];
  const hits = await ctx.db
    .query("concepts")
    .withSearchIndex("search_catalog", (q) => q.search("catalogStem", query).eq("workspaceId", ws))
    .take(n + NEIGHBOR_SLACK);
  return hits
    .filter((d) => d.cid !== row.cid && d.cid !== THESAURUS_ID && d.status !== "deprecated")
    .slice(0, n);
}

/** The most concepts one `list` page holds. */
const LIST_MAX = 100;
/** How deep `offset` goes; past it, a list pages with `cursor`. */
const OFFSET_MAX = 500;
/** Past an offset page, the most concepts `list` looks at for its other filters. */
const LIST_SCAN = 500;

type ListArgs = {
  type?: string;
  tag?: string;
  status?: string;
  shelf?: string;
  author?: string;
  /** The caller, for `author: "me"`. */
  me?: string;
  limit?: number;
};

/** What a list reads and keeps: the filters, the facet that leads it, and the shelf's ids. */
async function listing(ctx: QueryCtx, ws: Id<"workspaces">, args: ListArgs) {
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? LIST_MAX)), LIST_MAX);
  const tags = args.tag ? tagFacet(args.tag, await thesaurusOf(ctx, ws)) : undefined;
  const filters = {
    type: args.type && normalType(args.type),
    status: args.status,
    tag: tags?.[0],
    tags,
    shelf: args.shelf,
  };
  const byAuthor = args.author ? await authorFilter(ctx, ws, args.author, args.me) : null;
  const authorKey = args.author ? await authorKeyOf(ctx, ws, args.author, args.me) : null;
  const matches = (d: Doc<"concepts">) =>
    matchesFilters({ id: d.cid, type: d.type, status: d.status, tags: d.tags }, filters) &&
    (!byAuthor || byAuthor(d.authors));
  // Led by the catalog index: the most selective facet, else the shelf's ids.
  const facet: [string, string[]] | null = tags?.length
    ? ["tag", tags]
    : authorKey
      ? ["author", [authorKey]]
      : args.type
        ? ["type", [normalType(args.type)]]
        : args.status
          ? ["status", [args.status]]
          : null;
  const prefix = args.shelf ? shelfPrefix(args.shelf) : "";
  const byId = () =>
    ctx.db
      .query("concepts")
      .withIndex("by_workspace_cid", (q) =>
        prefix
          ? q.eq("workspaceId", ws).gte("cid", prefix).lt("cid", `${prefix}\uffff`)
          : q.eq("workspaceId", ws),
      );
  return { limit, matches, facet, byId };
}

/**
 * One page of concepts' catalog records, by Convex's own cursor (null for
 * the first page): led by the filter's facet when one value names it, else
 * by id. A page reads at most `limit` concepts and keeps those every filter
 * matches, so it can hold fewer; go on while `cursor` isn't null.
 */
export async function listPage(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  args: ListArgs & { cursor: string | null },
) {
  const { limit, matches, facet, byId } = await listing(ctx, ws, args);
  if (facet?.[1].length === 1) {
    const page = await filedUnder(ctx, ws, facet[0], facet[1][0] as string).paginate({
      cursor: args.cursor,
      numItems: limit,
    });
    const concepts = [];
    for (const r of page.page) {
      const d = await getByCid(ctx, ws, r.cid);
      if (d && matches(d)) concepts.push(summaryOf(d));
    }
    return { concepts, cursor: page.isDone ? null : page.continueCursor };
  }
  const page = await byId().paginate({ cursor: args.cursor, numItems: limit });
  return {
    concepts: page.page.filter(matches).map(summaryOf),
    cursor: page.isDone ? null : page.continueCursor,
  };
}

/** The Library's order: when each concept last changed, newest or oldest first. */
export type Order = "newest" | "oldest";

/** Where a recency page stopped: its last record's `updatedAt:_creationTime`. Pure, exported for tests. */
export const recentCursor = (d: { updatedAt?: number; _creationTime: number }) =>
  `${d.updatedAt ?? ""}:${d._creationTime}`;

/** An offset page's cursor (`o:<n>`) read back: 0 for the first page. Pure, exported for tests. */
export function parseOffsetCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const n = Number(cursor.slice(2));
  if (!cursor.startsWith("o:") || !Number.isInteger(n) || n < 0) {
    throw new Error("That page of the list is out of date: open the list again.");
  }
  return n;
}

/** A `recentCursor` read back: null for the first page. Pure, exported for tests. */
export function parseRecentCursor(cursor: string | null): { u?: number; c: number } | null {
  if (!cursor) return null;
  const [u, c] = cursor.split(":");
  if (!c || !Number.isFinite(Number(c)) || (u && !Number.isFinite(Number(u)))) {
    throw new Error("That page of the list is out of date: open the list again.");
  }
  return { u: u ? Number(u) : undefined, c: Number(c) };
}

/** A tag's, an author's, or a shelf's concepts, read whole to sort by date: at most this many. */
const FILTER_SORT_MAX = 1_000;

/**
 * One page of concepts' catalog records by when each last changed, newest
 * or oldest first, through the filters (the Library's order).
 *
 * A tag, an author, or a shelf names few concepts: they're read whole, by
 * their own index (up to FILTER_SORT_MAX and SCAN_BYTES), sorted, and paged
 * by offset (`o:<n>`), so a rare tag's are all there however old.
 * Otherwise (all of them, or a type) it walks `by_workspace_updated`,
 * keeping what every filter matches, until `limit` match or it has read
 * LIST_SCAN records or SCAN_BYTES. That cursor is the last record it read;
 * the next page goes on from there: the rest of that `updatedAt` by
 * creation time, then past it. Null when the list is done.
 */
export async function recentPage(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  args: ListArgs & { cursor: string | null; order: Order },
) {
  const { limit, matches, facet, byId } = await listing(ctx, ws, args);
  const desc = args.order === "newest";
  const when = (d: Doc<"concepts">) => d.updatedAt ?? d._creationTime;
  const row = (d: Doc<"concepts">) => ({ ...summaryOf(d), updated_at: when(d) });
  if (facet?.[0] === "tag" || facet?.[0] === "author" || args.shelf) {
    const docs: Doc<"concepts">[] = [];
    let looked = 0;
    let read = 0;
    const keep = (d: Doc<"concepts">) => {
      looked += 1;
      read += sizeOf(d);
      if (matches(d)) docs.push(d);
      return looked >= FILTER_SORT_MAX || read >= SCAN_BYTES;
    };
    if (facet?.[0] === "tag" || facet?.[0] === "author") {
      const [kind, values] = facet;
      const cids = new Set<string>();
      for (const value of values) {
        for (const r of await filedUnder(ctx, ws, kind, value).take(FILTER_SORT_MAX)) {
          cids.add(r.cid);
        }
      }
      for (const cid of cids) {
        const d = await getByCid(ctx, ws, cid);
        if (d && keep(d)) break;
      }
    } else {
      for await (const d of byId()) if (keep(d)) break;
    }
    docs.sort((a, b) => (when(a) - when(b) || a._creationTime - b._creationTime) * (desc ? -1 : 1));
    const from = parseOffsetCursor(args.cursor);
    return {
      concepts: docs.slice(from, from + limit).map(row),
      cursor: from + limit < docs.length ? `o:${from + limit}` : null,
    };
  }
  const order = desc ? "desc" : "asc";
  const at = parseRecentCursor(args.cursor);
  const concepts = () => ctx.db.query("concepts");
  const runs = !at
    ? [
        concepts()
          .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", ws))
          .order(order),
      ]
    : [
        concepts()
          .withIndex("by_workspace_updated", (q) => {
            const same = q.eq("workspaceId", ws).eq("updatedAt", at.u);
            return desc ? same.lt("_creationTime", at.c) : same.gt("_creationTime", at.c);
          })
          .order(order),
        // Every write sets `updatedAt`; a record without one sorts first, so
        // newest-first ends with it.
        ...(desc && at.u === undefined
          ? []
          : [
              concepts()
                .withIndex("by_workspace_updated", (q) =>
                  desc
                    ? q.eq("workspaceId", ws).lt("updatedAt", at.u as number)
                    : q.eq("workspaceId", ws).gt("updatedAt", at.u ?? Number.NEGATIVE_INFINITY),
                )
                .order(order),
            ]),
      ];
  const out: (ReturnType<typeof summaryOf> & { updated_at: number })[] = [];
  let last: Doc<"concepts"> | null = null;
  let looked = 0;
  let read = 0;
  for (const run of runs) {
    for await (const d of run) {
      if (out.length >= limit || looked >= LIST_SCAN || read >= SCAN_BYTES) {
        return { concepts: out, cursor: last && recentCursor(last) };
      }
      looked += 1;
      read += sizeOf(d);
      last = d;
      // When it last changed: the order's date, which the Library's row shows.
      if (matches(d)) out.push(row(d));
    }
  }
  return { concepts: out, cursor: null };
}

/**
 * Concepts' catalog records by `offset`, through the first OFFSET_MAX (as an
 * older CLI pages); past them, `listPage`.
 */
export async function list(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  args: ListArgs & { offset?: number },
) {
  const { limit, matches, facet, byId } = await listing(ctx, ws, args);
  const offset = args.offset ?? 0;
  if (offset + limit > OFFSET_MAX) {
    throw new Error(
      `list pages by offset through the first ${OFFSET_MAX}: page with \`cursor\` instead ` +
        "(null for the first page, then the cursor each page returns)",
    );
  }
  const want = offset + limit;
  const out: ReturnType<typeof summaryOf>[] = [];
  let skipped = 0;
  let read = 0;
  const keep = (d: Doc<"concepts">) => {
    read += sizeOf(d);
    if (!matches(d)) return false;
    if (skipped < offset) skipped += 1;
    else out.push(summaryOf(d));
    return out.length >= limit || read >= SCAN_BYTES;
  };
  if (facet) {
    const [kind, values] = facet;
    const ids = new Set<string>();
    for (const value of values) {
      for (const r of await filedUnder(ctx, ws, kind, value).take(want + LIST_SCAN)) ids.add(r.cid);
    }
    for (const cid of [...ids].sort().slice(0, want + LIST_SCAN)) {
      const d = await getByCid(ctx, ws, cid);
      if (d && keep(d)) break;
    }
    return out;
  }
  let looked = 0;
  for await (const d of byId()) {
    if (++looked > want + LIST_SCAN || keep(d)) break;
  }
  return out;
}

/** The most links `get_concept`'s `links` and `graph` read each way from one concept. */
const NEIGHBORS = 100;

/** A concept's links each way, at most NEIGHBORS: rows of `links`, not the concepts. */
async function linksOf(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  const outRows = await ctx.db
    .query("links")
    .withIndex("by_ws_src", (q) => q.eq("workspaceId", ws).eq("src", cid))
    .take(NEIGHBORS);
  const inRows = await ctx.db
    .query("links")
    .withIndex("by_ws_dst", (q) => q.eq("workspaceId", ws).eq("dst", cid))
    .take(NEIGHBORS);
  return { outRows, inRows };
}

export async function neighbors(ctx: QueryCtx, ws: Id<"workspaces">, cid: string) {
  const { outRows, inRows } = await linksOf(ctx, ws, cid);
  const resolve = async (id: string) => {
    const doc = await getByCid(ctx, ws, id);
    return { id, title: doc?.title ?? null, exists: doc !== null };
  };
  return {
    id: cid,
    outbound: await Promise.all(
      outRows
        .map((r) => r.dst)
        .sort()
        .map(resolve),
    ),
    inbound: await Promise.all(
      inRows
        .map((r) => r.src)
        .sort()
        .map(resolve),
    ),
  };
}

export async function graphOf(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  cid: string,
  depth = 1,
  maxNodes = 50,
) {
  return await bfsGraph(
    cid,
    { depth, maxNodes },
    // The walk reads links only; a concept is read once it's one of the nodes.
    async (id) => {
      const { outRows, inRows } = await linksOf(ctx, ws, id);
      return {
        outbound: outRows.map((r) => ({ id: r.dst })),
        inbound: inRows.map((r) => ({ id: r.src })),
      };
    },
    async (id) => {
      const doc = await getByCid(ctx, ws, id);
      return { id, title: doc?.title ?? null, exists: doc !== null };
    },
  );
}

export async function statusOf(ctx: QueryCtx, ws: Doc<"workspaces">, open?: number) {
  const links = await ctx.db
    .query("facetCounts")
    .withIndex("by_kind_value", (q) =>
      q.eq("workspaceId", ws._id).eq("kind", "links").eq("value", ""),
    )
    .unique();
  const room = await roomOf(ctx, ws);
  return {
    backend: "convex",
    // Counts the catalog index keeps: `status` reads a few rows, whatever the library's size.
    concepts: ws.conceptCount,
    by_type: await topCounts(ctx, ws._id, "type"),
    by_tag: await topCounts(ctx, ws._id, "tag"),
    links: links?.count ?? 0,
    // A self-hosted deployment has no plans, so it reports no limits. It
    // reports its models instead: what runs each, or why it's off (ai.ts).
    ...(SELF_HOST
      ? {}
      : {
          // On a Team: this library's room, and the Team's credits (roomOf, payerOf).
          max_concepts: room.concepts,
          plan: ws.plan,
          index_credits: indexCreditsOf(await payerOf(ctx, ws)),
        }),
    ...(SELF_HOST ? { models: modelsInUse() } : {}),
    // Libro's review shelf: proposals waiting for a human (`open`, when the
    // caller has just read the shelf: it's the same count).
    review_shelf: open ?? (await openCount(ctx, ws._id)),
    // Source copies: what's kept, and of it how much is text.
    sources: sourcesSummary(ws, room),
    stale: false,
  };
}

export function quotaFor(ws: Doc<"workspaces">): number {
  return conceptQuota(ws.plan);
}

/**
 * A library's room on its plan: the plan's ceilings less what its Team's
 * other libraries use, since a Team's libraries share them (teamCover.ts);
 * alone, the plan's ceilings.
 */
export async function roomOf(ctx: QueryCtx, ws: Doc<"workspaces">) {
  const { home, libraries } = await poolOf(ctx, ws);
  const others = libraries.filter((w) => w._id !== ws._id);
  return {
    libraries: libraries.length,
    concepts: Math.max(0, quotaFor(home) - pooled(others, "conceptCount")),
    bytes: Math.max(0, sourceQuota(home.plan) - pooled(others, "sourceBytes")),
    textBytes: Math.max(0, textQuota(home.plan) - pooled(others, "textBytes")),
  };
}
export type Room = Awaited<ReturnType<typeof roomOf>>;

/** " (its Team's 3 libraries share 25.0 GB)", after a ceiling a Team's libraries share. */
export const sharedNote = (room: Room, total: string) =>
  room.libraries > 1 ? ` (its Team's ${room.libraries} libraries share ${total})` : "";

export function searchTextOf(row: {
  title?: string;
  description?: string;
  tags: string[];
  body: string;
}) {
  return [row.title ?? "", row.description ?? "", row.tags.join(" "), row.body].join("\n");
}

/** A body row's search fields: the text, and its stems (search). */
export function searchFieldsOf(row: {
  title?: string;
  description?: string;
  tags: string[];
  body: string;
}) {
  return { searchStem: stemText(searchTextOf(row)) };
}

/** A concept row's catalog record, stemmed: title, description, and tags (search). */
export const catalogStemOf = (row: { title?: string; description?: string; tags: string[] }) =>
  stemText([row.title ?? "", row.description ?? "", row.tags.join(" ")].join(" "));

/**
 * A kept source's title, stemmed the same way: search finds a source by it
 * (sources.ts sourceHits), so a picture or a scan with no text is found too.
 */
export const titleStemOf = (title: string) => stemText(title);

/** Insert or patch the body row of a concept. */
async function writeBody(
  ctx: MutationCtx,
  ws: Id<"workspaces">,
  cid: string,
  fields: { type: string; status: string; body: string } & ReturnType<typeof searchFieldsOf>,
) {
  const existing = await bodyOf(ctx, ws, cid);
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("bodies", { workspaceId: ws, cid, ...fields });
}

async function writeRow(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  cid: string,
  args: ConceptArgs,
  existing: Doc<"concepts"> | null,
  by: Writer = "agent",
) {
  const body = args.body ?? "";
  // Two types: whatever an agent calls it, a concept is a Note or a Decision.
  args = { ...args, type: normalType(args.type) };
  assertNoSecrets(args.title, args.description, body, ...(args.tags ?? []));
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    throw new Error(
      `concept body is over ${Math.round(MAX_BODY_BYTES / 1000)} KB. A concept is one idea: ` +
        "summarize, split, and link instead of pasting whole files.",
    );
  }
  const tags = normalizeTags(args.tags ?? [], await thesaurusOf(ctx, ws._id));
  const status = args.status ? checkStatus(args.status) : "stable";
  // The same frontmatter an OKF file carries (and the export writes): standard keys
  // rebuilt, unknown keys kept, `extra` set explicitly.
  const frontmatter = buildFrontmatter(
    existing?.frontmatter as Record<string, unknown> | undefined,
    { ...args, tags, status },
  );
  if (cid !== THESAURUS_ID && sizeOf(frontmatter) > MAX_RECORD_BYTES) {
    throw new Error(
      `concept ${cid}'s catalog record (title, description, tags, sources) is over ` +
        `${Math.round(MAX_RECORD_BYTES / 1000)} KB: shorten the description, use fewer tags, ` +
        "or cite fewer sources (cite a directory for many files).",
    );
  }
  const links = extractLinks(body, cid);
  if (links.length > MAX_LINKS) {
    throw new Error(
      `concept ${cid} links to ${links.length} concepts, and a concept links to at most ` +
        `${MAX_LINKS}: split it, each part linking its own.`,
    );
  }
  const row: Partial<Doc<"concepts">> & { tags: string[]; links: string[] } = {
    workspaceId: ws._id,
    cid,
    type: args.type,
    title: args.title,
    description: args.description,
    tags,
    status,
    frontmatter,
    links,
    // Provenance: when this row last changed (creation time is Convex's
    // built-in _creationTime). Who changed it is on the revision (by, user,
    // client).
    updatedAt: Date.now(),
    catalogStem: catalogStemOf({ title: args.title, description: args.description, tags }),
  };
  // Automatic indexation: catalog what the writer left blank. One job per
  // concept at a time — a second write while a job is in flight must not
  // spend a second credit. The action spends the credit (indexation.ts).
  // ponytail: a 120 s staleness bound instead of a job id; the model call
  // times out at 30 s, so a crashed job self-heals on the next write.
  const inflight = existing?.indexingAt !== undefined && Date.now() - existing.indexingAt < 120_000;
  // Cataloging is Jev's selection: a server without Jev has none to schedule.
  const schedule =
    cid !== THESAURUS_ID &&
    needsIndexing({ ...row, body }) &&
    !inflight &&
    hasAi("eval") &&
    (includedIndexCredits(ws.plan) > 0 || ws.payAsYouGo === true);
  if (schedule) row.indexingAt = Date.now();
  // Its writer filled the record: nothing waits for Libro (indexation.ts).
  else if (existing?.catalogWaiting && !needsIndexing({ ...row, body })) {
    row.catalogWaiting = undefined;
  }
  let rowId: Id<"concepts">;
  if (existing) {
    // patch, not replace: circulation and indexation stamps survive a write.
    await ctx.db.patch(existing._id, row);
    rowId = existing._id;
  } else {
    rowId = await ctx.db.insert("concepts", row as Omit<Doc<"concepts">, "_id" | "_creationTime">);
    await ctx.db.patch(ws._id, { conceptCount: ws.conceptCount + 1 });
  }
  await writeBody(ctx, ws._id, cid, {
    type: args.type,
    status,
    body,
    ...searchFieldsOf({ title: args.title, description: args.description, tags, body }),
  });
  await replaceLinks(ctx, ws._id, cid, row.links);
  await recordRevision(ctx, rowId, existing ? "update" : "create", by);
  // Filed after the revision, which may name a new author.
  await reindexConcept(ctx, ws._id, existing, await ctx.db.get(rowId));
  if (schedule) {
    await ctx.scheduler.runAfter(0, internal.indexation.index, { workspaceId: ws._id, cid });
  }
  return { id: cid, path: null as string | null };
}

/** A concept needs indexing when its catalog record is incomplete. */
export function needsIndexing(row: { description?: string; tags: string[]; body: string }) {
  return row.body.trim() !== "" && (!row.description?.trim() || row.tags.length === 0);
}

/** Append a revision (the hosted tier's "commit") with the row's current state. */
/**
 * Who made a write. A bare string is the actor kind ("agent", "indexer",
 * "libro"); an MCP write also names the signed-in user and the OAuth client
 * (the agent) it came through.
 */
export type Writer = string | { by: string; userId?: string; client?: string };

function writerFields(w: Writer): { by: string; userId?: string; client?: string } {
  return typeof w === "string" ? { by: w } : w;
}

export async function recordRevision(
  ctx: MutationCtx,
  conceptId: Id<"concepts">,
  kind: Doc<"revisions">["kind"],
  by: Writer,
) {
  const row = await ctx.db.get(conceptId);
  if (!row) return;
  const b = await bodyOf(ctx, row.workspaceId, row.cid);
  const body = b?.body ?? "";
  const last = await ctx.db
    .query("revisions")
    .withIndex("by_concept", (q) => q.eq("conceptId", conceptId))
    .order("desc")
    .first();
  // A write that changed nothing keeps no revision: history says what changed.
  // A rename changes only the id, so the id counts too.
  if (
    last &&
    last.cid === row.cid &&
    last.body === body &&
    JSON.stringify(last.frontmatter) === JSON.stringify(row.frontmatter)
  ) {
    return;
  }
  const seq = (last?.seq ?? 0) + 1;
  await ctx.db.insert("revisions", {
    workspaceId: row.workspaceId,
    conceptId,
    cid: row.cid,
    seq,
    kind,
    ...writerFields(by),
    frontmatter: row.frontmatter,
    body,
  });
  await keepRevisions(ctx, row.workspaceId, conceptId, seq);
  // Author entry: the catalog record names everyone who wrote it.
  const known = row.authors ?? [];
  const added = authorKeys(by).filter((k) => !known.includes(k));
  if (added.length > 0) await ctx.db.patch(conceptId, { authors: [...known, ...added] });
}

/**
 * After a revision: drop this concept's revisions older than its last
 * REVISIONS_PER_CONCEPT, then the library's oldest past its plan's
 * REVISIONS_KEPT. A write drops at most a couple, so it stays cheap.
 */
async function keepRevisions(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  conceptId: Id<"concepts">,
  seq: number,
) {
  const ws = await ctx.db.get(workspaceId);
  if (!ws) return;
  let count = (ws.revisionCount ?? 0) + 1;
  if (!SELF_HOST && seq > REVISIONS_PER_CONCEPT) {
    const old = await ctx.db
      .query("revisions")
      .withIndex("by_concept", (q) =>
        q.eq("conceptId", conceptId).lte("seq", seq - REVISIONS_PER_CONCEPT),
      )
      .take(2);
    for (const r of old) await ctx.db.delete(r._id);
    count -= old.length;
  }
  const kept = revisionsKept(ws.plan);
  if (count > kept) {
    const oldest = await ctx.db
      .query("revisions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("asc")
      .take(Math.min(count - kept, 2));
    for (const r of oldest) await ctx.db.delete(r._id);
    count -= oldest.length;
  }
  await ctx.db.patch(workspaceId, { revisionCount: Math.max(0, count) });
}

/** Revision history, newest first; with `revision`, that revision's snapshot. */
export async function history(
  ctx: QueryCtx,
  ws: Id<"workspaces">,
  cid: string,
  /** `people`: each revision also names the person it was written for, by email (the dashboard). */
  opts: { limit?: number; revision?: string; people?: boolean },
) {
  const row = await getByCid(ctx, ws, cid);
  if (!row) throw await notFound(ctx, ws, cid);
  if (opts.revision !== undefined) {
    const seq = Number(opts.revision);
    const rev = await ctx.db
      .query("revisions")
      .withIndex("by_concept", (q) => q.eq("conceptId", row._id).eq("seq", seq))
      .unique();
    if (!rev) throw new Error(`revision not found: ${opts.revision}`);
    return {
      id: cid,
      revisions: [],
      snapshot: {
        revision: String(rev.seq),
        at: rev._creationTime,
        kind: rev.kind,
        by: rev.by,
        ...(rev.client ? { client: rev.client } : {}),
        cid: rev.cid,
        frontmatter: rev.frontmatter,
        body: rev.body,
      },
    };
  }
  const revs = await ctx.db
    .query("revisions")
    .withIndex("by_concept", (q) => q.eq("conceptId", row._id))
    .order("desc")
    .take(opts.limit ?? 20);
  const emails = new Map<string, string | null>();
  if (opts.people) {
    for (const r of revs) {
      if (r.userId && !emails.has(r.userId)) {
        emails.set(r.userId, (await userById(ctx, r.userId))?.email ?? null);
      }
    }
  }
  return {
    id: cid,
    revisions: revs.map((r) => ({
      revision: String(r.seq),
      at: r._creationTime,
      kind: r.kind,
      by: r.by,
      ...(r.client ? { client: r.client } : {}),
      ...(opts.people ? { person: (r.userId && emails.get(r.userId)) || null } : {}),
      cid: r.cid,
      title: (r.frontmatter as { title?: string }).title ?? null,
    })),
  };
}

/**
 * Delete one concept: its rows, outbound links, and revisions (weeding). Its
 * id is retired, so no new concept gets it by default.
 */
export async function deleteConcept(ctx: MutationCtx, ws: Doc<"workspaces">, cid: string) {
  const row = await getByCid(ctx, ws._id, cid);
  if (!row) throw await notFound(ctx, ws._id, cid);
  await replaceLinks(ctx, ws._id, cid, []);
  await reindexConcept(ctx, ws._id, row, null);
  const revs = await ctx.db
    .query("revisions")
    .withIndex("by_concept", (q) => q.eq("conceptId", row._id))
    .collect();
  for (const r of revs) await ctx.db.delete(r._id);
  const b = await bodyOf(ctx, ws._id, cid);
  if (b) await ctx.db.delete(b._id);
  await ctx.db.delete(row._id);
  const fresh = await ctx.db.get(ws._id);
  await ctx.db.patch(ws._id, {
    conceptCount: Math.max(0, ws.conceptCount - 1),
    revisionCount: Math.max(0, (fresh?.revisionCount ?? 0) - revs.length),
  });
  await retire(ctx, ws._id, cid, { title: row.title });
  return { deleted: cid };
}

async function replaceLinks(ctx: MutationCtx, ws: Id<"workspaces">, src: string, dsts: string[]) {
  const old = await ctx.db
    .query("links")
    .withIndex("by_ws_src", (q) => q.eq("workspaceId", ws).eq("src", src))
    .collect();
  for (const row of old) await ctx.db.delete(row._id);
  for (const dst of dsts) await ctx.db.insert("links", { workspaceId: ws, src, dst });
}

/** Existing concepts a new one is compared with: `ingest` returns them as `possible_duplicates`. */
export const POSSIBLE_DUPLICATES = 3;

export async function ingest(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  args: ConceptArgs,
  by: Writer = "agent",
  /** Look up the existing concepts a new one may duplicate (an agent's write, not an import). */
  opts: { duplicates?: boolean } = {},
) {
  // A derived id skips retired ones too; an explicit id may take one, and
  // the result says so.
  const cid = await deriveConceptId(
    args,
    async (id) =>
      (await getByCid(ctx, ws._id, id)) !== null || (await tombstoneRow(ctx, ws._id, id)) !== null,
  );
  const existing = await getByCid(ctx, ws._id, cid);
  const retired = existing ? null : await tombstoneOf(ctx, ws._id, cid);
  // On a Team, its libraries share the plan's concepts (roomOf).
  const room = existing ? null : await roomOf(ctx, ws);
  if (room && ws.conceptCount + 1 > room.concepts) {
    if (quotaFor(ws) === 0) {
      throw new Error(
        "this library has no room on its plan: choose one on the Billing page. " +
          "Self-hosting librocat is free.",
      );
    }
    throw new Error(
      `concept quota reached: the workspace has ${ws.conceptCount} of ` +
        `${room.concepts} concepts${sharedNote(room, quotaFor(ws).toLocaleString("en-US"))}. ` +
        "Delete concepts or upgrade the plan.",
    );
  }
  // A re-ingest replaces the record: a "see" reference from a past
  // retirement does not survive it (update keeps it; ingest does not), and
  // neither does a review date the writer did not give again.
  const { stale_after, sources, ...fields } = args;
  const staleAfter = stale_after ? checkStaleAfter(stale_after) : null;
  // Only a new concept is compared, before it is written so the index can't
  // return it: the writer's agent judges whether one of these is the same
  // subject (and updates it or proposes a merge), so librocat calls no model.
  const duplicates =
    opts.duplicates && !existing && cid !== THESAURUS_ID
      ? await wordNeighbors(
          ctx,
          ws._id,
          { cid, title: args.title, description: args.description },
          await thesaurusOf(ctx, ws._id),
          POSSIBLE_DUPLICATES,
        )
      : [];
  const written = await writeRow(
    ctx,
    ws,
    cid,
    {
      ...fields,
      extra: {
        supersededBy: null,
        stale_after: staleAfter,
        sources: withSources(null, sources ?? []),
        ...args.extra,
      },
    },
    existing,
    by,
  );
  return {
    ...written,
    ...(retired ? { reused: reusedNote(retired) } : {}),
    ...(duplicates.length
      ? {
          possible_duplicates: duplicates.map((d) => ({
            id: d.cid,
            title: d.title ?? null,
            description: d.description ?? null,
          })),
        }
      : {}),
  };
}

/** The OKF actor for a writer: the agent's client name, a person, or the process. */
function actorOf(by: Writer): string {
  const w = writerFields(by);
  if (w.client) return w.client;
  if (w.userId) return `human:${w.userId}`;
  return `process:${w.by}`;
}

export async function update(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  cid: string,
  args: {
    body?: string;
    title?: string;
    description?: string;
    tags?: string[];
    type?: string;
    status?: string;
    superseded_by?: string;
    /** When to check this concept again; "" clears it. */
    stale_after?: string;
    /** The writer checked the concept still holds (OKF `verified`). */
    verify?: boolean;
    /** What the concept describes (OKF `sources`), replacing the list; [] clears it. */
    sources?: string[];
  },
  by: Writer = "agent",
) {
  const existing = await getByCid(ctx, ws._id, cid);
  if (!existing) throw await notFound(ctx, ws._id, cid);
  if (args.superseded_by === cid) throw new Error("a concept cannot supersede itself");
  if (args.superseded_by && !(await getByCid(ctx, ws._id, args.superseded_by))) {
    throw await notFound(ctx, ws._id, args.superseded_by);
  }
  const body = args.body ?? (await bodyOf(ctx, ws._id, cid))?.body ?? "";
  const merged: ConceptArgs = {
    type: args.type ?? existing.type,
    title: args.title ?? existing.title,
    description: args.description ?? existing.description,
    tags: args.tags ?? existing.tags,
    body,
    // A "see" reference retires the concept unless the caller set a status.
    status: args.status ?? (args.superseded_by ? "deprecated" : existing.status),
    id: cid,
    // "" clears a reference or a review date (writeRow deletes null keys).
    extra: {
      ...(args.superseded_by !== undefined ? { supersededBy: args.superseded_by || null } : {}),
      ...(args.stale_after !== undefined ? { stale_after: checkStaleAfter(args.stale_after) } : {}),
      ...(args.verify ? verifiedKeys(existing, by, args.stale_after !== undefined) : {}),
      ...(args.sources !== undefined
        ? {
            sources: withSources(
              (existing.frontmatter as Record<string, unknown> | undefined)?.sources,
              args.sources,
            ),
          }
        : {}),
    },
  };
  return await writeRow(ctx, ws, cid, merged, existing, by);
}

/** At most this many concepts are marked by one `files_changed` call, a mutation's worth of writes. */
const CHANGED_MAX = 200;
/** Files and directories one `files_changed` call looks up (Convex reads 4,096 index ranges a call). */
const CHANGED_LOOKUPS = 2_000;

/**
 * Code changed: every live concept whose OKF `resource` or `sources` name
 * one of `paths` gets a review date of now (a revision by whoever reported
 * it), and a `stale` proposal on Libro's shelf that names the file and the
 * commit. A concept already past its date keeps that date, so the shelf
 * holds one proposal for it.
 */
export async function changed(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  paths: string[],
  opts: { commit?: string; shelf?: string },
  by: Writer = "agent",
) {
  if (paths.length > 1000) throw new Error("changed takes at most 1,000 paths at a time");
  // The catalog index names the concepts citing each file or a directory above it.
  const lookups = [...new Set(paths.flatMap(pathsAbove))];
  if (lookups.length > CHANGED_LOOKUPS) {
    throw new Error(
      `these paths and their directories are ${lookups.length.toLocaleString("en-US")} lookups, ` +
        `and changed makes at most ${CHANGED_LOOKUPS.toLocaleString("en-US")}: pass fewer paths at a time`,
    );
  }
  const prefix = opts.shelf ? shelfPrefix(opts.shelf) : "";
  const citers = new Set<string>();
  for (const value of lookups) {
    for (const r of await filedUnder(ctx, ws._id, "path", value).take(CHANGED_MAX + 1)) {
      if (!prefix || r.cid.startsWith(prefix)) citers.add(r.cid);
    }
    if (citers.size > CHANGED_MAX) break;
  }
  const { marked, more } = await reviewCiters(
    ctx,
    ws,
    (fm) => markChanged(fm, paths),
    (hit) =>
      `${hit.join(", ")} changed${opts.commit ? ` in ${opts.commit}` : ""}. ` +
      "Still true? Verify it, or retire it.",
    opts.shelf,
    by,
    [...citers].sort(),
  );
  return {
    marked,
    ...(opts.commit ? { commit: opts.commit } : {}),
    ...(more || citers.size > CHANGED_MAX
      ? {
          note: `more than ${CHANGED_MAX} concepts cite these files: the first ${CHANGED_MAX} are marked; pass fewer paths at a time for the rest`,
        }
      : {}),
  };
}

/**
 * Put up for review every live concept whose sources `mark` matches (it
 * mutates the frontmatter and returns what matched: `markChanged` for code,
 * `markSources` for a source copy whose text changed). Each gets a review
 * date of now, as a revision by `by`, and a `stale` proposal saying why.
 */
export async function reviewCiters(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  mark: (fm: Record<string, unknown>) => string[],
  reasonOf: (hit: string[]) => string,
  shelf: string | undefined,
  by: Writer,
  /** The concepts to check, when the catalog index names them (a kept copy's citers). */
  citers?: string[],
) {
  const prefix = shelf ? shelfPrefix(shelf) : "";
  const marked: { id: string; sources: string[] }[] = [];
  let more = false;
  // A kept copy's citers come from the index; code paths match by prefix, so
  // `files_changed` looks over the shelf's ids, or the library's first SCAN.
  let docs: Doc<"concepts">[];
  let whole = true;
  if (citers) {
    docs = [];
    for (const cid of citers) {
      const d = await getByCid(ctx, ws._id, cid);
      if (d) docs.push(d);
    }
  } else if (prefix) {
    ({ docs, whole } = await takeUpTo(
      ctx.db
        .query("concepts")
        .withIndex("by_workspace_cid", (q) =>
          q.eq("workspaceId", ws._id).gte("cid", prefix).lt("cid", `${prefix}\uffff`),
        ),
      SCAN,
      SCAN_BYTES,
    ));
  } else {
    ({ docs, whole } = await scanConcepts(ctx, ws, "id"));
  }
  for (const d of docs) {
    if (d.status === "deprecated" || (prefix && !d.cid.startsWith(prefix))) continue;
    const fm = { ...((d.frontmatter ?? {}) as Record<string, unknown>) };
    const hit = mark(fm);
    if (hit.length === 0) continue;
    if (marked.length === CHANGED_MAX) {
      more = true;
      break;
    }
    const body = (await bodyOf(ctx, ws._id, d.cid))?.body ?? "";
    await writeRow(
      ctx,
      ws,
      d.cid,
      {
        type: d.type,
        title: d.title,
        description: d.description,
        tags: d.tags,
        body,
        status: d.status,
        extra: {
          stale_after: fm.stale_after,
          ...(Array.isArray(fm.sources) ? { sources: fm.sources } : {}),
        },
      },
      d,
      by,
    );
    const target = staleAfterOf(fm) as string;
    const reason = reasonOf(hit);
    await fileProposal(ctx, ws._id, { kind: "stale", subject: d.cid, target, reason }, "libro");
    marked.push({ id: d.cid, sources: hit });
  }
  return { marked, more, whole, looked: docs.length };
}

/**
 * File one proposal on Libro's review shelf if its key is new. One proposal
 * per (kind, subject, target), ever: a dismissed one stays dismissed, so
 * Libro does not nag.
 */
export async function fileProposal(
  ctx: MutationCtx,
  ws: Id<"workspaces">,
  p: {
    kind: Doc<"proposals">["kind"];
    subject: string;
    target?: string;
    reason: string;
    draft?: Doc<"proposals">["draft"];
  },
  by: Writer,
): Promise<Id<"proposals"> | null> {
  const existing = await ctx.db
    .query("proposals")
    .withIndex("by_workspace_key", (q) =>
      q.eq("workspaceId", ws).eq("kind", p.kind).eq("subject", p.subject).eq("target", p.target),
    )
    .first();
  if (existing) return null;
  return await ctx.db.insert("proposals", {
    workspaceId: ws,
    ...p,
    status: "open",
    ...writerFields(by),
  });
}

/** The frontmatter keys `verify` sets: a new OKF `verified` event, and a review date moved on. */
function verifiedKeys(existing: Doc<"concepts">, by: Writer, staleAfterGiven: boolean) {
  const fm = { ...((existing.frontmatter ?? {}) as Record<string, unknown>) };
  markVerified(fm, actorOf(by), { staleAfterGiven });
  return {
    verified: fm.verified,
    ...(staleAfterGiven ? {} : { stale_after: fm.stale_after ?? null }),
  };
}

/**
 * Rename a concept and rewrite every inbound link to the new id (authority
 * control: a rename must never orphan a link). Mirrors Service.rename in
 * @librocat/core.
 */
/** The most concepts linking to one that a rename rewrites. */
const RENAME_LINKERS = 500;

export async function rename(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  oldId: string,
  newId: string,
  by: Writer = "agent",
) {
  newId = canonicalId(newId);
  if (isReservedId(newId)) {
    throw new Error(`concept id '${newId}' maps to an OKF-reserved filename`);
  }
  if (oldId === THESAURUS_ID || newId === THESAURUS_ID) {
    throw new Error("'thesaurus' is the tag vocabulary and cannot be renamed");
  }
  const row = await getByCid(ctx, ws._id, oldId);
  if (!row) throw await notFound(ctx, ws._id, oldId);
  if (await getByCid(ctx, ws._id, newId)) throw new Error(`concept already exists: ${newId}`);
  const retired = await tombstoneOf(ctx, ws._id, newId);

  // Rewrite inbound linkers' bodies and link rows: a few hundred at most, in one transaction.
  const inRows = await ctx.db
    .query("links")
    .withIndex("by_ws_dst", (q) => q.eq("workspaceId", ws._id).eq("dst", oldId))
    .take(RENAME_LINKERS + 1);
  if (inRows.length > RENAME_LINKERS) {
    throw new Error(
      `more than ${RENAME_LINKERS} concepts link to '${oldId}', and a rename rewrites each: ` +
        "write the new concept, supersede the old one with it (status deprecated, superseded_by), " +
        "and let the links move as concepts change",
    );
  }
  const map = new Map([[oldId, newId]]);
  let relinked = 0;
  for (const src of new Set(inRows.map((r) => r.src))) {
    if (src === oldId) continue;
    const linker = await getByCid(ctx, ws._id, src);
    const lb = linker && (await bodyOf(ctx, ws._id, src));
    if (!linker || !lb) continue;
    const res = retargetLinks(lb.body, linker.cid, map);
    if (res.changed === 0) continue;
    const links = extractLinks(res.body, linker.cid);
    await ctx.db.patch(linker._id, { links, updatedAt: Date.now() });
    await ctx.db.patch(lb._id, {
      body: res.body,
      ...searchFieldsOf({ ...linker, body: res.body }),
    });
    await replaceLinks(ctx, ws._id, linker.cid, links);
    await reindexConcept(ctx, ws._id, linker, await ctx.db.get(linker._id));
    relinked += res.changed;
  }

  // Move the rows themselves. The stored links are resolved ids; pin them to
  // bundle-absolute targets so the new id cannot re-aim relative links.
  const own = await bodyOf(ctx, ws._id, oldId);
  const pin = new Map(row.links.map((l) => [l, l === oldId ? newId : l] as const));
  const body = retargetLinks(own?.body ?? "", oldId, pin).body;
  const links = extractLinks(body, newId);
  await ctx.db.patch(row._id, { cid: newId, links, updatedAt: Date.now() });
  if (own) {
    await ctx.db.patch(own._id, { cid: newId, body, ...searchFieldsOf({ ...row, body }) });
  }
  await replaceLinks(ctx, ws._id, oldId, []);
  await replaceLinks(ctx, ws._id, newId, links);
  // "See" references follow the move too: the concepts the old id superseded.
  for (const f of await filedUnder(ctx, ws._id, "superseded_by", oldId).take(1_000)) {
    const d = await getByCid(ctx, ws._id, f.cid);
    if (!d) continue;
    const fm = (d.frontmatter ?? {}) as Record<string, unknown>;
    await ctx.db.patch(d._id, { frontmatter: { ...fm, supersededBy: newId } });
    await reindexConcept(ctx, ws._id, d, await ctx.db.get(d._id));
  }
  await recordRevision(ctx, row._id, "rename", by);
  await reindexConcept(ctx, ws._id, row, await ctx.db.get(row._id));
  // The old id is retired too: it now says where the concept went.
  await retire(ctx, ws._id, oldId, { movedTo: newId });
  return {
    id: newId,
    path: null as string | null,
    relinked,
    ...(retired ? { reused: reusedNote(retired) } : {}),
  };
}

/**
 * One page of the OKF bundle (no lock-in by design): concept records with
 * their bodies, in cid order. Bodies make a full workspace too big for one
 * transaction, so the export route walks the pages.
 */
export async function exportPage(ctx: QueryCtx, ws: Id<"workspaces">, cursor: string | null) {
  const page = await ctx.db
    .query("concepts")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws))
    .paginate({ cursor, numItems: 100 });
  const concepts = [];
  for (const d of page.page) {
    const b = await bodyOf(ctx, ws, d.cid);
    concepts.push({
      cid: d.cid,
      frontmatter: d.frontmatter as Record<string, unknown>,
      body: b?.body ?? "",
      // What the finding aids list (renderFindingAids), so the export builds them itself.
      title: d.title ?? null,
      description: d.description ?? null,
      type: d.type,
      status: d.status,
      added: d._creationTime,
    });
  }
  return { concepts, cursor: page.isDone ? null : page.continueCursor };
}

/**
 * Delete a slice of the workspace's rows: revisions first (the biggest rows),
 * then links, bodies, and concepts. True when nothing is left.
 */
export async function deleteSome(ctx: MutationCtx, ws: Id<"workspaces">, budget = 500) {
  const revs = await ctx.db
    .query("revisions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const r of revs) await ctx.db.delete(r._id);
  if (revs.length === budget) return false;
  const links = await ctx.db
    .query("links")
    .withIndex("by_ws_src", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const l of links) await ctx.db.delete(l._id);
  if (links.length === budget) return false;
  // The catalog index: what each concept was filed under, and the counts.
  const facets = await ctx.db
    .query("facets")
    .withIndex("by_cid", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const f of facets) await ctx.db.delete(f._id);
  if (facets.length === budget) return false;
  const counts = await ctx.db
    .query("facetCounts")
    .withIndex("by_kind_value", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const c of counts) await ctx.db.delete(c._id);
  if (counts.length === budget) return false;
  const bodies = await ctx.db
    .query("bodies")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws))
    .take(100);
  for (const b of bodies) await ctx.db.delete(b._id);
  if (bodies.length === 100) return false;
  const docs = await ctx.db
    .query("concepts")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const d of docs) await ctx.db.delete(d._id);
  if (docs.length === budget) return false;
  // Proposals name concepts by id; an approve after this would fail on them.
  const props = await ctx.db
    .query("proposals")
    .withIndex("by_workspace_status", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const p of props) await ctx.db.delete(p._id);
  if (props.length === budget) return false;
  // The ready-reference file goes with the library it describes.
  const questions = await ctx.db
    .query("questions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const q of questions) await ctx.db.delete(q._id);
  if (questions.length === budget) return false;
  const weeks = await ctx.db
    .query("questionWeeks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const w of weeks) await ctx.db.delete(w._id);
  if (weeks.length === budget) return false;
  // Home's dismissals name its questions and sources.
  const dismissed = await ctx.db
    .query("dismissedGaps")
    .withIndex("by_workspace_kind_key", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const d of dismissed) await ctx.db.delete(d._id);
  if (dismissed.length === budget) return false;
  // Retired ids go too: an emptied library starts over.
  const tombstones = await ctx.db
    .query("tombstones")
    .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const t of tombstones) await ctx.db.delete(t._id);
  if (tombstones.length === budget) return false;
  // Kept sources: their parts (and the pictures converted for them), then the
  // sources and their files.
  const parts = await ctx.db
    .query("sourceParts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const p of parts) {
    if (p.media?.storageId && (await ctx.db.system.get(p.media.storageId))) {
      await ctx.storage.delete(p.media.storageId);
    }
    await ctx.db.delete(p._id);
  }
  if (parts.length === budget) return false;
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", ws))
    .take(budget);
  for (const src of sources) {
    if (src.storageId && (await ctx.db.system.get(src.storageId))) {
      await ctx.storage.delete(src.storageId);
    }
    await ctx.db.delete(src._id);
  }
  if (sources.length === budget) return false;
  await ctx.db.patch(ws, {
    conceptCount: 0,
    sourceBytes: 0,
    textBytes: 0,
    sourceCount: 0,
    revisionCount: 0,
  });
  return true;
}

/** Circulation counts a concept's retrievals at most once in this long. */
const ACCESS_EVERY_MS = 60 * 60_000;

/**
 * Circulation: record a retrieval, at most one an hour per concept, so an
 * agent reading a concept again and again doesn't rewrite its row (and its
 * search index) each time. Missing rows are ignored.
 */
export async function touchAccess(ctx: MutationCtx, ws: Id<"workspaces">, cid: string) {
  const row = await getByCid(ctx, ws, cid);
  if (!row) return;
  if (row.lastAccessedAt && Date.now() - row.lastAccessedAt < ACCESS_EVERY_MS) return;
  await ctx.db.patch(row._id, {
    lastAccessedAt: Date.now(),
    accessCount: (row.accessCount ?? 0) + 1,
  });
}

/** The most open proposals counted: past it, the shelf says "100 or more". */
export const OPEN_COUNTED = 100;

/** Open-shelf count, for status and the dashboard: up to OPEN_COUNTED. */
export async function openCount(ctx: QueryCtx, ws: Id<"workspaces">): Promise<number> {
  const rows = await ctx.db
    .query("proposals")
    .withIndex("by_workspace_status", (q) => q.eq("workspaceId", ws).eq("status", "open"))
    .take(OPEN_COUNTED);
  return rows.length;
}
