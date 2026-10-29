import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";

// Libro's weekly report: stop the email with one click, no sign-in (the link
// carries a signed token; convex/report.ts). GET is the link a person
// clicks: it only asks, because mail scanners open links too, and would
// unsubscribe people who never clicked. Its button POSTs, as RFC 8058
// one-click unsubscribe from the mail client does.

async function unsubscribe(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  const member = url.searchParams.get("m") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!member || !token || !process.env.NEXT_PUBLIC_CONVEX_URL) return false;
  try {
    return (await fetchMutation(api.report.unsubscribe, { member, token })).ok;
  } catch {
    return false;
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | librocat</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#141B26"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p><p><a href="/dashboard" style="color:#1F744F">Open the library</a></p></body></html>`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export async function GET(request: Request) {
  const { search } = new URL(request.url);
  return new Response(
    page(
      "Stop Libro's report?",
      `You will not get Libro's report anymore. Turn it back on anytime in Account (the menu under your email).</p><form method="post" action="/api/unsubscribe${escapeHtml(search)}"><input type="hidden" name="confirm" value="1"><button type="submit" style="font:inherit;padding:.5rem 1rem;border-radius:.5rem;border:1px solid #1F744F;background:#1F744F;color:#fff;cursor:pointer">Stop the report</button></form><p>`,
    ),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request) {
  const ok = await unsubscribe(request);
  // The mail client's one-click asks for no page; the button above shows one.
  const fromPage = (await request.formData().catch(() => null))?.get("confirm") === "1";
  if (!fromPage) {
    return new Response(ok ? "unsubscribed" : "invalid link", { status: ok ? 200 : 400 });
  }
  return new Response(
    ok
      ? page(
          "You will not get Libro's report anymore",
          "Turn it back on anytime in Account (the menu under your email).",
        )
      : page(
          "That link did not work",
          "Stop the report in Account (the menu under your email) instead, or write to support@librocat.com.",
        ),
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
