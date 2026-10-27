/** Sending email (convex/email.ts): a send Resend refuses as too fast is tried again. */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { RETRY_DELAYS_MS, sendEmail } = await import("../convex/email");
const email = { to: "a@example.com", subject: "Hi", text: "Hello" };
const tooFast = { data: null, error: { statusCode: 429, message: "Too many requests" } };

beforeEach(() => {
  vi.stubEnv("AUTH_RESEND_KEY", "re_test");
  send.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

test("a 429 is tried again after 1 s, then 3 s", async () => {
  send.mockResolvedValueOnce(tooFast).mockResolvedValueOnce(tooFast);
  send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
  const waited: number[] = [];
  await sendEmail(email, async (ms) => {
    waited.push(ms);
  });
  expect(send).toHaveBeenCalledTimes(3);
  expect(waited).toEqual(RETRY_DELAYS_MS);
});

test("past the retries, or for any other error, the send fails with why", async () => {
  send.mockResolvedValue(tooFast);
  await expect(sendEmail(email, async () => {})).rejects.toThrow(/Too many requests/);
  expect(send).toHaveBeenCalledTimes(3);
  send.mockReset();
  send.mockResolvedValue({ data: null, error: { statusCode: 422, message: "Bad address" } });
  await expect(sendEmail(email, async () => {})).rejects.toThrow(/Bad address/);
  expect(send).toHaveBeenCalledTimes(1);
});
