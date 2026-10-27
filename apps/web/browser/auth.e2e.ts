/** Sign-up with the emailed code, sign-in, a wrong password, and a password reset. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { emailedCode, person } from "./support.ts";

test("a new person signs up with the emailed code and lands on the Library", async ({
  app,
  screen,
  browser,
}) => {
  const email = `browser-signup-${Date.now()}@example.com`;
  await app.open("/sign-up");
  await screen.getByLabel("Name").fill("Gabriella Rossi");
  await screen.getByLabel("Email").fill(email);
  await screen.getByLabel("Password").fill(`fixture-${Date.now()}-pw`);
  await screen.getByRole("button", "Create account").tap();
  await expect(screen.getByLabel("Verification code")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => emailedCode(email), { timeout: 15_000 }).toMatch(/^\d+$/);
  await screen.getByLabel("Verification code").pressSequentially(emailedCode(email) as string);
  await screen.getByRole("button", "Verify and continue").tap();
  await expect(browser).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(screen.getByRole("heading", "Library")).toBeVisible();
  // Their first library is named for them, so teammates read whose it is.
  await expect(screen.getByRole("button", /Gabriella's library/)).toBeVisible();
  // Teammates see the name given at sign-up, above the email.
  await app.open("/dashboard/team");
  await expect(screen.getByRole("main").getByText("Gabriella Rossi")).toBeVisible();
});

test("a person signs in with a password, and a wrong one is refused", async ({
  app,
  screen,
  browser,
}) => {
  const who = person("signin");
  await app.open("/sign-in");
  await screen.getByLabel("Email").fill(who.email);
  await screen.getByLabel("Password").fill("not-the-password");
  await screen.getByRole("button", "Sign in").tap();
  await expect(screen.getByText(/invalid|incorrect|wrong/i)).toBeVisible({ timeout: 15_000 });
  await expect(browser).toHaveURL(/\/sign-in/);
  await screen.getByLabel("Password").fill(who.password);
  await screen.getByRole("button", "Sign in").tap();
  await expect(screen.getByRole("heading", "Library")).toBeVisible({ timeout: 20_000 });
});

test("a person resets a forgotten password with the emailed code", async ({
  app,
  screen,
  browser,
}) => {
  const who = person("reset");
  await app.open("/sign-in");
  await screen.getByRole("link", "Forgot password?").tap();
  // The first visit compiles the page under `next dev`: as long as sign-up's wait.
  await expect(browser).toHaveURL(/\/reset-password/, { timeout: 20_000 });
  await screen.getByLabel("Email").fill(who.email);
  // The sign-up's verification code is in the log already: wait for the reset's.
  const before = emailedCode(who.email);
  const resetCode = () => {
    const code = emailedCode(who.email);
    return code === before ? null : code;
  };
  await screen.getByRole("button", "Send reset code").tap();
  await expect.poll(resetCode, { timeout: 20_000 }).toMatch(/^\d+$/);
  await screen.getByLabel(/code/i).pressSequentially(resetCode() as string);
  await screen.getByLabel("New password").fill(`fixture-${Date.now()}-new`);
  await screen.getByRole("button", "Set new password").tap();
  await expect(screen.getByRole("heading", "Library")).toBeVisible({ timeout: 20_000 });
});
