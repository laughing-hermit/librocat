/** A first library's name (convex/membership.ts firstLibraryName). */

import { describe, expect, test } from "vitest";
import { firstLibraryName } from "../convex/membership";

describe("firstLibraryName", () => {
  test("names a first library for its owner, by their first name", () => {
    expect(firstLibraryName("Ana Lopez")).toBe("Ana's library");
    expect(firstLibraryName("  James  ")).toBe("James's library");
  });

  test("is My library without a name to give it", () => {
    expect(firstLibraryName(undefined)).toBe("My library");
    expect(firstLibraryName("  ")).toBe("My library");
    expect(firstLibraryName("dev@localhost")).toBe("My library");
    expect(firstLibraryName("x".repeat(51))).toBe("My library");
  });
});
