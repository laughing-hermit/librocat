/** A first library's name, and who a library pauses (convex/membership.ts). */

import { afterEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
import { firstLibraryName, pausedIn } from "../convex/membership";

describe("pausedIn", () => {
  const library = (plan: Doc<"workspaces">["plan"]) =>
    ({ plan, ownerId: "owner" }) as Doc<"workspaces">;
  afterEach(() => vi.unstubAllEnvs());

  test("only a Team shares a library: on any other plan, everyone but its owner is paused", () => {
    expect(pausedIn(library("team"), "mate")).toBe(false);
    expect(pausedIn(library("free"), "mate")).toBe(true);
    expect(pausedIn(library("individual"), "mate")).toBe(true);
    expect(pausedIn(library("free"), "owner")).toBe(false);
  });

  test("a self-hosted librocat has no plans, so it pauses no one", () => {
    vi.stubEnv("LIBROCAT_SELF_HOST", "1");
    expect(pausedIn(library("free"), "mate")).toBe(false);
  });
});

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
