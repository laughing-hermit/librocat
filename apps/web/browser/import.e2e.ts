/** Import, beside Export: a library takes in an export's zip. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signIn } from "./support.ts";

test("a library imports an export's zip: its concepts, tags, source text, and files", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "import", "individual");
  await app.open("/dashboard/library");
  await expect(screen.getByRole("button", "Import")).toBeVisible();
  // The picker's input is hidden behind its "Import" button.
  await browser.locator('input[type="file"]').setInputFiles(["browser/fixtures/import.zip"]);
  await expect(screen.getByText(/Imported 2 concepts, 2 sources, 1 tag term\./)).toBeVisible({
    timeout: 60_000,
  });
  await app.open("/dashboard/concepts?tab=concepts");
  await expect(screen.getByText("Imported note")).toBeVisible();
  await expect(screen.getByText("Restore a library")).toBeVisible();
  // The attached file came back as a file, under its old id.
  await app.open("/dashboard/sources/src-checklist");
  await expect(screen.getByText("Restore checklist").first()).toBeVisible();
});
