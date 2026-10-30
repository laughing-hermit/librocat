/** Every plan's ceilings in 30 days (convex/limits.ts) and the revisions kept (convex/model.ts). */
import { expect, test } from "vitest";
import { callAllowance, transferAllowance, waitFor, writeAllowance } from "../convex/limits";
import { MAX_BODY_BYTES, REVISIONS_KEPT, REVISIONS_PER_CONCEPT, TEXT_BYTES } from "../convex/model";

test("calls, writes, and file transfer a month, by plan; Team's calls and writes by seat", () => {
  expect([callAllowance("free"), callAllowance("individual"), callAllowance("team", 3)]).toEqual([
    10_000, 30_000, 90_000,
  ]);
  expect([writeAllowance("free"), writeAllowance("individual"), writeAllowance("team", 5)]).toEqual(
    [1_500, 5_000, 25_000],
  );
  expect([
    transferAllowance("free"),
    transferAllowance("individual"),
    transferAllowance("team"),
  ]).toEqual([1e9, 10e9, 50e9]);
  // A library storing more than its plan's transfer (back on Free from Team)
  // can still move every file once in 30 days; within its plan, nothing changes.
  expect(transferAllowance("free", 25e9)).toBe(25e9);
  expect(transferAllowance("free", 5e7)).toBe(1e9);
  expect(transferAllowance("team", 25e9)).toBe(50e9);
});

test("history keeps 100 revisions a concept, and two for each concept a plan allows", () => {
  expect(REVISIONS_PER_CONCEPT).toBe(100);
  expect(REVISIONS_KEPT).toEqual({ free: 2_000, individual: 10_000, team: 30_000 });
});

test("text has its own room in the storage quota, and a concept body holds 16 KB", () => {
  expect(TEXT_BYTES).toEqual({ free: 10_000_000, individual: 250_000_000, team: 1_000_000_000 });
  expect(MAX_BODY_BYTES).toBe(16_000);
});

test("a refused call says when it can go on, in words", () => {
  expect(waitFor(12_000)).toBe("12 s");
  expect(waitFor(130_000)).toBe("about 2 minutes");
  expect(waitFor(6 * 3_600_000)).toBe("about 6 hours");
});
