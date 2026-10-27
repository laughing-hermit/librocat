import path from "node:path";
import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

// BotID needs Vercel's network: on for builds made there (src/lib/bot-check.ts).
const onVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  // Monorepo: the lockfile lives at the repository root.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  env: { LIBROCAT_BOTID: onVercel ? "1" : "" },
};

export default onVercel ? withBotId(nextConfig) : nextConfig;
