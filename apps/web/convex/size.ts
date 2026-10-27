/**
 * What documents weigh, about as Convex counts them: for counting a call by
 * what it reads (metered.ts), and for stopping a pass before it reads too
 * much for one function (16 MiB).
 */

/** About what a value takes in Convex: a string by its length, a number 8 bytes. Pure. */
export function sizeOf(value: unknown): number {
  if (value === null || value === undefined) return 0;
  switch (typeof value) {
    case "string":
      return value.length;
    case "number":
    case "bigint":
      return 8;
    case "boolean":
      return 1;
    case "object": {
      if (value instanceof ArrayBuffer) return value.byteLength;
      let n = 0;
      if (Array.isArray(value)) for (const v of value) n += sizeOf(v);
      else for (const [k, v] of Object.entries(value)) n += k.length + sizeOf(v);
      return n;
    }
    default:
      return 0;
  }
}

/**
 * The first documents of a query, at most `rows` of them and about `bytes`:
 * a pass that stays far under what one function may read, whatever the
 * documents weigh. `whole` says whether the query ended first.
 */
export async function takeUpTo<T>(
  query: AsyncIterable<T>,
  rows: number,
  bytes: number,
): Promise<{ docs: T[]; whole: boolean }> {
  const docs: T[] = [];
  let read = 0;
  for await (const doc of query) {
    if (docs.length === rows || read >= bytes) return { docs, whole: false };
    docs.push(doc);
    read += sizeOf(doc);
  }
  return { docs, whole: true };
}
