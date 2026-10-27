/** What deleting a library says about its plan (src/lib/delete-copy.ts). */

import { describe, expect, test } from "vitest";
import { deleteLibraryCopy } from "../src/lib/delete-copy";

const lib = { name: "Acme", plan: "free", billedWith: null, covers: [] as string[] };

describe("deleteLibraryCopy", () => {
  test("a Team's home says the Team ends for its other libraries, with no refund", () => {
    const copy = deleteLibraryCopy({ ...lib, plan: "team", covers: ["Docs", "Wiki"] });
    expect(copy.title).toBe("Delete “Acme” and end the Team plan?");
    expect(copy.description).toContain(
      "the Team plan ends now, with no refund for the time left: Docs and Wiki go back to Free.",
    );
    expect(copy.row).toBe(
      "It goes for everyone, and the Team plan ends: Docs and Wiki go back to Free.",
    );
  });

  test("a paid library alone says its plan ends, with no refund", () => {
    const copy = deleteLibraryCopy({ ...lib, plan: "individual" });
    expect(copy.title).toBe("Delete “Acme” and end its plan?");
    expect(copy.description).toContain(
      "its Individual plan ends now, with no refund for the time left.",
    );
    expect(deleteLibraryCopy({ ...lib, plan: "team" }).description).toContain(
      "its Team plan ends now",
    );
  });

  test("a library a Team covers leaves the Team as it is; a Free one has no plan to end", () => {
    const covered = deleteLibraryCopy({ ...lib, plan: "team", billedWith: "Home" });
    expect(covered.title).toBe("Delete “Acme”?");
    expect(covered.description).toContain("The Team plan stays, billed with Home.");
    const free = deleteLibraryCopy(lib);
    expect(free.description).not.toMatch(/plan|refund/);
    expect(free.row).toBe("It goes for everyone. Your other libraries stay.");
  });
});
