/**
 * Every plan's ceilings on what costs librocat Cloud money, so no library can
 * cost more than its plan brings in (BLOCKER, "Is librocat profitable?").
 * Token buckets keyed by library (@convex-dev/rate-limiter); the monthly ones
 * refill over 30 days, day by day, so a library never waits for a calendar
 * month to turn.
 * - Calls a minute: MCP writes and searches, by plan, for bursts.
 * - Calls a month: every call that reads or writes a library, the
 *   dashboard's too, counted by what it reads: once, and once more per
 *   256 KB past the first (metered.ts), as Convex bills reads by the byte.
 * - Writes a month: every concept written, changed, renamed, or deleted,
 *   every source kept, every proposal and decision.
 * - File transfer a month, in bytes: what librocat's own file links serve,
 *   counted as they serve it (files.ts), and each file attached, which is
 *   read to index it (sources.ts attachFile). Past it, a link answers 429,
 *   `get_source` returns the text without links, and an attach is refused.
 * On Free each is its allowance; on a paid plan, a ceiling several times
 * real use (a busy agent makes a few thousand calls and a few hundred
 * writes a month), sized so a library that maxes every ceiling at once still
 * costs less than its plan brings in (BLOCKER, "Is librocat profitable?").
 * Index credits, storage, concepts, and the revisions kept are counted where
 * they're spent (model.ts). Search calls no model. Jev's keys have budgets
 * besides (ai.ts). A self-hosted librocat has none of these limits.
 */

import { DAY, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { selfHosted } from "./ai";
import { seatsOf } from "./model";
import { poolKey } from "./teamCover";

export const CALLS_PER_MINUTE = { free: 60, individual: 300, team: 600 } as const;
/** Calls in 30 days, each counted by what it reads (Team's per seat). */
export const CALLS_PER_MONTH = { free: 10_000, individual: 30_000, teamPerSeat: 30_000 } as const;
/** Writes in 30 days (Team's per seat). */
export const WRITES_PER_MONTH = { free: 1_500, individual: 5_000, teamPerSeat: 5_000 } as const;
/**
 * File transfer in 30 days, in bytes: files served by librocat's file links,
 * and files read when attached. Convex bills each byte once, as data egress
 * (reading a file inside a function); an HTTP action's response isn't egress.
 */
export const TRANSFER_BYTES_PER_MONTH = {
  free: 1_000_000_000,
  individual: 10_000_000_000,
  team: 50_000_000_000,
} as const;
const MONTH = 30 * DAY;

type Plan = Doc<"workspaces">["plan"];
type PerSeat = { free: number; individual: number; teamPerSeat: number };
const PLAN_NAMES: Record<Plan, string> = { free: "Free", individual: "Individual", team: "Team" };

const perPlan = (table: PerSeat, plan: Plan, seats = 1): number =>
  plan === "free"
    ? table.free
    : plan === "individual"
      ? table.individual
      : table.teamPerSeat * Math.max(1, seats);

/** A library's MCP calls in 30 days. */
export const callAllowance = (plan: Plan, seats = 1): number =>
  perPlan(CALLS_PER_MONTH, plan, seats);
/** A library's writes in 30 days. */
export const writeAllowance = (plan: Plan, seats = 1): number =>
  perPlan(WRITES_PER_MONTH, plan, seats);
/** A library's file transfer in 30 days, in bytes. */
export const transferAllowance = (plan: Plan): number => TRANSFER_BYTES_PER_MONTH[plan];

const limiter = new RateLimiter(components.rateLimiter, {
  callsFree: { kind: "token bucket", rate: CALLS_PER_MINUTE.free, period: MINUTE },
  callsIndividual: { kind: "token bucket", rate: CALLS_PER_MINUTE.individual, period: MINUTE },
  callsTeam: { kind: "token bucket", rate: CALLS_PER_MINUTE.team, period: MINUTE },
});

const CALLS = { free: "callsFree", individual: "callsIndividual", team: "callsTeam" } as const;

/** A bucket that holds `rate` and refills over 30 days: the plan's and seats' at each call. */
const monthly = (rate: number) => ({ kind: "token bucket" as const, rate, period: MONTH });

/**
 * Count `extra` more calls, for what a call read past its first 256 KB
 * (metered.ts). Into debt if need be: the work is done, so it isn't refused
 * after the fact; the next call waits until the month refills past it.
 */
export async function chargeReads(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  extra: number,
): Promise<void> {
  if (selfHosted() || extra <= 0) return;
  await limiter.limit(ctx, "monthCalls", {
    key: poolKey(ws),
    count: extra,
    reserve: true,
    config: monthly(callAllowance(ws.plan, seatsOf(ws))),
  });
}

/** "about 3 minutes": when a refilling bucket has room again. Pure. */
export function waitFor(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `about ${m} minutes`;
  return `about ${Math.round(m / 60)} hours`;
}

/** Why a monthly ceiling refused a call, and when it can go on. */
function overMonthly(what: string, n: number, ws: Doc<"workspaces">, retryAfter: number) {
  // A Team's libraries share its month (teamCover.ts poolKey).
  const each = ws.plan === "team" ? " for each person, shared by its libraries" : "";
  return (
    `${ws.plan === "team" ? "This library's Team" : "This library"} has used its ${what} for now: ${PLAN_NAMES[ws.plan]} allows ` +
    `${n.toLocaleString("en-US")} a month${each}, refilled day by day, so more come back in ` +
    `${waitFor(retryAfter)}.` +
    (ws.plan === "team" ? "" : " A bigger plan allows more: see the Billing page.")
  );
}

/**
 * Count one MCP call against its library's ceilings: a minute (`burst`, for
 * writes and searches), a month, and `writes` writes a month. Over one, the
 * agent is told which, and when it can go on; a refused call counts nothing
 * (the mutation rolls back).
 */
export async function limitCalls(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  { burst = true, writes = 0 }: { burst?: boolean; writes?: number } = {},
): Promise<void> {
  if (selfHosted()) return;
  if (burst) {
    const { ok, retryAfter } = await limiter.limit(ctx, CALLS[ws.plan], { key: ws._id });
    if (!ok) {
      throw new ConvexError(
        `Too many calls to this library: try again in ${Math.max(1, Math.ceil(retryAfter / 1000))} s. ` +
          `${PLAN_NAMES[ws.plan]} allows ${CALLS_PER_MINUTE[ws.plan]} a minute.`,
      );
    }
  }
  const seats = seatsOf(ws);
  const calls = callAllowance(ws.plan, seats);
  const c = await limiter.limit(ctx, "monthCalls", { key: poolKey(ws), config: monthly(calls) });
  if (!c.ok) throw new ConvexError(overMonthly("calls", calls, ws, c.retryAfter));
  if (writes > 0) {
    const allowed = writeAllowance(ws.plan, seats);
    const w = await limiter.limit(ctx, "monthWrites", {
      key: poolKey(ws),
      count: writes,
      config: monthly(allowed),
    });
    if (!w.ok) throw new ConvexError(overMonthly("writes", allowed, ws, w.retryAfter));
  }
}

/**
 * Whether a library may move `bytes` more of its files this month (served,
 * or read when attached), and counts them when it may; if not, when it can
 * (`retryAfter`, ms). More than the whole allowance never fits.
 */
export async function takeTransfer(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  bytes: number,
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (selfHosted()) return { ok: true };
  const allowed = transferAllowance(ws.plan);
  if (bytes > allowed) return { ok: false };
  const r = await limiter.limit(ctx, "monthTransfer", {
    key: poolKey(ws),
    count: Math.max(1, Math.ceil(bytes)),
    config: monthly(allowed),
  });
  return r.ok ? { ok: true } : { ok: false, retryAfter: r.retryAfter };
}

type Left = { included: number; left: number };
type Bucket = "monthCalls" | "monthWrites" | "monthTransfer";

/** What a bucket refilled over 30 days holds now, of `included`. */
async function leftOf(
  ctx: QueryCtx | MutationCtx,
  ws: Doc<"workspaces">,
  name: Bucket,
  included: number,
): Promise<Left> {
  const { value, ts } = await limiter.getValue(ctx, name, {
    key: poolKey(ws),
    config: monthly(included),
  });
  const refilled = value + ((Date.now() - ts) * included) / MONTH;
  return { included, left: Math.floor(Math.min(included, Math.max(0, refilled))) };
}

/** A library's file transfer: the bytes in 30 days, and what's left now; null when self-hosted. */
export async function transferLeft(
  ctx: QueryCtx | MutationCtx,
  ws: Doc<"workspaces">,
): Promise<Left | null> {
  if (selfHosted()) return null;
  return await leftOf(ctx, ws, "monthTransfer", transferAllowance(ws.plan));
}

/** Every other monthly ceiling, and what's left of each now (`status`); null when self-hosted. */
export async function monthlyLeft(
  ctx: QueryCtx | MutationCtx,
  ws: Doc<"workspaces">,
): Promise<{ calls: Left; writes: Left; transfer_bytes: Left } | null> {
  if (selfHosted()) return null;
  const seats = seatsOf(ws);
  return {
    calls: await leftOf(ctx, ws, "monthCalls", callAllowance(ws.plan, seats)),
    writes: await leftOf(ctx, ws, "monthWrites", writeAllowance(ws.plan, seats)),
    transfer_bytes: await leftOf(ctx, ws, "monthTransfer", transferAllowance(ws.plan)),
  };
}

/** A library's writes left this month, alone (the dashboard's banner); null when self-hosted. */
export async function writesLeft(
  ctx: QueryCtx | MutationCtx,
  ws: Doc<"workspaces">,
): Promise<Left | null> {
  if (selfHosted()) return null;
  return await leftOf(ctx, ws, "monthWrites", writeAllowance(ws.plan, seatsOf(ws)));
}

/** Use up one of a library's monthly ceilings (dev.ts, for the e2e tests). */
export async function drainMonthly(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  which: "calls" | "writes" | "transfer_bytes",
): Promise<void> {
  const now = await monthlyLeft(ctx, ws);
  if (!now || now[which].left <= 0) return;
  const name =
    which === "calls" ? "monthCalls" : which === "writes" ? "monthWrites" : "monthTransfer";
  await limiter.limit(ctx, name, {
    key: poolKey(ws),
    count: now[which].left,
    config: monthly(now[which].included),
  });
}
