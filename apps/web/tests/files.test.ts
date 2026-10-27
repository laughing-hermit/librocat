/** File links (convex/files.ts): signed, lasting an hour or two, and in parts past 16 MiB. */
import { expect, test } from "vitest";
import { linkExpiry, PART_BYTES, partsOf, readLink, signLink } from "../convex/files";

const link = { workspaceId: "ws123", storageId: "st456", start: 0, end: 1000, exp: 1_800_000_000 };
const before = (link.exp - 60) * 1000;

test("a link reads back as what it serves, until it expires", async () => {
  const token = await signLink(link, "s3cret");
  expect(await readLink(token, "s3cret", before)).toEqual(link);
  expect(await readLink(token, "s3cret", link.exp * 1000)).toBe("expired");
});

test("a link someone changed, or another key signed, is forged", async () => {
  const token = await signLink(link, "s3cret");
  expect(await readLink(token, "other", before)).toBe("forged");
  // More bytes, a later expiry, another file: each changes what was signed.
  for (const changed of [
    token.replace(".1000.", ".2000."),
    token.replace(`.${link.exp}.`, `.${link.exp + 3600}.`),
    token.replace("st456", "st457"),
  ]) {
    expect(await readLink(changed, "s3cret", before)).toBe("forged");
  }
  expect(await readLink("", "s3cret", before)).toBe("forged");
  expect(await readLink("not.a.link", "s3cret", before)).toBe("forged");
});

test("a link lasts one to two hours, and is the same all hour", () => {
  const hour = 3_600_000;
  const two = Date.UTC(2026, 9, 5, 14);
  expect(linkExpiry(two)).toBe((two + 2 * hour) / 1000);
  expect(linkExpiry(two + hour - 1)).toBe((two + 2 * hour) / 1000);
  expect(linkExpiry(two + hour)).toBe((two + 3 * hour) / 1000);
});

test("a file over 16 MiB is served in parts of 16 MiB", () => {
  expect(partsOf(0)).toEqual([]);
  expect(partsOf(1)).toEqual([[0, 1]]);
  expect(partsOf(PART_BYTES)).toEqual([[0, PART_BYTES]]);
  expect(partsOf(PART_BYTES + 1)).toEqual([
    [0, PART_BYTES],
    [PART_BYTES, PART_BYTES + 1],
  ]);
  const largest = partsOf(200_000_000);
  expect(largest).toHaveLength(12);
  expect(largest.at(-1)?.[1]).toBe(200_000_000);
});
