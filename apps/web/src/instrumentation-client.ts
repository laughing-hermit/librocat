// BotID's browser check on the sign-up and sign-in forms (src/lib/bot-check.ts),
// in builds made on Vercel (next.config.ts sets LIBROCAT_BOTID).
import { initBotId } from "botid/client/core";
import { BOT_CHECKED } from "@/lib/bot-check";

if (process.env.LIBROCAT_BOTID === "1") {
  initBotId({ protect: BOT_CHECKED.map((path) => ({ path, method: "POST" })) });
}
