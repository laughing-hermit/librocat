/** Export's parts (src/lib/export-parts.ts): files in id order, each part under its size. */

import { expect, test } from "vitest";
import { fileParts, partHref } from "../src/lib/export-parts";

test("files go into parts of at most the size, in order; a bigger file gets its own", () => {
  const files = [
    { id: "a", bytes: 400 },
    { id: "b", bytes: 500 },
    { id: "c", bytes: 300 },
    { id: "d", bytes: 2_000 },
    { id: "e", bytes: 10 },
  ];
  expect(fileParts(files, 1_000)).toEqual([
    { from: "a", to: "b", bytes: 900, files: 2 },
    { from: "c", to: "c", bytes: 300, files: 1 },
    { from: "d", to: "d", bytes: 2_000, files: 1 },
    { from: "e", to: "e", bytes: 10, files: 1 },
  ]);
  expect(fileParts([])).toEqual([]);
});

test("a part's download names its ids", () => {
  expect(partHref()).toBe("/dashboard/export");
  expect(partHref({ from: "a", to: "b c", bytes: 1, files: 2, n: 1, of: 3 })).toBe(
    "/dashboard/export?from=a&to=b+c&part=1&of=3",
  );
});
