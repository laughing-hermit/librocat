// convex/errors.ts sends a failure's message as ConvexError data, because a
// production deployment redacts anything else to "Server Error". This reads it
// back out wherever the site shows or forwards a Convex failure.

import { ConvexError } from "convex/values";

/** What a request that never reached Convex says (Node's fetch failing on the network). */
export const UNREACHABLE = "librocat couldn't be reached. Please try again.";

export function errorMessage(exc: unknown, fallback?: string): string {
  if (exc instanceof ConvexError && typeof exc.data === "string") return exc.data;
  if (exc instanceof TypeError && exc.message === "fetch failed") return UNREACHABLE;
  if (exc instanceof Error) return exc.message;
  return fallback ?? String(exc);
}
