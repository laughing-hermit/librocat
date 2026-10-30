/**
 * A production deployment redacts a thrown Error to "Server Error", so the
 * caller would never read why a call failed ("body over 64 KB", "concept not
 * found", "librocat.com needs a plan"). A ConvexError's data does reach the client,
 * so the public functions run their model calls through here;
 * src/lib/convex-error.ts reads the message back out on the Next.js side.
 */

import { ConvexError } from "convex/values";

export async function surfaced<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ConvexError) throw err;
    // Never an empty message: a person sees it.
    const said = err instanceof Error ? err.message : String(err);
    throw new ConvexError(said.trim() || "That didn't work. Try again in a minute.");
  }
}
