/** What the site shows for a failed Convex call (src/lib/convex-error.ts). */

import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { errorMessage, UNREACHABLE } from "../src/lib/convex-error";

describe("errorMessage", () => {
  it("reads a ConvexError's message", () => {
    expect(errorMessage(new ConvexError("only a library's admin can do that"))).toBe(
      "only a library's admin can do that",
    );
  });

  it("says plainly when Convex couldn't be reached, not Node's 'fetch failed'", () => {
    expect(errorMessage(new TypeError("fetch failed"))).toBe(UNREACHABLE);
  });

  it("keeps another error's message, and the fallback for anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42, "the import failed")).toBe("the import failed");
  });
});
