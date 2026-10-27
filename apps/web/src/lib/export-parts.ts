/**
 * Export in parts: one Vercel function streams each part, and it stops after
 * about 13 minutes, so no part holds more than a function moves in a few.
 * The library part holds the concepts, the tags, and every kept source's
 * text; each file part holds attached files, in id order, up to
 * FILE_PART_BYTES. Unzipped into one folder, the parts make the whole bundle,
 * and Import takes them one after another.
 */

/** The most file bytes one part holds. */
export const FILE_PART_BYTES = 1_000_000_000;

export type FilePart = { from: string; to: string; bytes: number; files: number };

/** Cut files, in id order, into parts of at most `max` bytes (a bigger file gets its own). */
export function fileParts(
  files: { id: string; bytes: number }[],
  max: number = FILE_PART_BYTES,
): FilePart[] {
  const parts: FilePart[] = [];
  for (const f of files) {
    const last = parts.at(-1);
    if (last && last.bytes + f.bytes <= max) {
      last.to = f.id;
      last.bytes += f.bytes;
      last.files += 1;
    } else parts.push({ from: f.id, to: f.id, bytes: f.bytes, files: 1 });
  }
  return parts;
}

/** The download for one part: the library part with no range, a file part with its ids. */
export function partHref(part?: FilePart & { n: number; of: number }): string {
  if (!part) return "/dashboard/export";
  const q = new URLSearchParams({
    from: part.from,
    to: part.to,
    part: String(part.n),
    of: String(part.of),
  });
  return `/dashboard/export?${q}`;
}
