/**
 * The bug bash's findings (2026-10-04), kept as regression tests: each
 * failed on the code before its fix.
 */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { site } from "./support.ts";

const noSideScroll = () => document.documentElement.scrollWidth <= window.innerWidth;

test("the public pages fit a phone, with the header's links in a menu", async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 360, height: 780 });
  for (const path of ["/", "/privacy"]) {
    await app.open(path);
    expect(await browser.evaluate(noSideScroll)).toBe(true);
  }
  await screen.getByRole("button", "Menu").tap();
  await screen.getByRole("menuitem", "Pricing").tap();
  await expect(screen.getByRole("heading", "Pricing")).toBeVisible();
});

test("sign-up refuses an address longer than 254 characters", async ({ app, screen }) => {
  await app.open("/sign-up");
  await expect(screen.getByLabel("Email")).toHaveAttribute("maxlength", "254");
  const res = await fetch(`${site}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: site },
    body: JSON.stringify({
      email: `${"a".repeat(290)}@example.com`,
      password: "fixture-long-pw",
      name: "x",
    }),
  });
  expect(res.status).toBe(400);
});

test("a copy button copies, or says it could not", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Copy").first().tap();
  await expect(screen.getByText(/Copied to clipboard|Could not copy/)).toBeVisible();
});

test("Billing says why seats could not change", { session: "team" }, async ({ app, screen }) => {
  await app.open("/dashboard/billing");
  await screen.getByLabel("Seats").fill("4");
  await screen.getByRole("button", "Update seats").tap();
  await expect(screen.getByText(/The seats could not be changed\. Please try again/)).toBeVisible({
    timeout: 15_000,
  });
});

test("an unknown concept says so inside the dashboard, with a way back", {
  session: "free",
}, async ({ app, screen }) => {
  await app.open("/dashboard/concepts/does-not-exist");
  await expect(screen.getByRole("link", "Back to the Library")).toBeVisible();
});

test("an unknown page says so, with a way home", async ({ app, screen }) => {
  await app.open("/no-such-page");
  await expect(screen.getByRole("link", "Go to the home page")).toBeVisible();
});

test("on a phone, the Library fits the screen", { session: "library" }, async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/dashboard");
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  expect(await browser.evaluate(noSideScroll)).toBe(true);
});

test("on a phone, the Library and a search fit the screen", {
  session: "library",
}, async ({ app, browser, screen }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/dashboard/concepts?q=deploy");
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  expect(await browser.evaluate(noSideScroll)).toBe(true);
});

test("on a phone, Connect's tabs and copy blocks fit", { session: "library" }, async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/dashboard/connect");
  await expect(screen.getByRole("heading", "Connect an agent")).toBeVisible();
  const overflowing = await browser.evaluate(() => [
    ...Array.from(document.querySelectorAll('[data-slot="tabs-list"]'))
      .filter((e) => e.scrollHeight > e.clientHeight + 1)
      .map(() => "tabs"),
    ...Array.from(document.querySelectorAll("pre"))
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map(() => "pre"),
  ]);
  expect(overflowing).toEqual([]);
});

test("a concept opens in the list, and a link to another concept opens that one", {
  session: "library",
}, async ({ app, screen, browser }) => {
  await app.open("/dashboard/concepts/auth/token-refresh");
  const link = screen.getByRole("link", "sessions");
  await expect(link).toHaveAttribute("href", "/dashboard/concepts/auth/sessions?tab=concepts");
  await link.tap();
  // It opens in the list, as its row does.
  await expect(browser).toHaveURL(/\/dashboard\/concepts\/auth\/sessions/);
  await expect(screen.getByText(/Signing out ends every session/)).toBeVisible();
});

test("on a phone, Team keeps a member's badges on screen", { session: "library" }, async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/dashboard/team");
  await expect(screen.getByText("You")).toBeVisible();
  const clipped = await browser.evaluate(() =>
    Array.from(document.querySelectorAll('[data-slot="item"] [data-slot="badge"]'))
      .filter((b) => {
        const item = b.closest('[data-slot="item"]')?.getBoundingClientRect();
        return item && b.getBoundingClientRect().right > item.right + 1;
      })
      .map((b) => b.textContent),
  );
  expect(clipped).toEqual([]);
});

test("the dashboard's address opens the Library, and a concept opens in it", {
  session: "library",
}, async ({ app, browser, screen }) => {
  await app.open("/dashboard");
  await expect(browser).toHaveURL(/\/dashboard\/concepts/);
  await expect(screen.getByRole("tab", /Needs you/)).toBeVisible();
  const concept = await browser.evaluate(() =>
    fetch("/dashboard/concepts/ops/deploy").then((r) => r.text()),
  );
  expect(concept).toContain("Needs you");
});

for (const [path, title] of [
  ["/sign-in", "Welcome back"],
  ["/sign-up", "Create your account"],
  ["/reset-password", "Reset your password"],
] as const) {
  test(`${path} names itself in a heading`, async ({ app, screen }) => {
    await app.open(path);
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText(title);
  });
}
