/** Your data: export the library, empty it, and delete the account (Settings). */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { seedConcepts, signIn } from "./support.ts";

const note = {
  type: "Note",
  id: "notes/keep",
  title: "Keep me",
  description: "A note.",
  tags: ["x"],
  body: "Body.",
};

test("Export downloads the library as OKF files", async ({ app, screen, browser }) => {
  const who = await signIn(browser, "export", "individual");
  await seedConcepts(who, [note]);
  await app.open("/dashboard/library");
  // Export is a menu of parts: the library first, then its files a gigabyte at a time.
  await screen.getByRole("button", "Export").tap();
  const file = await browser.waitForDownload(
    async () => {
      await screen.getByText("Library: concepts and text").tap();
    },
    { timeout: 60_000 },
  );
  expect(file.suggestedFilename).toMatch(/\.zip$/);
});

test("Empty library takes every concept", async ({ app, screen, browser }) => {
  const who = await signIn(browser, "delete-index", "individual");
  await seedConcepts(who, [note]);
  await app.open("/dashboard/library");
  await screen.getByRole("button", "Empty library").tap();
  // It asks in a dialog over the page, not inside the row.
  await expect(screen.getByRole("alertdialog")).toBeVisible();
  await screen.getByRole("button", "Empty the library").tap();
  await app.open("/dashboard/concepts");
  await expect(screen.getByText("Keep me")).toBeHidden({ timeout: 20_000 });
});

test("Delete account signs the person out and back to the landing page", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "delete-account", "free");
  await app.open("/dashboard/account");
  await screen.getByRole("button", "Delete account").tap();
  await screen.getByRole("button", "Delete the account").tap();
  await expect(browser).toHaveURL("/", { timeout: 30_000 });
  await app.open("/dashboard");
  await expect(browser).toHaveURL(/\/sign-in/, { timeout: 15_000 });
});
