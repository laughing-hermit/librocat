/** The library as the dashboard shows it: its count, the list, search, and one concept opened in it. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { seedConcepts, signIn } from "./support.ts";

const concepts = [
  {
    type: "Note",
    id: "notes/token-refresh",
    title: "Token refresh",
    description: "Refresh tokens rotate on every use.",
    tags: ["auth"],
    body: "Refresh tokens rotate on every use, and a reused one revokes the whole family.",
  },
  {
    type: "Runbook",
    id: "runbooks/deploy",
    title: "Deploying the site",
    description: "Push to main and wait for the build.",
    tags: ["ops"],
    body: "Push to main. Vercel builds and runs convex deploy. Check the status page after.",
  },
];

test("the Library counts the concepts, and the list finds and opens one", async ({
  app,
  screen,
  browser,
}) => {
  const who = await signIn(browser, "concepts", "individual");
  await seedConcepts(who, concepts);
  await app.open("/dashboard");
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  await expect(screen.getByRole("tab", /Concepts/)).toBeVisible();
  // Needs you first, and the Library opens on it.
  const tabs = await browser.evaluate(() =>
    [...document.querySelectorAll('[data-slot="tabs-trigger"]')].map((t) => t.textContent ?? ""),
  );
  expect(tabs[0]).toMatch(/^Needs you/);
  await expect(screen.getByRole("tab", /Needs you/)).toHaveAttribute("aria-selected", "true");

  await app.open("/dashboard/concepts?tab=concepts");
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  await expect(screen.getByText("Token refresh")).toBeVisible();
  await expect(screen.getByText("Deploying the site")).toBeVisible();

  // Typing asks nothing of the server; Enter searches (one request).
  const search = screen.getByLabel("Search your library");
  await search.fill("deploy");
  await expect(screen.getByText("Token refresh")).toBeVisible();
  await search.press("Enter");
  await expect(browser).toHaveURL(/q=deploy/);
  await expect(screen.getByText("Deploying the site")).toBeVisible();
  await expect(screen.getByText("Token refresh")).toBeHidden();

  await screen.getByRole("button", /Deploying the site/).tap();
  // It opens in place, and the address follows.
  await expect(browser).toHaveURL(/\/dashboard\/concepts\/runbooks\/deploy/, { timeout: 30_000 });
  await expect(screen.getByText(/Vercel builds and runs convex deploy/)).toBeVisible();
  await expect(screen.getByText("Token refresh")).toBeHidden();
});

test("the list shows ten rows a page, and the next page the rest", async ({
  app,
  screen,
  browser,
}) => {
  const who = await signIn(browser, "concepts-pages", "individual");
  await seedConcepts(
    who,
    Array.from({ length: 12 }, (_, i) => ({
      type: "Note",
      id: `notes/n${String(i + 1).padStart(2, "0")}`,
      title: `Note ${String(i + 1).padStart(2, "0")}`,
    })),
  );
  await app.open("/dashboard/concepts?tab=concepts");
  // Newest first: the last written leads, ten a page.
  await expect(screen.getByRole("button", /Note 03/)).toBeVisible();
  // Each row's date, the list's order: when it last changed.
  await expect(screen.getByText(/^Updated \w{3} \d+/).first()).toBeVisible();
  await expect(screen.getByRole("button", /Note 02/)).toBeHidden();
  // shadcn's Pagination links read as buttons.
  await screen.getByRole("button", "Go to next page").tap();
  await expect(screen.getByRole("button", /Note 01/)).toBeVisible();
  await expect(screen.getByRole("button", /Note 12/)).toBeHidden();
  // Oldest first starts over on the first page, the first written leading.
  await screen.getByRole("button", "Oldest").tap();
  await expect(browser).toHaveURL(/sort=oldest/);
  await expect(screen.getByRole("button", /Note 01/)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("button", /Note 11/)).toBeHidden();
});
