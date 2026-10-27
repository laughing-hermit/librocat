/**
 * Email through Resend: the sign-up verification and password-reset codes
 * (Better Auth's emailOTP plugin, convex/auth.ts) and Libro's weekly report
 * (convex/report.ts). Env: AUTH_RESEND_KEY. Sender: librocat
 * <mail@librocat.com>.
 */

import { Resend } from "resend";

type CodeType = "sign-in" | "email-verification" | "forget-password" | "change-email";

const SUBJECTS: Record<CodeType, string> = {
  "sign-in": "Your librocat sign-in code",
  "email-verification": "Verify your librocat email",
  "forget-password": "Reset your librocat password",
  "change-email": "Confirm your new librocat email",
};

function bodyFor(type: CodeType, code: string): string {
  if (type === "forget-password") {
    return `Your password reset code is ${code}. If you did not request this, ignore this email.`;
  }
  return `Your verification code is ${code}. It expires shortly — request a new one if it does.`;
}

export type Email = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

/**
 * Send one email. Local development has no Resend account (docs/cloud.md
 * §Local development): with AUTH_DEV_LOG_CODES=1 and no key, the email goes
 * to the Convex log instead of an inbox. Never set that on prod.
 */
/** The owner's addresses (LIBROCAT_FUNNEL_EMAIL, comma-separated): unset, none. */
export function ownerAddresses(): string[] {
  return (process.env.LIBROCAT_FUNNEL_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** How long to wait before each new try of an email Resend refused as too fast (429). */
export const RETRY_DELAYS_MS = [1_000, 3_000];

export async function sendEmail(
  email: Email,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  // Reserved names (RFC 2606 and 6761) never take mail, so sending only
  // bounces, which counts against the sender: the test accounts' addresses.
  if (/\.(test|example|invalid|localhost)$/i.test(email.to.trim())) {
    console.log(`[skipped] email to ${email.to}: ${email.subject}`);
    return;
  }
  const key = process.env.AUTH_RESEND_KEY;
  if (!key && process.env.AUTH_DEV_LOG_CODES === "1") {
    console.log(`[dev] email to ${email.to}: ${email.subject}\n${email.text}`);
    return;
  }
  if (!key) throw new Error("AUTH_RESEND_KEY is not set: cannot send the email");
  const resend = new Resend(key);
  // Resend takes 10 requests a second per team; past that it answers 429.
  for (let attempt = 0; ; attempt++) {
    const { error } = await resend.emails.send({
      from: "librocat <mail@librocat.com>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
      ...(email.headers ? { headers: email.headers } : {}),
    });
    if (!error) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (error.statusCode !== 429 || delay === undefined) {
      throw new Error(`Resend could not send the email: ${error.message}`);
    }
    await wait(delay);
  }
}

export async function sendAuthCode(email: string, code: string, type: CodeType): Promise<void> {
  await sendEmail({ to: email, subject: SUBJECTS[type], text: bodyFor(type, code) });
}
