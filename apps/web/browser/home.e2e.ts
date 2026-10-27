/** The Library's Needs you: a tab per kind of thing waiting, and a decision that keeps the tab. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { askUnanswered, seedConcepts, signIn } from "./support.ts";

test("Needs you filters by kind, and Dismiss takes the row away", async ({
  app,
  screen,
  browser,
}) => {
  const who = await signIn(browser, "home-queue", "individual");
  await seedConcepts(who, [{ type: "Note", id: "notes/hello", title: "Hello" }]);
  await askUnanswered(who, "zebra crossing rules");
  await app.open("/dashboard");
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  // Something waits, so the Library opens on Needs you.
  await expect(screen.getByRole("tab", /Needs you/)).toHaveAttribute("aria-selected", "true");
  // Three groups, one click: what the library is missing.
  await screen.getByRole("button", /^Missing/).tap();
  await expect(screen.getByText("zebra crossing rules")).toBeVisible();
  await expect(screen.getByText("Missing", { exact: true }).first()).toBeVisible();
  // Its date, the list's order: when it was last asked.
  await expect(screen.getByText(/^Last asked \w{3} \d+/)).toBeVisible();
  await screen.getByRole("button", "Dismiss").tap();
  await expect(screen.getByText("All clear")).toBeVisible({ timeout: 20_000 });
});
