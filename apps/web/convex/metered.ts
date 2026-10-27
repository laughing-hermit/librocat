/**
 * Every call counts what it reads. Convex bills database reads by the byte,
 * and librocat counts a call the same way: once, and once more for every
 * READ_UNIT it reads past the first (limits.ts). Almost every call reads far
 * less, so it counts once; a pull or an export counts what it copies.
 *
 * The count happens inside Convex, in the call's own mutation, so no door
 * skips it: an agent's token or a dashboard session calling Convex directly
 * counts the same as the MCP route and the dashboard do. That's why the
 * functions that read a library are mutations, not queries.
 */

import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { chargeReads, limitCalls } from "./limits";
import { sizeOf } from "./size";

/** What one counted call may read: past it, each READ_UNIT more counts another call. */
export const READ_UNIT = 256 * 1024;

type Meter = { bytes: number };

/** What a query's promise brought back: documents, a page of them, or one. */
const sizeOfResult = (r: unknown): number =>
  Array.isArray(r)
    ? sizeOf(r)
    : r && typeof r === "object" && Array.isArray((r as { page?: unknown }).page)
      ? sizeOf((r as { page: unknown[] }).page)
      : sizeOf(r);

/** A query (and what it chains into) whose documents add to `meter` as they come back. */
function countQuery(query: object, meter: Meter): object {
  return new Proxy(query, {
    get(target, prop) {
      if (prop === Symbol.asyncIterator) {
        return () => {
          const it = (target as AsyncIterable<unknown>)[Symbol.asyncIterator]();
          const counted: AsyncIterator<unknown> & AsyncIterable<unknown> = {
            next: async () => {
              const r = await it.next();
              if (!r.done) meter.bytes += sizeOf(r.value);
              return r;
            },
            [Symbol.asyncIterator]: () => counted,
          };
          return counted;
        };
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = value.apply(target, args);
        if (out instanceof Promise) {
          return out.then((r) => {
            meter.bytes += sizeOfResult(r);
            return r;
          });
        }
        return out && typeof out === "object" ? countQuery(out, meter) : out;
      };
    },
  });
}

/** `db` whose reads add their documents' size to `meter`; writes pass through. */
export function countReads<DB extends GenericDatabaseReader<DataModel>>(db: DB, meter: Meter): DB {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "get") {
        return async (...args: unknown[]) => {
          const doc = await (target.get as (...a: unknown[]) => Promise<unknown>)(...args);
          meter.bytes += sizeOf(doc);
          return doc;
        };
      }
      if (prop === "query") {
        return (table: string) => countQuery(target.query(table as never), meter);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Run one call's work counted: a call (with `writes`, and the minute's limit
 * when `burst`) before it reads anything, then one more for each READ_UNIT
 * it read past the first. That last count may go into debt: the work is
 * done, so it is never refused after the fact, and the next call waits
 * instead. A call that throws counts nothing (its mutation rolls back).
 */
export async function metered<T>(
  ctx: MutationCtx,
  ws: Doc<"workspaces">,
  run: (ctx: MutationCtx) => Promise<T>,
  opts: { burst?: boolean; writes?: number } = {},
): Promise<T> {
  await limitCalls(ctx, ws, { burst: opts.burst ?? false, writes: opts.writes ?? 0 });
  const meter: Meter = { bytes: 0 };
  const out = await run({ ...ctx, db: countReads(ctx.db, meter) });
  await chargeReads(ctx, ws, Math.ceil(meter.bytes / READ_UNIT) - 1);
  return out;
}
