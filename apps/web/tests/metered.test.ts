/**
 * Counting a call by what it reads (convex/metered.ts) and stopping a pass
 * before it reads too much (convex/size.ts).
 */

import { expect, test } from "vitest";
import { countReads, READ_UNIT } from "../convex/metered";
import { sizeOf, takeUpTo } from "../convex/size";

const docs = [
  { _id: "a", body: "x".repeat(1_000) },
  { _id: "b", body: "y".repeat(2_000) },
  { _id: "c", body: "z".repeat(3_000) },
];
const each = docs.map(sizeOf);
const all = each.reduce((a, b) => a + b, 0);

/** A stand-in for a Convex database: a chainable query over `docs`. */
function fakeDb() {
  const query = {
    withIndex: () => query,
    order: () => query,
    take: async (n: number) => docs.slice(0, n),
    collect: async () => docs,
    first: async () => docs[0] ?? null,
    paginate: async () => ({ page: docs, isDone: true, continueCursor: "" }),
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () =>
          i < docs.length ? { done: false, value: docs[i++] } : { done: true, value: undefined },
      };
    },
  };
  return {
    get: async () => docs[1],
    query: () => query,
    normalizeId: () => null,
    insert: async () => "new-id",
  };
}

test("sizeOf weighs strings by length, numbers 8 bytes, and keys", () => {
  expect(sizeOf("hello")).toBe(5);
  expect(sizeOf(42)).toBe(8);
  expect(sizeOf(true)).toBe(1);
  expect(sizeOf(null)).toBe(0);
  expect(sizeOf({ ab: "cd", n: 1 })).toBe(2 + 2 + 1 + 8);
  expect(sizeOf([1, 2, 3])).toBe(24);
  expect(READ_UNIT).toBe(256 * 1024);
});

test("countReads adds up every document a read returns, however it returns them", async () => {
  const meter = { bytes: 0 };
  // biome-ignore lint/suspicious/noExplicitAny: a stand-in database
  const db = countReads(fakeDb() as any, meter) as any;
  await db.get("b");
  expect(meter.bytes).toBe(each[1]);
  meter.bytes = 0;
  await db.query("t").withIndex("i").order("desc").take(2);
  expect(meter.bytes).toBe(each[0] + each[1]);
  meter.bytes = 0;
  await db.query("t").collect();
  expect(meter.bytes).toBe(all);
  meter.bytes = 0;
  await db.query("t").withIndex("i").first();
  expect(meter.bytes).toBe(each[0]);
  meter.bytes = 0;
  await db.query("t").paginate({ cursor: null, numItems: 3 });
  expect(meter.bytes).toBe(all);
  meter.bytes = 0;
  for await (const _ of db.query("t").withIndex("i")) {
    // each document counts as it comes
  }
  expect(meter.bytes).toBe(all);
  // Writes and other calls pass through, counting nothing.
  meter.bytes = 0;
  expect(await db.insert("t", {})).toBe("new-id");
  expect(db.normalizeId("t", "x")).toBeNull();
  expect(meter.bytes).toBe(0);
});

test("takeUpTo stops at its rows or its bytes, and says whether it read everything", async () => {
  const query = fakeDb().query();
  expect(await takeUpTo(query, 10, 1_000_000)).toEqual({ docs, whole: true });
  expect(await takeUpTo(query, 2, 1_000_000)).toEqual({ docs: docs.slice(0, 2), whole: false });
  // Past the bytes after the first two: the third waits for the next pass.
  expect(await takeUpTo(query, 10, each[0] + each[1])).toEqual({
    docs: docs.slice(0, 2),
    whole: false,
  });
});
