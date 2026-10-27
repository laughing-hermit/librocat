/** Library › files: saving a link, attaching a file and a PDF, each landing on its own page, and refusing a recording. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { seedSources, signIn, site } from "./support.ts";

test("a paid library saves a link, and lands on its page", async ({ app, screen, browser }) => {
  await signIn(browser, "sources-link", "individual");
  await app.open("/dashboard/concepts");
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  await screen.getByRole("button", "Save a link").tap();
  // A page of this site, not the internet's: the test deployment fetches
  // local addresses (LIBROCAT_FETCH_PRIVATE), and nothing outside can fail it.
  await screen.getByLabel("A page's URL").fill(`${site}/about`);
  await screen.getByRole("button", "Save link").tap();
  await expect(browser).toHaveURL(/\/dashboard\/sources\//, { timeout: 20_000 });
  await expect(screen.getByRole("heading", "About | librocat").first()).toBeVisible();
});

test("a library attaches a text file, and lands on its page", async ({ app, screen, browser }) => {
  await signIn(browser, "sources-file", "individual");
  await app.open("/dashboard/concepts");
  // The picker works once the page is live: its tabs then put the view in the address.
  await expect(browser).toHaveURL(/tab=/);
  // The picker's input is hidden behind the Attach files button.
  await expect(browser.locator('input[type="file"]')).toHaveCount(1);
  await browser.locator('input[type="file"]').setInputFiles(["browser/fixtures/notes.md"]);
  await expect(browser).toHaveURL(/\/dashboard\/sources\//, { timeout: 30_000 });
  // A Markdown file has one view: its text, formatted, once it's read.
  await expect(screen.getByRole("heading", "Release checklist")).toBeVisible({ timeout: 30_000 });
  // No concept cites it yet: the page says what to ask an agent.
  await expect(screen.getByText("None yet. Ask your agent:")).toBeVisible();
  await expect(screen.getByRole("button", "Copy prompt")).toBeVisible();
});

test("a library attaches a PDF and sees its pages", async ({ app, screen, browser }) => {
  await signIn(browser, "sources-pdf", "individual");
  await app.open("/dashboard/concepts");
  await expect(browser).toHaveURL(/tab=/);
  await expect(browser.locator('input[type="file"]')).toHaveCount(1);
  await browser.locator('input[type="file"]').setInputFiles(["browser/fixtures/one-page.pdf"]);
  await expect(browser).toHaveURL(/\/dashboard\/sources\//, { timeout: 30_000 });
  await expect(screen.getByRole("tab", "Preview")).toHaveAttribute("aria-selected", "true", {
    timeout: 30_000,
  });
  await expect(screen.getByText("1 page")).toBeVisible({ timeout: 30_000 });
});

test("a recording is refused, with what to keep instead", async ({ app, screen, browser }) => {
  await signIn(browser, "sources-audio", "individual");
  await app.open("/dashboard/concepts");
  await expect(browser).toHaveURL(/tab=/);
  await expect(browser.locator('input[type="file"]')).toHaveCount(1);
  await browser.locator('input[type="file"]').setInputFiles(["browser/fixtures/memo.mp3"]);
  await expect(screen.getByText(/for a recording, its transcript/)).toBeVisible({
    timeout: 20_000,
  });
});

test("the type is one click, and a second click clears it", {
  session: "library",
}, async ({ app, screen, browser }) => {
  await app.open("/dashboard/concepts?tab=concepts");
  // No tag filter: search finds tags.
  await expect(screen.getByRole("button", "Tag")).toBeHidden();
  await screen.getByRole("button", /^Decisions/).tap();
  await expect(browser).toHaveURL(/type=Decision/);
  await expect(screen.getByText("We use pnpm")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByRole("button", /Token refresh/)).toBeHidden();
  // No "All": a second click on the picked chip shows everything again.
  await expect(screen.getByRole("button", /^All/)).toBeHidden();
  await screen.getByRole("button", /^Decisions/).tap();
  await expect(browser).not.toHaveURL(/type=/);
  await expect(screen.getByText("Token refresh")).toBeVisible({ timeout: 20_000 });
  // A Runbook written by an agent is a Note.
  await screen.getByRole("button", /^Notes/).tap();
  await expect(browser).toHaveURL(/type=Note/);
  await expect(screen.getByText("Deploying the site")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText("We use pnpm")).toBeHidden();
});

test("the Files tab finds a file and opens it", {
  session: "library",
}, async ({ app, screen, browser }) => {
  await app.open("/dashboard/concepts?tab=files");
  await expect(screen.getByRole("tab", /Files/)).toHaveAttribute("aria-selected", "true");
  await expect(browser.locator('input[type="file"]')).toHaveCount(1);
  await browser.locator('input[type="file"]').setInputFiles(["browser/fixtures/notes.md"]);
  await expect(browser).toHaveURL(/\/dashboard\/sources\//, { timeout: 30_000 });
  await app.open("/dashboard/concepts?tab=files");
  // The same chips: a Markdown file is a Document.
  await screen.getByRole("button", /^Documents/).tap();
  await expect(screen.getByText(/notes\.md/).first()).toBeVisible();
  await screen.getByLabel("Search your files").fill("notes.md");
  await screen
    .getByRole("link", /Release checklist|notes/)
    .first()
    .tap();
  await expect(browser).toHaveURL(/\/dashboard\/sources\//);
  // Back from a file is the Files tab.
  await expect(screen.getByRole("link", "Files")).toHaveAttribute(
    "href",
    "/dashboard/concepts?tab=files",
  );
});

test("Files flip to oldest first, and the address keeps it", async ({ app, screen, browser }) => {
  const who = await signIn(browser, "files-sort", "individual");
  // Eleven files, added in turn: ten a page.
  await seedSources(
    who,
    Array.from({ length: 11 }, (_, i) => `File ${String(i + 1).padStart(2, "0")}`),
  );
  await app.open("/dashboard/concepts?tab=files");
  await expect(screen.getByText("File 11")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText("File 01")).toBeHidden();
  await screen.getByRole("button", "Oldest").tap();
  await expect(browser).toHaveURL(/sort=oldest/);
  await expect(screen.getByText("File 01")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText("File 11")).toBeHidden();
});
