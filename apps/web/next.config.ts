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
  // A page's address never leaves as a referrer, the site's own pages
  // included: analytics see the kind of page, never a dashboard path (the
  // privacy page says so).
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "strict-origin" }] }];
  },
};

export default onVercel ? withBotId(nextConfig) : nextConfig;
