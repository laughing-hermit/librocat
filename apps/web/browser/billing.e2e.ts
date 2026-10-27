/** Billing: the plans on Free, and pay-as-you-go's switch and monthly cap on a paid plan. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signIn } from "./support.ts";

test("Free sees the plans, and says when Checkout can't start", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "billing-free", "free");
  await app.open("/dashboard/billing");
  await expect(screen.getByRole("tab", "Billing")).toHaveAttribute("aria-selected", "true");
  // Free sees only the plans: pay-as-you-go comes with a paid one.
  await expect(screen.getByRole("button", "Current plan")).toBeVisible();
  await expect(screen.getByText("Pay-as-you-go")).toBeHidden();
  await screen.getByRole("tab", "Monthly").tap();
  await screen.getByRole("button", "Start Individual").tap();
  await expect(screen.getByText(/Checkout could not start/)).toBeVisible({ timeout: 20_000 });
});

test("a paid library turns pay-as-you-go on and sets its monthly cap", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "billing-payg", "individual");
  await app.open("/dashboard/billing");
  await screen.getByRole("switch", "Pay-as-you-go").tap();
  await expect(screen.getByRole("switch", "Pay-as-you-go")).toBeChecked({ timeout: 15_000 });
  await expect(screen.getByText("$0 of $10")).toBeVisible({ timeout: 15_000 });

  await screen.getByLabel("Monthly cap").fill("25");
  await screen.getByRole("button", "Save").tap();
  await expect(screen.getByText("$0 of $25")).toBeVisible({ timeout: 15_000 });

  // The field itself keeps the cap in whole dollars from $1 to $1,000.
  await expect(screen.getByLabel("Monthly cap")).toHaveAttribute("min", "1");
  await expect(screen.getByLabel("Monthly cap")).toHaveAttribute("max", "1000");
});
