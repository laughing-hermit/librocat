// The domain check for listing librocat in ChatGPT's plugin directory: the
// submission portal shows a token, and OPENAI_APPS_CHALLENGE on the Vercel
// project serves it here as plain text. Unset, there is nothing to prove.
export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
