/** Which posts BotID checks (src/lib/bot-check.ts): the forms', never an agent's OAuth. */

import { expect, test } from "vitest";
import { botChecked } from "../src/lib/bot-check";

test("BotID checks the sign-up, sign-in, and email-code posts", () => {
  for (const path of [
    "/api/auth/sign-up/email",
    "/api/auth/sign-in/email",
    "/api/auth/email-otp/send-verification-otp",
    "/api/auth/email-otp/verify-email",
    "/api/auth/email-otp/reset-password",
    "/api/auth/forget-password/email-otp",
  ]) {
    expect(botChecked(path), path).toBe(true);
  }
});

test("an agent's OAuth calls, and the rest of Better Auth, go unchecked", () => {
  for (const path of [
    "/api/auth/oauth2/token",
    "/api/auth/oauth2/register",
    "/api/auth/oauth2/consent",
    "/api/auth/sign-out",
    "/api/auth/get-session",
    "/api/auth/sign-up",
  ]) {
    expect(botChecked(path), path).toBe(false);
  }
});
