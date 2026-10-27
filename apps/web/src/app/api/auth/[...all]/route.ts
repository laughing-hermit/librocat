// Better Auth, proxied to the Convex deployment (convex/auth.ts): sign-in,
// sign-up, email codes, and the OAuth authorization server for /mcp.
import { checkBotId } from "botid/server";
import { handler } from "@/lib/auth-server";
import { botChecked } from "@/lib/bot-check";
import { comingSoon } from "@/lib/coming-soon";

// Before launch, sign-up is closed at the API too, not just the pages.
const closed = () => new Response(null, { status: 404 });

export async function GET(request: Request): Promise<Response> {
  if (comingSoon) return closed();
  return handler.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  if (comingSoon) return closed();
  // The forms' posts, from a person's browser: BotID turns away a bot (Vercel only).
  if (process.env.VERCEL === "1" && botChecked(new URL(request.url).pathname)) {
    const { isBot } = await checkBotId();
    if (isBot) {
      return Response.json(
        {
          code: "BOT_DETECTED",
          message: "This looked automated. Reload the page and try again from your browser.",
        },
        { status: 403 },
      );
    }
  }
  return handler.POST(request);
}
