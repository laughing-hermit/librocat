/** A Team library: its invite link brings a second person in, and Team lists both. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { person, runDev, sessionCookies, signIn } from "./support.ts";

test("a second person joins a Team library through its invite link", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "team-owner", "team");
  await app.open("/dashboard/team");
  await expect(screen.getByRole("tab", "Team")).toHaveAttribute("aria-selected", "true");
  await screen.getByRole("button", "Copy invite link").tap();
  await expect(screen.getByText(/\/invite\//).first()).toBeVisible({ timeout: 15_000 });
  const text = await browser.evaluate(() => document.body.innerText);
  const url = /https?:\/\/\S+\/invite\/[\w-]+/.exec(text)?.[0];
  expect(url, "an invite link on the Team page").toBeTruthy();

  // Opened signed out, the link asks for an account to join the library, not for Free.
  await app.clearState();
  await app.open(url as string);
  await expect(screen.getByRole("heading", /^Join /)).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText(/invited you as an Editor/)).toBeVisible();

  const guest = person("team-guest", "free");
  await browser.setCookies(await sessionCookies(guest));
  await app.open(url as string);
  await expect(screen.getByText(/invited you as an Editor/)).toBeVisible({ timeout: 20_000 });
  await screen.getByRole("button", "Join").tap();
  await expect(screen.getByRole("heading", "Library")).toBeVisible({ timeout: 20_000 });
  await app.open("/dashboard/team");
  await expect(screen.getByRole("main").getByText(guest.email)).toBeVisible();
  // A member can't delete the team's library, but can leave it.
  await app.open("/dashboard/library");
  await expect(screen.getByText("Leave this library")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText("Delete this library")).toBeHidden();
  await screen.getByRole("button", "Leave library").tap();
  await screen.getByRole("button", "Leave the library").tap();
  await expect(screen.getByText("You left the library").first()).toBeVisible({
    timeout: 20_000,
  });
});

test("an invite link for Readers: who joins reads the library, with nothing to add or decide", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "readers-owner", "team");
  await app.open("/dashboard/team");
  await screen.getByRole("button", /^Readers/).tap();
  await screen.getByRole("button", "Copy invite link").tap();
  await expect(screen.getByText(/\/invite\//).first()).toBeVisible({ timeout: 15_000 });
  const text = await browser.evaluate(() => document.body.innerText);
  const url = /https?:\/\/\S+\/invite\/[\w-]+/.exec(text)?.[0];
  expect(url, "an invite link on the Team page").toBeTruthy();

  const guest = person("readers-guest", "free");
  await app.clearState();
  await browser.setCookies(await sessionCookies(guest));
  await app.open(url as string);
  await expect(screen.getByText(/invited you as a Reader/)).toBeVisible({ timeout: 20_000 });
  await screen.getByRole("button", "Join").tap();
  await expect(screen.getByRole("heading", "Library")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText(/You can read this library/)).toBeVisible();
  await expect(screen.getByRole("button", "Attach files")).toBeHidden();
  // Get started gives a Reader a search to try, not a concept to save.
  await expect(screen.getByText("2. Ask it something")).toBeVisible();
  await expect(screen.getByText("2. Save your first concept")).toBeHidden();
});

test("an admin makes a teammate a Reader in two clicks, and the menu closes", async ({
  app,
  screen,
  browser,
}) => {
  const owner = await signIn(browser, "roles-owner", "team");
  const mate = person("roles-mate", "free");
  runDev("dev:addMember", { workspaceId: owner.workspaceId, userId: mate.userId });
  await app.open("/dashboard/team");
  await screen.getByRole("button", /'s role$/).tap();
  await screen.getByRole("menuitemradio", /^Reader/).tap();
  await expect(screen.getByText(/is now Reader/).first()).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole("menuitemradio", /^Reader/)).toBeHidden();
});

test("a full Team says so on its invite card, with one click to add a seat", async ({
  app,
  screen,
  browser,
}) => {
  const owner = await signIn(browser, "team-full", "team");
  // A Team has at least 3 seats: the owner and two teammates take them all.
  for (const label of ["team-full-mate", "team-full-mate-2"]) {
    const mate = person(label, "free");
    runDev("dev:addMember", { workspaceId: owner.workspaceId, userId: mate.userId });
  }
  await app.open("/dashboard/team");
  await expect(screen.getByText(/All 3 seats are taken/)).toBeVisible({ timeout: 15_000 });
  // No Stripe subscription here to read the seat's price from: Billing adds it.
  await expect(screen.getByRole("link", "Add a seat in Billing")).toBeVisible();
  // The owner's row says Owner: why it has no role menu and no Remove.
  await expect(screen.getByText("Owner", { exact: true })).toBeVisible();
});
